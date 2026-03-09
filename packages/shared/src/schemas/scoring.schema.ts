import { z } from 'zod';

export const criterionScoreSchema = z.object({
  criterionId: z.string().min(1),
  score: z.number().min(0),
  commentary: z.string(),
});

export const judgeResultSchema = z.object({
  judgeId: z.string().min(1),
  teamId: z.string().min(1),
  scores: z.array(criterionScoreSchema).min(1),
  overallScore: z.number().min(0),
});
