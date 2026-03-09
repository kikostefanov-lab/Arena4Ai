import { describe, it, expect } from 'vitest';
import { PRESETS, applyPreset } from './presets.js';
import { CompetitionFormat } from '@arena/shared';

describe('PRESETS', () => {
  it('SPRINT preset has a 15-minute time limit', () => {
    expect(PRESETS[CompetitionFormat.SPRINT].timeLimitMs).toBe(15 * 60 * 1000);
  });

  it('HACKATHON preset has a 2-hour time limit', () => {
    expect(PRESETS[CompetitionFormat.HACKATHON].timeLimitMs).toBe(2 * 60 * 60 * 1000);
  });

  it('every preset has at least one rubric criterion', () => {
    for (const [, preset] of Object.entries(PRESETS)) {
      expect(preset.rubric.criteria.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every preset rubric weights sum to 1', () => {
    for (const [format, preset] of Object.entries(PRESETS)) {
      const total = preset.rubric.criteria.reduce((s, c) => s + c.weight, 0);
      expect(total, `${format} weights should sum to 1`).toBeCloseTo(1, 3);
    }
  });
});

describe('applyPreset()', () => {
  it('merges preset defaults under user-supplied fields', () => {
    const partial = {
      id: 'my-sprint',
      title: 'My Sprint',
      problem: 'Solve this problem.',
      deliverables: ['solution.ts'],
    };
    const result = applyPreset(CompetitionFormat.SPRINT, partial);
    expect(result.id).toBe('my-sprint');
    expect(result.format).toBe(CompetitionFormat.SPRINT);
    expect(result.timeLimitMs).toBe(15 * 60 * 1000);
    expect(result.rubric.criteria.length).toBeGreaterThanOrEqual(1);
  });

  it('allows user to override preset timeLimitMs', () => {
    const partial = {
      id: 'custom',
      title: 'Custom',
      problem: 'A problem.',
      deliverables: ['out.md'],
      timeLimitMs: 999_000,
    };
    const result = applyPreset(CompetitionFormat.SPRINT, partial);
    expect(result.timeLimitMs).toBe(999_000);
  });

  it('throws for an unknown format', () => {
    expect(() => applyPreset('UNKNOWN_FORMAT' as CompetitionFormat, {})).toThrow(
      /unknown format/i,
    );
  });
});
