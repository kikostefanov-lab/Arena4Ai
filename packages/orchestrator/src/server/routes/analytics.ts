import { Router, type Request, type Response } from 'express';
import { repo } from '../repo.js';
import { computeWinRate, computeCompletionRate, computeAvgDurationMs } from '../../analytics/stats-aggregator.js';

export const analyticsRouter = Router();

analyticsRouter.get('/summary', async (_req: Request, res: Response) => {
  const competitions = await repo.list(200);

  const results = await Promise.all(
    competitions
      .filter((c) => c.state === 'COMPLETE')
      .map((c) => repo.getResult(c.id)),
  );
  const validResults = results.filter(Boolean) as Array<{
    competitionId: string;
    winnerId: string | null;
    scorecards: unknown[];
    summary: string | null;
    synthesis: string | null;
  }>;

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

  res.json({
    totalCompetitions: competitions.length,
    completedCompetitions: competitions.filter((c) => c.state === 'COMPLETE').length,
    completionRate: Number(completionRate.toFixed(3)),
    avgDurationMs,
    byModel: modelStats,
    synthesisCount: validResults.filter((r) => r.synthesis).length,
  });
});
