import { Router } from 'express';
import type { Request, Response } from 'express';
import { briefSchema } from '@arena/shared';
import type { Team } from '@arena/shared';
import { CompetitionRunner } from '../../engine/competition-runner.js';
import type { RunOptions } from '../../engine/competition-runner.js';
import { db } from '../../db/client.js';
import { CompetitionRepository } from '../../db/repository.js';
import { runnerRegistry } from '../runner-registry.js';

export const competitionsRouter = Router();
const repo = new CompetitionRepository(db);

// POST /competitions — start a new competition
competitionsRouter.post('/', async (req: Request, res: Response) => {
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

  const runner = new CompetitionRunner(briefResult.data, teams, options);
  const { competitionId } = runner;

  // Persist to DB before starting
  await repo.create(competitionId, briefResult.data, teams);

  // Wire runner events → DB
  runner.on('stateChange', (state) => {
    repo.updateState(competitionId, state).catch(console.error);
  });
  runner.on('arenaEvent', (event) => {
    repo.appendEvent(event).catch(console.error);
  });
  runner.on('result', (result) => {
    repo.saveResult(competitionId, {
      scorecards: result.scorecards,
      winner: result.winner,
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

// GET /competitions — list past competitions
competitionsRouter.get('/', async (_req: Request, res: Response) => {
  const list = await repo.list(20);
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
  const eventCount = await repo.getEvents(id).then((evts) => evts.length);
  const result = await repo.getResult(id);
  res.json({ id: comp.id, state: comp.state, eventCount, result });
});

// POST /competitions/:id/cancel
competitionsRouter.post('/:id/cancel', async (req: Request, res: Response) => {
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
competitionsRouter.post('/:id/pause', async (req: Request, res: Response) => {
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
competitionsRouter.post('/:id/resume', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const runner = runnerRegistry.get(id);
  if (!runner) {
    res.status(404).json({ error: 'Competition not found or already complete' });
    return;
  }
  runner.resume();
  res.json({ ok: true });
});
