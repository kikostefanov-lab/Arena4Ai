import { z } from 'zod';
import { CompetitionFormat } from '../constants/formats.js';

const rubricCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  weight: z.number().min(0).max(1),
  maxScore: z.number().positive(),
});

const rubricSchema = z.object({
  criteria: z.array(rubricCriterionSchema).min(1),
}).refine(
  (r) => Math.abs(r.criteria.reduce((sum, c) => sum + c.weight, 0) - 1) < 0.001,
  { message: 'Rubric criterion weights must sum to 1' }
);

export const briefSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  problem: z.string().min(1),
  constraints: z.array(z.string()),
  deliverables: z.array(z.string()).min(1),
  rubric: rubricSchema,
  format: z.nativeEnum(CompetitionFormat),
  timeLimitMs: z.number().positive(),
});

export type BriefInput = z.infer<typeof briefSchema>;
