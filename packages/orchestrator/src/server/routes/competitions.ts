import { Router } from 'express';
import type { Request, Response } from 'express';
import archiver from 'archiver';
import { briefSchema, CompetitionFormat, CompetitionState } from '@arena/shared';
import type { BriefInput, Team, TeamPresentation, ForgeOutput, ForgeRun, ForgeSource, Brief, Deliverable } from '@arena/shared';
import { CompetitionRunner } from '../../engine/competition-runner.js';
import type { RunOptions } from '../../engine/competition-runner.js';
import { repo } from '../repo.js';
import { runnerRegistry } from '../runner-registry.js';
import { requireApiKey } from '../middleware/auth.js';
import { applyPreset } from '../../brief/presets.js';
import { runForge, getForgeProgress } from '../../forge/forge-orchestrator.js';
import type { ForgeInput } from '../../forge/forge-orchestrator.js';
import { synthesizeDeliverables } from '../../synthesis/merge-engine.js';
import type { TeamDeliverable } from '../../db/schema.js';
import { buildDeliverableFilename, buildForgeFilename } from '../../utils/naming.js';

export const competitionsRouter = Router();

// POST /competitions — start a new competition
competitionsRouter.post('/', requireApiKey, async (req: Request, res: Response) => {
  const body = req.body as {
    brief?: unknown;
    teams?: unknown;
    options?: { skipSandbox?: boolean; claudeBin?: string; logDir?: string; commentary?: boolean };
  };

  const briefResult = briefSchema.safeParse(body.brief);
  if (!briefResult.success) {
    res.status(400).json({ error: 'Invalid brief', details: briefResult.error.errors });
    return;
  }

  if (!Array.isArray(body.teams) || body.teams.length < 2 || body.teams.length > 4) {
    res.status(400).json({ error: 'teams must be an array of 2–4 team objects' });
    return;
  }

  const rawTeams = body.teams as Array<{ id?: unknown; model?: unknown; persona?: unknown }>;
  for (const team of rawTeams) {
    if (!team.id || !team.model) {
      res.status(400).json({ error: 'Each team must have id and model fields' });
      return;
    }
  }

  const teams: Team[] = rawTeams.map((t) => ({
    id: String(t.id),
    model: String(t.model),
    persona: t.persona ? String(t.persona) : 'pragmatist',
  }));

  const options: RunOptions = {
    // Default to skipping Docker sandbox — callers can opt in via options.skipSandbox: false
    skipSandbox: body.options?.skipSandbox ?? true,
    claudeBin: body.options?.claudeBin,
    logDir: body.options?.logDir,
    commentary: body.options?.commentary ?? false,
  };

  const rawBrief = briefResult.data;
  // Apply format preset defaults (fills missing rubric/time fields for known formats)
  let mergedBrief = rawBrief;
  if (rawBrief.format && Object.values(CompetitionFormat).includes(rawBrief.format as CompetitionFormat)) {
    try {
      mergedBrief = applyPreset(rawBrief.format as CompetitionFormat, rawBrief);
    } catch (err) {
      res.status(500).json({ error: 'Failed to apply format preset', details: (err as Error).message });
      return;
    }
  }

  const runner = new CompetitionRunner(mergedBrief, teams, options);
  const { competitionId } = runner;

  // Persist to DB before starting
  await repo.create(competitionId, mergedBrief, teams);

  // Wire runner events → DB (serialize state updates to prevent SCORED overwriting COMPLETE)
  let stateQueue: Promise<void> = Promise.resolve();
  runner.on('stateChange', (state) => {
    stateQueue = stateQueue.then(() =>
      repo.updateState(competitionId, state).catch(console.error),
    );
  });
  runner.on('arenaEvent', (event) => {
    repo.appendEvent(event).catch(console.error);
  });
  runner.on('result', (result) => {
    repo.saveResult(competitionId, {
      scorecards: result.scorecards,
      winner: result.winner,
      presentations: result.presentations,
      synthesis: result.synthesis,
      deliverables: result.deliverables,
    }).catch(console.error);
  });

  // Register runner for live WebSocket subscriptions
  runnerRegistry.set(competitionId, runner);
  runner.on('result', () => {
    // Keep in registry briefly for late-joining WebSocket clients
    setTimeout(() => runnerRegistry.delete(competitionId), 60_000);
  });

  runner.run().catch((err: Error) => {
    console.error(`[arena] competition ${competitionId} failed: ${err.message}`);
  });

  res.status(201).json({ competitionId });
});

