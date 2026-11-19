import { describe, it, expect } from 'vitest';
import { teamDisplayName } from './team-name.js';

describe('teamDisplayName', () => {
  it('joins model and persona', () => expect(teamDisplayName('claude', 'architect')).toBe('claude:architect'));
  it('does not double a persona already in the model', () =>
    expect(teamDisplayName('claude:architect', 'architect')).toBe('claude:architect'));
  it('returns the model when there is no persona', () => {
    expect(teamDisplayName('codex', undefined)).toBe('codex');
    expect(teamDisplayName('codex', '')).toBe('codex');
  });
  it('compares case-insensitively', () =>
    expect(teamDisplayName('gemini:speedrunner', 'SPEEDRUNNER')).toBe('gemini:speedrunner'));
  it('keeps a different persona', () =>
    expect(teamDisplayName('claude:architect', 'speedrunner')).toBe('claude:architect:speedrunner'));
});
