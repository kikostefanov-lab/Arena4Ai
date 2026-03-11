import { Router, type Request, type Response } from 'express';
import { repo } from '../repo.js';

export const criteriaRouter = Router();

interface CriterionScore {
  criterionId: string;
  score: number;
  commentary: string;
}

interface JudgeResult {
  judgeId: string;
  teamId: string;
  scores: CriterionScore[];
  overallScore: number;
}

interface ScoreCard {
  teamId: string;
  judgeResults: JudgeResult[];
  finalScore: number;
  rank: number;
}

/** GET /analytics/criteria */
criteriaRouter.get('/', async (_req: Request, res: Response) => {
  const allComps = await repo.list(200);
  const completedComps = allComps.filter((c) => c.state === 'COMPLETE');

  if (completedComps.length === 0) {
    res.json({ models: [], criteria: [], matrix: {} });
    return;
  }

  const resultRows = await repo.listResults(completedComps.map((c) => c.id));
  const resultMap = new Map(resultRows.map((r) => [r.competitionId, r]));

  // Build comp map for team lookup
  const compMap = new Map(completedComps.map((c) => [c.id, c]));

  // matrix: { [modelKey]: { [criterionId]: { sum: number, count: number } } }
  const accumulator = new Map<string, Map<string, { sum: number; count: number }>>();

  for (const [compId, result] of resultMap.entries()) {
    const comp = compMap.get(compId);
    if (!comp) continue;

    const teams = comp.teams as Array<{ id: string; model: string; persona?: string }>;
    const teamKeyMap = new Map(
      teams.map((t) => [t.id, t.persona ? `${t.model}:${t.persona}` : t.model])
    );
    // Also store base model for grouping
    const teamModelMap = new Map(teams.map((t) => [t.id, t.model]));

    const scorecards = result.scorecards as ScoreCard[] | null;
    if (!scorecards) continue;

    for (const sc of scorecards) {
      const modelKey = teamModelMap.get(sc.teamId) ?? teamKeyMap.get(sc.teamId);
      if (!modelKey) continue;

      // Use the first AI judge result if available, else first result
      const judgeResult = sc.judgeResults?.find((j) => j.judgeId?.startsWith('ai-'))
        ?? sc.judgeResults?.[0];
      if (!judgeResult?.scores) continue;

      if (!accumulator.has(modelKey)) {
        accumulator.set(modelKey, new Map());
      }
      const modelMap = accumulator.get(modelKey)!;

      for (const criterionScore of judgeResult.scores) {
        const cid = criterionScore.criterionId;
        if (!cid) continue;
        const existing = modelMap.get(cid) ?? { sum: 0, count: 0 };
        existing.sum += criterionScore.score;
        existing.count += 1;
        modelMap.set(cid, existing);
      }
    }
  }

  const models = Array.from(accumulator.keys()).sort();
  const criteriaSet = new Set<string>();
  for (const modelMap of accumulator.values()) {
    for (const cid of modelMap.keys()) criteriaSet.add(cid);
  }
  const criteria = Array.from(criteriaSet).sort();

  // Build output matrix
  const matrix: Record<string, Record<string, { avg: number; count: number }>> = {};
  for (const model of models) {
    matrix[model] = {};
    const modelMap = accumulator.get(model)!;
    for (const cid of criteria) {
      const entry = modelMap.get(cid);
      if (entry && entry.count > 0) {
        matrix[model][cid] = {
          avg: Number((entry.sum / entry.count).toFixed(4)),
          count: entry.count,
        };
      }
    }
  }

  res.json({ models, criteria, matrix });
});
