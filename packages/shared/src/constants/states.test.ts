import { describe, it, expect } from 'vitest';
import { CompetitionState, VALID_TRANSITIONS } from './states.js';

describe('CompetitionState transitions', () => {
  it('allows DRAFT → CONFIGURED', () => {
    expect(VALID_TRANSITIONS[CompetitionState.DRAFT]).toContain(CompetitionState.CONFIGURED);
  });

  it('does not allow COMPLETE → DRAFT', () => {
    expect(VALID_TRANSITIONS[CompetitionState.COMPLETE] ?? []).not.toContain(CompetitionState.DRAFT);
  });

  it('defines all 9 states', () => {
    const states = Object.values(CompetitionState);
    expect(states).toHaveLength(9);
  });
});
