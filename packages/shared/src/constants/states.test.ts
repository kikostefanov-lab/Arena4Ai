import { describe, it, expect } from 'vitest';
import { CompetitionState, VALID_TRANSITIONS, FINISHED_STATES, isFinishedState } from './states.js';

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

  it('allows SCORED → COMPLETE directly (synthesis is now on-demand)', () => {
    expect(VALID_TRANSITIONS[CompetitionState.SCORED]).toContain(CompetitionState.COMPLETE);
  });

  it('still allows SCORED → SYNTHESIZING → COMPLETE for legacy compatibility', () => {
    expect(VALID_TRANSITIONS[CompetitionState.SCORED]).toContain(CompetitionState.SYNTHESIZING);
    expect(VALID_TRANSITIONS[CompetitionState.SYNTHESIZING]).toContain(CompetitionState.COMPLETE);
  });

  it('allows COMPLETE → FORGING → FORGE_COMPLETE', () => {
    expect(VALID_TRANSITIONS[CompetitionState.COMPLETE]).toContain(CompetitionState.FORGING);
    expect(VALID_TRANSITIONS[CompetitionState.FORGING]).toContain(CompetitionState.FORGE_COMPLETE);
  });
});

describe('FINISHED_STATES', () => {
  it('includes every state at or after judging that has a result', () => {
    for (const s of ['SCORED', 'SYNTHESIZING', 'COMPLETE', 'FORGING', 'FORGE_COMPLETE']) {
      expect(isFinishedState(s)).toBe(true);
    }
  });
  it('excludes in-flight and failed states', () => {
    for (const s of ['DRAFT', 'RUNNING', 'JUDGING', 'FAILED', 'CANCELLED', 'nonsense']) {
      expect(isFinishedState(s)).toBe(false);
    }
    expect(FINISHED_STATES.has(CompetitionState.FAILED)).toBe(false);
  });
});