// GET /competitions — list past competitions with winner info
competitionsRouter.get('/', async (_req: Request, res: Response) => {
  const list = await repo.listSummary(50);
  res.json(list);
});

// GET /competitions/:id — get competition status
competitionsRouter.get('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const comp = await repo.getCompetition(id);
  if (!comp) {
    res.status(404).json({ error: 'Competition not found' });
    return;
  }
  const [eventCount, result] = await Promise.all([
    repo.countEvents(id),
    repo.getResult(id),
  ]);
  res.json({ id: comp.id, state: comp.state, brief: comp.brief, teams: comp.teams, startedAt: comp.startedAt, notes: comp.notes ?? null, eventCount, result });
});

// GET /competitions/:id/events — full event history for replay/analysis
competitionsRouter.get('/:id/events', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  // offset = number of events already seen by the caller (per-competition count, not a global DB serial)
  const offset = req.query.afterSeq ? Number(req.query.afterSeq) : undefined;

  const comp = await repo.getCompetition(id);
  if (!comp) {
    res.status(404).json({ error: 'Competition not found' });
    return;
  }

  const evts = await repo.getEvents(id, offset);
  res.json(evts);
});

// In-memory guard to prevent concurrent forge runs for the same competition
const forgingInProgress = new Set<string>();

// In-memory guard to prevent concurrent synthesis runs
const synthesisInProgress = new Set<string>();

// POST /competitions/:id/forge — trigger forge generation
competitionsRouter.post('/:id/forge', requireApiKey, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const source: ForgeSource = req.body?.source ?? 'winner';

  if (!['winner', 'loser', 'synthesis'].includes(source)) {
    res.status(400).json({ error: 'source must be winner, loser, or synthesis' });
    return;
  }

  if (forgingInProgress.has(id)) {
    res.status(409).json({ error: 'Forge already in progress' });
    return;
  }

  const [comp, result] = await Promise.all([repo.getCompetition(id), repo.getResult(id)]);
  if (!comp) { res.status(404).json({ error: 'Competition not found' }); return; }
  if (!result) { res.status(409).json({ error: 'No results found' }); return; }

  // Allow forging from COMPLETE or FORGE_COMPLETE state
  if (comp.state !== CompetitionState.COMPLETE && comp.state !== CompetitionState.FORGE_COMPLETE) {
    res.status(409).json({ error: `Cannot forge in ${comp.state} state` });
    return;
  }

  if (source === 'synthesis' && !result.synthesis) {
    res.status(409).json({ error: 'No synthesis available — run synthesis first' });
    return;
  }

  const teams = (comp.teams as Team[]) ?? [];
  // StoredResult has `winner: string | null` (not `winnerId`) — but getResult returns DB row with winnerId
  const winnerId = result.winnerId;
  const winnerTeam = teams.find(t => t.id === winnerId) ?? teams[0];
  const loserTeam = teams.find(t => t.id !== winnerId) ?? teams[1];

  const sourceTeam = source === 'winner' ? winnerTeam
    : source === 'loser' ? loserTeam
    : undefined;

  forgingInProgress.add(id);
  await repo.updateState(id, CompetitionState.FORGING);

  const forgeInput: ForgeInput = {
    brief: comp.brief as ForgeInput['brief'],
    presentations: (result.presentations as TeamPresentation[]) ?? [],
    synthesis: result.synthesis as ForgeInput['synthesis'],
    winner: { teamId: winnerTeam.id, model: winnerTeam.model },
    deliverables: (result.deliverables as ForgeInput['deliverables']) ?? [],
    source,
    sourceTeamId: sourceTeam?.id,
  };

  runForge(forgeInput, id)
    .then(async (forgeRun) => {
      await repo.appendForgeRun(id, forgeRun);
      await repo.updateState(id, CompetitionState.FORGE_COMPLETE);
      console.log(`[arena] forge run complete for ${id} — source: ${source}`);
    })
    .catch(async (err: Error) => {
      console.error(`[arena] forge failed for ${id}:`, err.message);
      await repo.updateState(id, CompetitionState.COMPLETE).catch(console.error);
    })
    .finally(() => forgingInProgress.delete(id));

  res.status(202).json({ ok: true, message: 'Forge started', source });
});

