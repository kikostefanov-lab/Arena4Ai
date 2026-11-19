/**
 * GET /analytics/criteria averages each team's criterion scores across its AI
 * judges: a panel match must not count only its first judge.
 */
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../repo.js', () => ({
  repo: {
    list: vi.fn().mockResolvedValue([
      { id: 'c1', state: 'COMPLETE', brief: {}, teams: [{ id: 'team-a', model: 'claude' }, { id: 'team-b', model: 'codex' }] },
    ]),
    listResults: vi.fn().mockResolvedValue([{
      competitionId: 'c1',
      scorecards: [
        {
          teamId: 'team-a', finalScore: 0.7, rank: 1,
          judgeResults: [
            { judgeId: 'ai-claude/m1', teamId: 'team-a', overallScore: 0.9, scores: [{ criterionId: 'q', score: 9, commentary: '' }] },
            { judgeId: 'ai-codex/m2', teamId: 'team-a', overallScore: 0.5, scores: [{ criterionId: 'q', score: 5, commentary: '' }] },
          ],
        },
        {
          teamId: 'team-b', finalScore: 0.3, rank: 2,
          judgeResults: [{ judgeId: 'automated', teamId: 'team-b', overallScore: 0.3, heuristic: true, scores: [{ criterionId: 'q', score: 3, commentary: '' }] }],
        },
      ],
    }]),
  },
}));

import { criteriaRouter } from '../routes/criteria.js';

describe('GET /analytics/criteria', () => {
  it('uses the mean across a team\'s AI judges, and the heuristic only when no AI judge scored', async () => {
    const app = express().use('/analytics/criteria', criteriaRouter);
    const res = await request(app).get('/analytics/criteria');
    expect(res.status).toBe(200);
    expect(res.body.matrix.claude.q.avg).toBe(7);
    expect(res.body.matrix.codex.q.avg).toBe(3);
  });
});
