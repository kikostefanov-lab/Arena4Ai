import { Router } from 'express';
import type { Request, Response } from 'express';
import { briefSchema, CompetitionFormat } from '@arena/shared';
import type { Team } from '@arena/shared';
import { CompetitionRunner } from '../../engine/competition-runner.js';
import type { RunOptions } from '../../engine/competition-runner.js';
import { repo } from '../repo.js';
import { runnerRegistry } from '../runner-registry.js';
import { requireApiKey } from '../middleware/auth.js';
import { applyPreset } from '../../brief/presets.js';

export const competitionsRouter = Router();

// POST /competitions — start a new competition
competitionsRouter.post('/', requireApiKey, async (req: Request, res: Response) => {
  const body = req.body as {
    brief?: unknown;
    teams?: unknown;
    options?: { skipSandbox?: boolean; claudeBin?: string; logDir?: string };
  };

  const briefResult = briefSchema.safeParse(body.brief);
  if (!briefResult.success) {
    res.status(400).json({ error: 'Invalid brief', details: briefResult.error.errors });
    return;
  }

  if (!Array.isArray(body.teams) || body.teams.length !== 2) {
    res.status(400).json({ error: 'teams must be an array of exactly 2 team objects' });
    return;
  }

  const rawTeams = body.teams as Array<{ id?: unknown; model?: unknown; persona?: unknown }>;
  for (const team of rawTeams) {
    if (!team.id || !team.model) {
      res.status(400).json({ error: 'Each team must have id and model fields' });
      return;
    }
  }

  const teams: [Team, Team] = rawTeams.map((t) => ({
    id: String(t.id),
    model: String(t.model),
    persona: t.persona ? String(t.persona) : 'pragmatist',
  })) as [Team, Team];

  const options: RunOptions = {
    skipSandbox: body.options?.skipSandbox ?? false,
    claudeBin: body.options?.claudeBin,
    logDir: body.options?.logDir,
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
      synthesis: result.synthesis,   // synthesized hybrid solution
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
  res.json({ id: comp.id, state: comp.state, brief: comp.brief, teams: comp.teams, eventCount, result });
});

// GET /competitions/:id/events — full event history for replay/analysis
competitionsRouter.get('/:id/events', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const afterSeq = req.query.afterSeq ? Number(req.query.afterSeq) : undefined;

  const comp = await repo.getCompetition(id);
  if (!comp) {
    res.status(404).json({ error: 'Competition not found' });
    return;
  }

  const evts = await repo.getEvents(id, afterSeq);
  res.json(evts);
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
