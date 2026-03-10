import { describe, it, expect } from 'vitest';
import { transition } from './state-machine.js';
import { CompetitionState } from '@arena/shared';

describe('transition()', () => {
  it('advances along the happy path', () => {
    const path: [CompetitionState, CompetitionState][] = [
      [CompetitionState.DRAFT, CompetitionState.CONFIGURED],
      [CompetitionState.CONFIGURED, CompetitionState.LAUNCHING],
      [CompetitionState.LAUNCHING, CompetitionState.RUNNING],
      [CompetitionState.RUNNING, CompetitionState.TIME_UP],
      [CompetitionState.TIME_UP, CompetitionState.COLLECTING],
      [CompetitionState.COLLECTING, CompetitionState.PRESENTING],
      [CompetitionState.PRESENTING, CompetitionState.JUDGING],
      [CompetitionState.JUDGING, CompetitionState.SCORED],
      [CompetitionState.SCORED, CompetitionState.SYNTHESIZING],
      [CompetitionState.SYNTHESIZING, CompetitionState.COMPLETE],
    ];
    for (const [from, to] of path) {
      expect(transition(from, to)).toBe(to);
    }
  });

  it('throws on an invalid transition', () => {
    expect(() => transition(CompetitionState.DRAFT, CompetitionState.RUNNING)).toThrow(
      /invalid transition/i,
    );
  });

  it('allows COMPLETE → FORGING (human-triggered forge)', () => {
    expect(transition(CompetitionState.COMPLETE, CompetitionState.FORGING)).toBe(CompetitionState.FORGING);
  });

  it('throws when trying to go COMPLETE → DRAFT', () => {
    expect(() => transition(CompetitionState.COMPLETE, CompetitionState.DRAFT)).toThrow(
      /invalid transition/i,
    );
  });

  it('throws when from === to (no self-loop allowed)', () => {
    expect(() => transition(CompetitionState.RUNNING, CompetitionState.RUNNING)).toThrow(
      /invalid transition/i,
    );
  });
});