// GET /competitions/:id/forge — get forge results
competitionsRouter.get('/:id/forge', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [comp, result] = await Promise.all([repo.getCompetition(id), repo.getResult(id)]);
  if (!comp) { res.status(404).json({ error: 'Competition not found' }); return; }

  const runs = (result?.forge as ForgeRun[] | null) ?? [];
  const inProgress = forgingInProgress.has(id);

  res.json({
    status: inProgress ? 'forging' : runs.length > 0 ? 'complete' : 'idle',
    runs,
  });
});

// GET /competitions/:id/forge/progress — per-artifact progress during forging
competitionsRouter.get('/:id/forge/progress', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const progress = getForgeProgress(id);
  if (!progress) {
    res.status(404).json({ error: 'No forge in progress for this competition' });
    return;
  }
  res.json({ progress });
});

// GET /competitions/:id/forge/download — zip of all 6 forge artifacts
competitionsRouter.get('/:id/forge/download', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const [result, comp] = await Promise.all([repo.getResult(id), repo.getCompetition(id)]);
  if (!result?.forge) {
    res.status(404).json({ error: 'No forge results for this competition' });
    return;
  }

  const brief = comp?.brief as Brief | null;
  // Use the most recent forge run for the filename (stacked runs; last = newest)
  const forgeRun = Array.isArray(result?.forge) ? result.forge.at(-1) : null;
  const forgeFilename = brief
    ? buildForgeFilename(brief, forgeRun?.source ?? 'winner', forgeRun?.generatedAt)
    : `arena4ai_unknown_${id}_forge-run.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${forgeFilename}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => { console.error(`[arena] forge zip error for ${id}:`, err.message); res.destroy(err); });
  archive.pipe(res);

  const forge = result.forge as unknown as ForgeOutput;
  for (const artifact of forge.artifacts) {
    archive.append(artifact.content, { name: `${artifact.type}.md` });
  }

  await archive.finalize();
});

// POST /competitions/:id/synthesis — trigger on-demand synthesis
competitionsRouter.post('/:id/synthesis', requireApiKey, async (req: Request, res: Response) => {
  const id = String(req.params.id);

  if (synthesisInProgress.has(id)) {
    res.status(409).json({ error: 'Synthesis is already in progress' });
    return;
  }

  const [comp, result] = await Promise.all([repo.getCompetition(id), repo.getResult(id)]);
  if (!comp) { res.status(404).json({ error: 'Competition not found' }); return; }
  if (!result) { res.status(409).json({ error: 'No results found' }); return; }

  const allowedStates = [
    CompetitionState.COMPLETE,
    CompetitionState.FORGE_COMPLETE,
    CompetitionState.FORGING,
  ];
  if (!allowedStates.includes(comp.state as CompetitionState)) {
    res.status(409).json({ error: `Cannot synthesize in ${comp.state} state` });
    return;
  }

  synthesisInProgress.add(id);

  const deliverables = (result.deliverables as Deliverable[]) ?? [];
  const presentations = (result.presentations as TeamPresentation[]) ?? [];
  const brief = comp.brief as Brief;

  const briefInput = { ...brief, deliverableType: brief.deliverableType ?? 'code' } as BriefInput;
  synthesizeDeliverables(briefInput, deliverables, { claudeBin: process.env.CLAUDE_BIN }, presentations)
    .then(async (synthesis) => {
      if (synthesis) {
        await repo.saveSynthesis(id, synthesis);
        console.log(`[arena] synthesis complete for ${id}`);
      } else {
        console.log(`[arena] synthesis returned null for ${id} (no deliverables)`);
      }
    })
    .catch((err: Error) => {
      console.error(`[arena] synthesis failed for ${id}:`, err.message);
    })
    .finally(() => synthesisInProgress.delete(id));

  res.status(202).json({ ok: true, message: 'Synthesis started' });
});

// GET /competitions/:id/synthesis — get synthesis result
competitionsRouter.get('/:id/synthesis', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const result = await repo.getResult(id);
  if (!result) { res.status(404).json({ error: 'Competition not found' }); return; }
  const inProgress = synthesisInProgress.has(id);
  res.json({
    status: inProgress ? 'running' : result.synthesis ? 'complete' : 'idle',
    synthesis: result.synthesis ?? null,
  });
});

// PATCH /competitions/:id/notes — update freetext notes for a competition
competitionsRouter.patch('/:id/notes', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const notes = (req.body as { notes?: unknown })?.notes;
  if (typeof notes !== 'string') {
    res.status(400).json({ error: 'notes must be a string' });
    return;
  }
  const comp = await repo.getCompetition(id);
  if (!comp) { res.status(404).json({ error: 'Competition not found' }); return; }
  await repo.updateNotes(id, notes);
  res.json({ ok: true });
});

// DELETE /competitions/:id — remove a competition and all its data
competitionsRouter.delete('/:id', requireApiKey, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  // Refuse to delete an active competition — cancel it first
  const runner = runnerRegistry.get(id);
  if (runner) {
    res.status(409).json({ error: 'Competition is active — cancel it before deleting' });
    return;
  }
  const deleted = await repo.delete(id);
  if (!deleted) {
    res.status(404).json({ error: 'Competition not found' });
    return;
  }
  res.json({ ok: true });
});

// POST /competitions/:id/cancel
competitionsRouter.post('/:id/cancel', requireApiKey, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const runner = runnerRegistry.get(id);
  if (!runner) {
    res.status(404).json({ error: 'Competition not found or already complete' });
    return;
  }
  await runner.cancel();
  res.json({ ok: true });
});

// POST /competitions/:id/pause
competitionsRouter.post('/:id/pause', requireApiKey, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const runner = runnerRegistry.get(id);
  if (!runner) {
    res.status(404).json({ error: 'Competition not found or already complete' });
    return;
  }
  runner.pause();
  res.json({ ok: true });
});

// POST /competitions/:id/resume
competitionsRouter.post('/:id/resume', requireApiKey, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const runner = runnerRegistry.get(id);
  if (!runner) {
    res.status(404).json({ error: 'Competition not found or already complete' });
    return;
  }
  runner.resume();
  res.json({ ok: true });
});

// GET /competitions/:id/deliverables/:teamId/download — ZIP of team files
competitionsRouter.get('/:id/deliverables/:teamId/download', async (req: Request, res: Response) => {
  const { id, teamId } = req.params as { id: string; teamId: string };

  const [comp, result] = await Promise.all([repo.getCompetition(id), repo.getResult(id)]);
  if (!comp) { res.status(404).json({ error: 'Competition not found' }); return; }

  const deliverables = (result?.deliverables as TeamDeliverable[] | null) ?? [];
  const teamDel = deliverables.find(d => d.teamId === teamId);
  if (!teamDel || teamDel.files.length === 0) {
    res.status(404).json({ error: 'No deliverables found for team' });
    return;
  }

  const teams = (comp.teams as Team[]) ?? [];
  const team = teams.find(t => t.id === teamId);
  const filename = team
    ? buildDeliverableFilename(comp.brief as Brief, team, comp.startedAt ? comp.startedAt.toISOString() : undefined)
    : `arena4ai_unknown_${teamId}_deliverables.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  for (const file of teamDel.files) {
    const safePath = file.path.replace(/^\//, '').replace(/\.\.\//g, '');
    archive.append(file.content, { name: safePath });
  }

  archive.append(JSON.stringify({
    competitionId: id,
    teamId,
    briefId: (comp.brief as { id?: string })?.id ?? '',
    briefTitle: (comp.brief as { title?: string })?.title ?? '',
    generatedAt: new Date().toISOString(),
    arena4aiVersion: '2.0',
  }, null, 2), { name: '_manifest.json' });

  await archive.finalize();
});
