import { describe, it, expect } from 'vitest';
import { stageTimeoutMs } from '../stage-timeout.js';

describe('stageTimeoutMs', () => {
  it('is the 2 minute base for no input', () => {
    expect(stageTimeoutMs(0)).toBe(120_000);
  });
  it('adds a second per 2000 characters', () => {
    expect(stageTimeoutMs(240_000)).toBe(240_000);
  });
  it('caps at 10 minutes', () => {
    expect(stageTimeoutMs(5_000_000)).toBe(600_000);
  });
});
