import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TournamentRunner } from '../../engine/tournament-runner.js';
import type { TournamentRanking } from '../../engine/tournament-runner.js';
import type { CompetitionRunner } from '../../engine/competition-runner.js';
import { TournamentRepository } from '../../db/repository.js';
import { db } from '../../db/client.js';
import { repo as compRepo } from '../repo.js';
import { runnerRegistry } from '../runner-registry.js';

export const tournamentsRouter = Router();

const repo = new TournamentRepository(db);

const CreateTournamentSchema = z.object({
  name: z.string().optional(),
  brief: z.object({
    title: z.string(),
    format: z.string(),
    problem: z.string(),
    constraints: z.array(z.string()).default([]),
    deliverables: z.array(z.string()).default([]),
    timeLimitMs: z.number().default(300_000),
    rubric: z.object({
      criteria: z.array(z.object({
        id: z.string(),
        description: z.string(),
        maxScore: z.number(),
        weight: z.number(),
      })),
    }),
    expectedOutput: z.string().optional(),
  }),
  teams: z.array(z.string()).min(2).max(8),
  options: z.object({
    skipSandbox: z.boolean().optional(),
    skipSynthesis: z.boolean().optional(),
  }).optional(),
});

// Runtime-only fields not persisted to DB
interface ActiveMeta {
  currentMatch: { teamA: string; teamB: string; competitionId?: string } | null;
  error: string | null;
}

const activeTournamentMeta = new Map<string, ActiveMeta>();
const activeTournamentRunners = new Map<string, TournamentRunner>();

// POST /tournaments — create and start a tournament asynchronously
tournamentsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateTournamentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { brief, teams, options = {}, name } = parsed.data;
  const tournamentId = randomUUID();
  const tournamentName = name ?? `Tournament ${tournamentId.slice(0, 8)}`;

  // Persist initial state to DB
  await repo.createTournament({
    id: tournamentId,
    name: tournamentName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    brief: brief as any,
    teams,
    type: 'ROUND_ROBIN',
    state: 'RUNNING',
    matchIds: [],
    rankings: null,
  });

  // Track runtime-only fields in memory
  activeTournamentMeta.set(tournamentId, { currentMatch: null, error: null });

  // Respond immediately with the ID
  res.status(201).json({ tournamentId });

  // Run asynchronously in the background
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runner = new TournamentRunner(brief as any, teams, {
    ...options,
    skipSandbox: options.skipSandbox ?? true,
    skipSynthesis: options.skipSynthesis ?? true,
    printResults: false,
    name: tournamentName,
  });

  activeTournamentRunners.set(tournamentId, runner);

  // Local accumulator for matchIds (matchEnd event doesn't carry competitionId)
  const accumulatedMatchIds: string[] = [];

  runner.on('matchStart', ({ teamA, teamB, competitionId: matchId, runner: matchRunner }: {
    teamA: string; teamB: string; competitionId: string; runner: CompetitionRunner;
  }) => {
    const meta = activeTournamentMeta.get(tournamentId);
    if (meta) meta.currentMatch = { teamA, teamB, competitionId: matchId };

    // Register the match runner so WebSocket can stream live events
    runnerRegistry.set(matchId, matchRunner);

    // Persist match to DB so it appears in dashboard
    const matchTeams = [
      { id: 'team-a', model: teamA, persona: teamA.split(':')[1] ?? 'default' },
      { id: 'team-b', model: teamB, persona: teamB.split(':')[1] ?? 'default' },
    ];
    compRepo.create(matchId, brief as any, matchTeams as [any, any]).catch(() => {});

    // Wire match events → DB persistence (same wiring as individual competitions)
    let stateQueue: Promise<void> = Promise.resolve();
    matchRunner.on('stateChange', (state: any) => {
      stateQueue = stateQueue.then(() =>
        compRepo.updateState(matchId, state).catch(() => {}),
      );
    });
    matchRunner.on('arenaEvent', (ev: any) => {
      compRepo.appendEvent(ev).catch(() => {});
    });
    matchRunner.on('result', (result: any) => {
      compRepo.saveResult(matchId, {
        scorecards: result.scorecards,
        winner: result.winner,
        presentations: result.presentations,
        synthesis: result.synthesis,
        deliverables: result.deliverables,
      }).catch(() => {});
    });
  });

  runner.on('matchEnd', ({ competitionId: matchId }: { competitionId?: string }) => {
    const meta = activeTournamentMeta.get(tournamentId);
    if (meta) meta.currentMatch = null;
    if (matchId) {
      accumulatedMatchIds.push(matchId);
      // Clean up runner registry after a delay
      setTimeout(() => runnerRegistry.delete(matchId), 60_000);
    }
    repo.updateTournamentProgress(tournamentId, [...accumulatedMatchIds], null).catch(() => {});
  });

  runner.run()
    .then((result) => {
      // Sync local accumulator from the final result
      accumulatedMatchIds.length = 0;
      accumulatedMatchIds.push(...result.matchIds);

      return Promise.all([
        repo.updateTournamentProgress(tournamentId, result.matchIds, result.rankings as TournamentRanking[]),
        repo.updateTournamentState(tournamentId, 'COMPLETE', new Date().toISOString()),
      ]);
    })
    .then(() => {
      activeTournamentMeta.delete(tournamentId);
      activeTournamentRunners.delete(tournamentId);
    })
    .catch((err: Error) => {
      activeTournamentMeta.set(tournamentId, { currentMatch: null, error: err.message });
      activeTournamentRunners.delete(tournamentId);
      repo.updateTournamentState(tournamentId, 'FAILED').catch(() => {
        // best-effort
      });
    });
});

// GET /tournaments — list all tournaments
tournamentsRouter.get('/', async (_req: Request, res: Response) => {
  const list = await repo.listTournaments(50);
  const response = list.map((t) => {
    const meta = activeTournamentMeta.get(t.id) ?? { currentMatch: null, error: null };
    return { ...t, currentMatch: meta.currentMatch, error: meta.error };
  });
  res.json(response);
});

// GET /tournaments/:id — get tournament status
tournamentsRouter.get('/:id', async (req: Request, res: Response) => {
  const t = await repo.getTournament(String(req.params.id));
  if (!t) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }
  const meta = activeTournamentMeta.get(t.id) ?? { currentMatch: null, error: null };
  res.json({ ...t, currentMatch: meta.currentMatch, error: meta.error });
});

// POST /tournaments/:id/cancel — cancel a running tournament
tournamentsRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const t = await repo.getTournament(id);
  if (!t) { res.status(404).json({ error: 'Tournament not found' }); return; }
  if (t.state !== 'RUNNING' && t.state !== 'PENDING') {
    res.status(409).json({ error: `Tournament is ${t.state}, not running` });
    return;
  }
  // Cancel the in-memory runner if it exists (may be gone after server restart)
  const runner = activeTournamentRunners.get(id);
  if (runner) runner.cancel();
  activeTournamentRunners.delete(id);
  activeTournamentMeta.delete(id);
  await repo.updateTournamentState(id, 'FAILED').catch(() => {});
  res.json({ ok: true });
});

// DELETE /tournaments/:id — delete a tournament
tournamentsRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  // Refuse to delete an active tournament — cancel it first
  if (activeTournamentRunners.has(id)) {
    res.status(409).json({ error: 'Tournament is active — cancel it before deleting' });
    return;
  }
  const deleted = await repo.deleteTournament(id);
  if (!deleted) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }
  res.json({ ok: true });
});
