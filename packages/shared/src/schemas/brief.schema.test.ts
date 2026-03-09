import { describe, it, expect } from 'vitest';
import { briefSchema } from './brief.schema.js';

const validBrief = {
  id: 'brief_001',
  title: 'Architecture Decision',
  problem: 'Choose between monolith and microservices',
  constraints: ['Must deploy to single server', 'Team of 2'],
  deliverables: ['ADR document', 'Pros/cons matrix'],
  rubric: {
    criteria: [
      { id: 'clarity', description: 'Clear reasoning', weight: 0.5, maxScore: 10 },
      { id: 'depth', description: 'Technical depth', weight: 0.5, maxScore: 10 },
    ],
  },
  format: 'SPRINT',
  timeLimitMs: 900000,
};

describe('briefSchema', () => {
  it('accepts a valid brief', () => {
    const result = briefSchema.safeParse(validBrief);
    expect(result.success).toBe(true);
  });

  it('rejects a brief with weights not summing to 1', () => {
    const bad = {
      ...validBrief,
      rubric: {
        criteria: [
          { id: 'a', description: 'A', weight: 0.3, maxScore: 10 },
          { id: 'b', description: 'B', weight: 0.3, maxScore: 10 },
        ],
      },
    };
    const result = briefSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects a brief missing required fields', () => {
    const result = briefSchema.safeParse({ title: 'incomplete' });
    expect(result.success).toBe(false);
  });
});
