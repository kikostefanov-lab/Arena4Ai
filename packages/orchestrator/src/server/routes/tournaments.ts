import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { TournamentRunner } from '../../engine/tournament-runner.js';
import type { TournamentRanking } from '../../engine/tournament-runner.js';
import { TournamentRepository } from '../../db/repository.js';
import { db } from '../../db/client.js';

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
  teams: z.array(z.string()).min(2).max(4),
  options: z.object({
    skipSandbox: z.boolean().optional(),
    skipSynthesis: z.boolean().optional(),
  }).optional(),
});

// Runtime-only fields not persisted to DB
interface ActiveMeta {
  currentMatch: { teamA: string; teamB: string } | null;
  error: string | null;
}

const activeTournamentMeta = new Map<string, ActiveMeta>();

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

  // Local accumulator for matchIds (matchEnd event doesn't carry competitionId)
  const accumulatedMatchIds: string[] = [];

  runner.on('matchStart', ({ teamA, teamB }: { teamA: string; teamB: string }) => {
    const meta = activeTournamentMeta.get(tournamentId);
    if (meta) meta.currentMatch = { teamA, teamB };
  });

  runner.on('matchEnd', (_payload: unknown) => {
    const meta = activeTournamentMeta.get(tournamentId);
    if (meta) meta.currentMatch = null;
    // Update progress in DB after each match (matchIds accumulated via run().then)
    // We update with whatever has been pushed to accumulatedMatchIds so far
    repo.updateTournamentProgress(tournamentId, [...accumulatedMatchIds], null).catch(() => {
      // best-effort update
    });
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
    })
    .catch((err: Error) => {
      activeTournamentMeta.set(tournamentId, { currentMatch: null, error: err.message });
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
