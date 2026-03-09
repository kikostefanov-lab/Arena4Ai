import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { synthesizeDeliverables } from './merge-engine.js';
import type { Deliverable, BriefInput } from '@arena/shared';
import { CompetitionFormat } from '@arena/shared';

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
    // Simulate successful Claude response
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from('# Synthesis\n\nBest of both teams combined.'));
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
  it('returns a non-empty string when deliverables exist', async () => {
    const result = await synthesizeDeliverables(mockBrief, [teamA, teamB], {});
    expect(typeof result).toBe('string');
    expect(result!.length).toBeGreaterThan(0);
  });

  it('returns null when no deliverables provided', async () => {
    const result = await synthesizeDeliverables(mockBrief, [], {});
    expect(result).toBeNull();
  });
});
