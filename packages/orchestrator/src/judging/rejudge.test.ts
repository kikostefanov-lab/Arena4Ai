import { describe, it, expect, vi } from 'vitest';
import { CompetitionFormat } from '@arena/shared';
import type { Brief, Deliverable } from '@arena/shared';
import type { AiJudgeResult } from './ai-judge.js';
import { rejudge } from './rejudge.js';

const brief: Brief = {
  id: 'b', title: 'T', problem: 'P', constraints: [], deliverables: [],
  rubric: { criteria: [{ id: 'c', description: 'C', weight: 1, maxScore: 10 }] },
  format: CompetitionFormat.SPRINT, timeLimitMs: 1000,
};
const deliverable = (teamId: string): Deliverable => ({ teamId, files: [], collectedAt: 'now' });

const ok = (teamId: string, judgeId: string, overall: number): AiJudgeResult => ({
  judgeId, teamId, model: 'm', scores: [{ criterionId: 'c', score: overall * 10, commentary: '' }], overallScore: overall,
});
const failed = (teamId: string, judgeId: string): AiJudgeResult => ({
  judgeId, teamId, model: 'm',
  scores: [{ criterionId: 'c', score: 0, commentary: 'x' }], overallScore: 0,
  failure: { kind: 'rate-limit', message: 'rate limited by the claude API' },
});

type JudgeFn = (b: Brief, d: Deliverable, r: unknown, o: { judgeId: string }) => Promise<AiJudgeResult>;
const run = (judge: JudgeFn, teams: string[], adversarial: boolean) =>
  rejudge(brief, teams.map(deliverable), { adversarial, judge: vi.fn(judge) as never });

describe('rejudge', () => {
  it('reports failure and returns no scorecards when ANY team judge failed', async () => {
    const out = await run(async (_b, d, _r, o) =>
      d.teamId === 'b' ? failed('b', o.judgeId) : ok('a', o.judgeId, 0.9), ['a', 'b'], false);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toContain('rate limited');
    expect(out.failures).toEqual([expect.objectContaining({ teamId: 'b', kind: 'rate-limit' })]);
  });

  it('fails when only the adversarial judge failed', async () => {
    const out = await run(async (_b, d, _r, o) =>
      o.judgeId.includes('adversarial') ? failed(d.teamId, o.judgeId) : ok(d.teamId, o.judgeId, 0.8), ['a'], true);
    expect(out.ok).toBe(false);
  });

  it('on success ranks scorecards and picks the winner via shared logic', async () => {
    const out = await run(async (_b, d, _r, o) =>
      ok(d.teamId, o.judgeId, d.teamId === 'a' ? 0.9 : 0.5), ['b', 'a'], false);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.winnerId).toBe('a');
    expect(out.scorecards.map((s) => [s.teamId, s.rank])).toEqual([['a', 1], ['b', 2]]);
  });

  it('records a draw instead of picking the first team when scores tie', async () => {
    const out = await run(async (_b, d, _r, o) => ok(d.teamId, o.judgeId, 0.7), ['a', 'b'], false);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.winnerId).toBeNull();
    expect([...out.tiedTeamIds].sort()).toEqual(['a', 'b']);
    expect(out.scorecards.every((s) => s.rank === 1)).toBe(true);
  });
});
