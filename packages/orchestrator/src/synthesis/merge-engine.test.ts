import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { synthesizeDeliverables } from './merge-engine.js';
import type { Deliverable, BriefInput } from '@arena/shared';
import { CompetitionFormat } from '@arena/shared';

const MOCK_JSON_RESPONSE = JSON.stringify({
  overallRationale: 'Combines Team A correctness with Team B style.',
  perCriterion: [
    {
      criterionId: 'correctness',
      teamId: 'team-a',
      rationale: 'Team A had the correct output.',
      winningApproach: 'Team A produced a simple, correct hello world using standard print.',
      losingApproach: 'Team B added unnecessary formatting.',
    },
  ],
  synthesis: '# Synthesis\n\nBest of both teams combined.',
});

// Mock child_process.spawn so tests don't actually call Claude
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    // Simulate successful Claude response with structured JSON
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(MOCK_JSON_RESPONSE));
      child.emit('close', 0);
    }, 10);
    return child;
  }),
}));

const mockBrief: BriefInput = {
  id: 'test-brief',
  title: 'Test Brief',
  format: CompetitionFormat.SPRINT,
  problem: 'Write a hello world program',
  constraints: [],
  deliverables: ['solution.py'],
  timeLimitMs: 60000,
  rubric: {
    criteria: [{ id: 'correctness', description: 'Correct', weight: 1, maxScore: 10 }],
  },
};

const teamA: Deliverable = {
  teamId: 'team-a',
  files: [{ path: 'solution.py', content: 'print("Hello, World!")' }],
  collectedAt: new Date().toISOString(),
};

const teamB: Deliverable = {
  teamId: 'team-b',
  files: [{ path: 'solution.py', content: 'print("Hello from Team B!")' }],
  collectedAt: new Date().toISOString(),
};

describe('synthesizeDeliverables', () => {
  it('returns a SynthesisResult with synthesis string and perCriterion array when deliverables exist', async () => {
    const result = await synthesizeDeliverables(mockBrief, [teamA, teamB], {});
    expect(result).not.toBeNull();
    expect(typeof result!.synthesis).toBe('string');
    expect(result!.synthesis.length).toBeGreaterThan(0);
    expect(Array.isArray(result!.perCriterion)).toBe(true);
  });

  it('returns perCriterion entries with enriched shape', async () => {
    const result = await synthesizeDeliverables(mockBrief, [teamA, teamB], {});
    expect(result).not.toBeNull();
    expect(result!.perCriterion.length).toBeGreaterThan(0);
    const entry = result!.perCriterion[0];
    expect(typeof entry.criterionId).toBe('string');
    expect(typeof entry.teamId).toBe('string');
    expect(typeof entry.rationale).toBe('string');
    expect(typeof entry.winningApproach).toBe('string');
    expect(typeof entry.losingApproach).toBe('string');
  });

  it('returns overallRationale', async () => {
    const result = await synthesizeDeliverables(mockBrief, [teamA, teamB], {});
    expect(result).not.toBeNull();
    expect(typeof result!.overallRationale).toBe('string');
    expect(result!.overallRationale.length).toBeGreaterThan(0);
  });

  it('returns null when no deliverables provided', async () => {
    const result = await synthesizeDeliverables(mockBrief, [], {});
    expect(result).toBeNull();
  });
});
