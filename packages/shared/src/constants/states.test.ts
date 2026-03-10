import { describe, it, expect } from 'vitest';
import { CompetitionState, VALID_TRANSITIONS } from './states.js';

describe('CompetitionState transitions', () => {
  it('allows DRAFT → CONFIGURED', () => {
    expect(VALID_TRANSITIONS[CompetitionState.DRAFT]).toContain(CompetitionState.CONFIGURED);
  });

  it('does not allow FORGE_COMPLETE → DRAFT', () => {
    expect(VALID_TRANSITIONS[CompetitionState.FORGE_COMPLETE] ?? []).not.toContain(CompetitionState.DRAFT);
  });

  it('defines all states', () => {
    const states = Object.values(CompetitionState);
    expect(states).toHaveLength(15);
  });

  it('allows COLLECTING → PRESENTING → JUDGING', () => {
    expect(VALID_TRANSITIONS[CompetitionState.COLLECTING]).toContain(CompetitionState.PRESENTING);
    expect(VALID_TRANSITIONS[CompetitionState.PRESENTING]).toContain(CompetitionState.JUDGING);
  });

  it('allows SCORED → SYNTHESIZING → COMPLETE', () => {
    expect(VALID_TRANSITIONS[CompetitionState.SCORED]).toContain(CompetitionState.SYNTHESIZING);
    expect(VALID_TRANSITIONS[CompetitionState.SYNTHESIZING]).toContain(CompetitionState.COMPLETE);
  });

  it('allows COMPLETE → FORGING → FORGE_COMPLETE', () => {
    expect(VALID_TRANSITIONS[CompetitionState.COMPLETE]).toContain(CompetitionState.FORGING);
    expect(VALID_TRANSITIONS[CompetitionState.FORGING]).toContain(CompetitionState.FORGE_COMPLETE);
  });

  it('does not allow SCORED → COMPLETE directly', () => {
    expect(VALID_TRANSITIONS[CompetitionState.SCORED]).not.toContain(CompetitionState.COMPLETE);
  });
});
