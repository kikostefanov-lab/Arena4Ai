import { Router, type Request, type Response } from 'express';
import { repo } from '../repo.js';

export const compareRouter = Router();

/** GET /compare?modelA=claude:architect&modelB=codex:standard */
compareRouter.get('/', async (req: Request, res: Response) => {
  const modelA = typeof req.query.modelA === 'string' ? req.query.modelA.trim() : '';
  const modelB = typeof req.query.modelB === 'string' ? req.query.modelB.trim() : '';

  if (!modelA || !modelB) {
    res.status(400).json({ error: 'modelA and modelB query params are required' });
    return;
  }

  // List all competitions (last 200) and filter to those completed with both models
  const allComps = await repo.list(200);
  const completedComps = allComps.filter((c) => c.state === 'COMPLETE');

  // Resolve team model key — "model:persona" or just "model"
  const teamKey = (t: { model: string; persona?: string }) =>
    t.persona ? `${t.model}:${t.persona}` : t.model;

  // Filter competitions involving both modelA and modelB
  const relevant = completedComps.filter((c) => {
    const teams = c.teams as Array<{ id: string; model: string; persona?: string }>;
    if (!teams || teams.length < 2) return false;
    const keys = teams.map(teamKey);
    return keys.includes(modelA) && keys.includes(modelB);
  });

  if (relevant.length === 0) {
    res.json({
      matchups: 0,
      modelA: { key: modelA, wins: 0, losses: 0, draws: 0, avgScore: null },
      modelB: { key: modelB, wins: 0, losses: 0, draws: 0, avgScore: null },
      recentMatches: [],
    });
    return;
  }

  const resultRows = await repo.listResults(relevant.map((c) => c.id));
  const resultMap = new Map(resultRows.map((r) => [r.competitionId, r]));

  let aWins = 0, aLosses = 0, aDraws = 0;
  let bWins = 0, bLosses = 0, bDraws = 0;
  const aScores: number[] = [];
  const bScores: number[] = [];

  const recentMatches: Array<{
    id: string;
    title: string;
    winner: string | null;
    modelAScore: number | null;
    modelBScore: number | null;
    completedAt: string | null;
  }> = [];

  for (const comp of relevant) {
    const teams = comp.teams as Array<{ id: string; model: string; persona?: string }>;
    const teamA = teams.find((t) => teamKey(t) === modelA);
    const teamB = teams.find((t) => teamKey(t) === modelB);
    if (!teamA || !teamB) continue;

    const result = resultMap.get(comp.id);
    const brief = comp.brief as Record<string, unknown>;
    const title = typeof brief.title === 'string' ? brief.title : comp.id;

    let winnerKey: string | null = null;
    let modelAScore: number | null = null;
    let modelBScore: number | null = null;

    if (result) {
      const scorecards = result.scorecards as Array<{ teamId: string; finalScore: number }> | null;
      if (scorecards) {
        const scA = scorecards.find((s) => s.teamId === teamA.id);
        const scB = scorecards.find((s) => s.teamId === teamB.id);
        if (scA != null) { modelAScore = scA.finalScore; aScores.push(scA.finalScore); }
        if (scB != null) { modelBScore = scB.finalScore; bScores.push(scB.finalScore); }
      }

      if (result.winnerId === teamA.id) {
        aWins++; bLosses++;
        winnerKey = modelA;
      } else if (result.winnerId === teamB.id) {
        bWins++; aLosses++;
        winnerKey = modelB;
      } else {
        aDraws++; bDraws++;
      }
    }

    recentMatches.push({
      id: comp.id,
      title,
      winner: winnerKey,
      modelAScore,
      modelBScore,
      completedAt: comp.completedAt ? (comp.completedAt as unknown as Date).toISOString() : null,
    });
  }

  const avgScore = (scores: number[]) =>
    scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4)) : null;

  res.json({
    matchups: relevant.length,
    modelA: {
      key: modelA,
      wins: aWins,
      losses: aLosses,
      draws: aDraws,
      avgScore: avgScore(aScores),
    },
    modelB: {
      key: modelB,
      wins: bWins,
      losses: bLosses,
      draws: bDraws,
      avgScore: avgScore(bScores),
    },
    recentMatches: recentMatches.slice(0, 20),
  });
});
