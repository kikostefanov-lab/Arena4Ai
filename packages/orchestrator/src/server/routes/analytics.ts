import { Router, type Request, type Response } from 'express';
import { repo } from '../repo.js';
import { computeWinRate, computeCompletionRate, computeAvgDurationMs } from '../../analytics/stats-aggregator.js';

export const analyticsRouter = Router();

analyticsRouter.get('/summary', async (_req: Request, res: Response) => {
  const competitions = await repo.list(200);
  const completedComps = competitions.filter((c) => c.state === 'COMPLETE');

  const validResults = await repo.listResults(completedComps.map((c) => c.id));

  const winRates = computeWinRate(competitions as never, validResults as never);
  const completionRate = computeCompletionRate(competitions as never);
  const avgDurationMs = computeAvgDurationMs(competitions as never);

  const modelStats = Object.entries(winRates)
    .map(([model, { wins, total }]) => ({
      model,
      wins,
      total,
      winRate: total > 0 ? Number((wins / total).toFixed(3)) : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate);

  // resultMap for O(1) lookup
  const resultMap = new Map(validResults.map((r) => [r.competitionId, r]));

  // byFormat: per-format aggregates
  const formatMap = new Map<string, { total: number; completed: number; durations: number[] }>();
  for (const comp of competitions) {
    const brief = comp.brief as Record<string, unknown>;
    const format = typeof brief.format === 'string' ? brief.format : 'UNKNOWN';
    if (!formatMap.has(format)) {
      formatMap.set(format, { total: 0, completed: 0, durations: [] });
    }
    const entry = formatMap.get(format)!;
    entry.total += 1;
    if (comp.state === 'COMPLETE') {
      entry.completed += 1;
      if (comp.startedAt && comp.completedAt) {
        const duration =
          (comp.completedAt as unknown as Date).getTime() -
          (comp.startedAt as unknown as Date).getTime();
        if (!isNaN(duration) && duration > 0) {
          entry.durations.push(duration);
        }
      }
    }
  }
  const byFormat = Array.from(formatMap.entries()).map(([format, { total, completed, durations }]) => ({
    format,
    total,
    completed,
    avgDurationMs:
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
  }));

  // headToHead: W/L matrix between personas
  const headToHead: Record<string, Record<string, { wins: number; losses: number; draws: number }>> = {};

  const ensureCell = (a: string, b: string) => {
    if (!headToHead[a]) headToHead[a] = {};
    if (!headToHead[a][b]) headToHead[a][b] = { wins: 0, losses: 0, draws: 0 };
  };

  for (const comp of completedComps) {
    const teams = comp.teams as Array<{ id: string; model: string; persona?: string }>;
    if (!teams || teams.length < 2) continue;

    const result = resultMap.get(comp.id);

    const labelOf = (t: { model: string; persona?: string }) =>
      t.persona ? `${t.model}:${t.persona}` : t.model;

    const [teamA, teamB] = teams;
    const labelA = labelOf(teamA);
    const labelB = labelOf(teamB);

    ensureCell(labelA, labelB);
    ensureCell(labelB, labelA);

    if (!result) continue;

    if (result.winnerId === teamA.id) {
      headToHead[labelA][labelB].wins += 1;
      headToHead[labelB][labelA].losses += 1;
    } else if (result.winnerId === teamB.id) {
      headToHead[labelB][labelA].wins += 1;
      headToHead[labelA][labelB].losses += 1;
    } else {
      headToHead[labelA][labelB].draws += 1;
      headToHead[labelB][labelA].draws += 1;
    }
  }

  // recentCompetitions: last 10 completed competitions
  const recentCompetitions = completedComps.slice(0, 10).map((comp) => {
    const brief = comp.brief as Record<string, unknown>;
    const teams = comp.teams as Array<{ id: string; model: string; persona?: string }>;
    const result = resultMap.get(comp.id);

    const agents = (teams ?? []).map((t) =>
      t.persona ? `${t.model}:${t.persona}` : t.model
    );

    let winner: string | null = null;
    if (result?.winnerId) {
      const winningTeam = (teams ?? []).find((t) => t.id === result.winnerId);
      if (winningTeam) {
        winner = winningTeam.persona
          ? `${winningTeam.model}:${winningTeam.persona}`
          : winningTeam.model;
      }
    }

    let durationMs: number | null = null;
    if (comp.startedAt && comp.completedAt) {
      const d =
        (comp.completedAt as unknown as Date).getTime() -
        (comp.startedAt as unknown as Date).getTime();
      if (!isNaN(d) && d > 0) durationMs = d;
    }

    return {
      id: comp.id,
      title: typeof brief.title === 'string' ? brief.title : comp.id,
      format: typeof brief.format === 'string' ? brief.format : null,
      agents,
      winner,
      durationMs,
    };
  });

  res.json({
    totalCompetitions: competitions.length,
    completedCompetitions: completedComps.length,
    completionRate: Number(completionRate.toFixed(3)),
    avgDurationMs,
    byModel: modelStats,
    synthesisCount: validResults.filter((r) => r.synthesis).length,
    byFormat,
    headToHead,
    recentCompetitions,
  });
});
