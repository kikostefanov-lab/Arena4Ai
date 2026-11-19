import { describe, it, expect } from 'vitest';
import { isHeuristicScore } from './scoring.js';

describe('isHeuristicScore()', () => {
  it('reads the explicit flag', () => {
    expect(isHeuristicScore([{ judgeId: 'x', heuristic: true }])).toBe(true);
  });
  it('recognises results stored before the flag existed by their judge id', () => {
    expect(isHeuristicScore([{ judgeId: 'automated' }])).toBe(true);
  });
  it('is false for AI-judged results and for missing data', () => {
    expect(isHeuristicScore([{ judgeId: 'ai-claude/claude-opus-5' }])).toBe(false);
    expect(isHeuristicScore([])).toBe(false);
    expect(isHeuristicScore(undefined)).toBe(false);
  });
});
