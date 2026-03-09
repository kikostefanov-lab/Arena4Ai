import { describe, it, expect } from 'vitest';
import { CompetitionState, VALID_TRANSITIONS } from './states.js';

describe('CompetitionState transitions', () => {
  it('allows DRAFT → CONFIGURED', () => {
    expect(VALID_TRANSITIONS[CompetitionState.DRAFT]).toContain(CompetitionState.CONFIGURED);
  });

  it('does not allow COMPLETE → DRAFT', () => {
    expect(VALID_TRANSITIONS[CompetitionState.COMPLETE] ?? []).not.toContain(CompetitionState.DRAFT);
  });

  it('defines all 10 states', () => {
    const states = Object.values(CompetitionState);
    expect(states).toHaveLength(10);
  });

  it('allows SCORED → SYNTHESIZING → COMPLETE', () => {
    expect(VALID_TRANSITIONS[CompetitionState.SCORED]).toContain(CompetitionState.SYNTHESIZING);
    expect(VALID_TRANSITIONS[CompetitionState.SYNTHESIZING]).toContain(CompetitionState.COMPLETE);
  });

  it('does not allow SCORED → COMPLETE directly', () => {
    expect(VALID_TRANSITIONS[CompetitionState.SCORED]).not.toContain(CompetitionState.COMPLETE);
  });
});
