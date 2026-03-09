import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { CompetitionState, CompetitionFormat } from '@arena/shared';
import type { Brief, Deliverable } from '@arena/shared';

// ── Mocks (all hoisted by Vitest) ───────────────────────────────────────────

// Mock node:fs/promises (mkdtemp)
vi.mock('node:fs/promises', () => ({
  mkdtemp: vi.fn().mockResolvedValue('/tmp/arena-test-workdir'),
}));

// Mock node:os (tmpdir)
vi.mock('node:os', () => ({
  tmpdir: vi.fn().mockReturnValue('/tmp'),
}));

// Mock SandboxManager
vi.mock('../sandbox/sandbox-manager.js', () => ({
  SandboxManager: vi.fn().mockImplementation(() => ({
    verify: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock EventLogger
vi.mock('../events/event-logger.js', () => ({
  EventLogger: vi.fn().mockImplementation(() => ({
    open: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock rubric-scorer
vi.mock('../judging/rubric-scorer.js', () => ({
  scoreDeliverable: vi.fn().mockResolvedValue({
    judgeId: 'automated',
    teamId: 'team-a',
    scores: [{ criterionId: 'correctness', score: 8 }],
  }),
}));

// Mock ai-judge
vi.mock('../judging/ai-judge.js', () => ({
  aiJudge: vi.fn().mockResolvedValue({
    judgeId: 'ai-claude',
    teamId: 'team-a',
    scores: [{ criterionId: 'correctness', score: 9 }],
  }),
  JUDGE_IDS: { automated: 'automated', aiClaude: 'ai-claude' },
}));

// Mock score-aggregator
vi.mock('../judging/score-aggregator.js', () => ({
  aggregate: vi.fn().mockReturnValue([
    { teamId: 'team-a', rank: 1, totalScore: 8.5, criteriaScores: {} },
    { teamId: 'team-b', rank: 2, totalScore: 7.0, criteriaScores: {} },
  ]),
}));

// Mock results-reporter
vi.mock('../judging/results-reporter.js', () => ({
  printResults: vi.fn(),
}));

// Mock claude-personas
vi.mock('../adapters/claude/claude-personas.js', () => ({
  resolvePersona: vi.fn().mockReturnValue({ systemPrompt: 'Be helpful.' }),
}));

// Mock synthesizeDeliverables
vi.mock('../synthesis/merge-engine.js', () => ({
  synthesizeDeliverables: vi.fn().mockResolvedValue('# Synthesis\n\nBest of both.'),
}));

// ── Fake adapter ─────────────────────────────────────────────────────────────

class FakeAdapter extends EventEmitter {
  readonly teamId: string;
  readonly done: Promise<void>;
  private _resolveDone!: () => void;

  injectBrief = vi.fn().mockResolvedValue(undefined);
  startExecution: ReturnType<typeof vi.fn>;
  collectDeliverables: ReturnType<typeof vi.fn>;
  shutdown = vi.fn().mockResolvedValue(undefined);
  on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    return super.on(event, listener);
  });

  constructor(teamId: string) {
    super();
    this.teamId = teamId;
    this.done = new Promise<void>((resolve) => {
      this._resolveDone = resolve;
    });
    this.startExecution = vi.fn().mockImplementation(() => {
      // Resolve done immediately so the race finishes
      this._resolveDone();
      return Promise.resolve();
    });
    this.collectDeliverables = vi.fn().mockResolvedValue({
      teamId: this.teamId,
      files: [{ path: 'solution.py', content: 'print("hello")' }],
      collectedAt: new Date().toISOString(),
    } as Deliverable);
  }
}

// Mock all three adapters
vi.mock('../adapters/claude/claude-adapter.js', () => ({
  ClaudeAdapter: vi.fn().mockImplementation((teamId: string) => new FakeAdapter(teamId)),
}));
vi.mock('../adapters/codex/codex-adapter.js', () => ({
  CodexAdapter: vi.fn().mockImplementation((teamId: string) => new FakeAdapter(teamId)),
}));
vi.mock('../adapters/gemini/gemini-adapter.js', () => ({
  GeminiAdapter: vi.fn().mockImplementation((teamId: string) => new FakeAdapter(teamId)),
}));

// ── Import the real runner (after mocks) ─────────────────────────────────────

import { CompetitionRunner } from './competition-runner.js';
import { synthesizeDeliverables } from '../synthesis/merge-engine.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const testBrief: Brief = {
  id: 'test-001',
  title: 'Test Competition',
  format: CompetitionFormat.SPRINT,
  problem: 'Write a fizzbuzz solution',
  constraints: ['Must be correct'],
  deliverables: ['solution.py'],
  timeLimitMs: 5000,
  rubric: {
    criteria: [{ id: 'correctness', description: 'Is it correct?', maxScore: 10, weight: 1 }],
  },
};

const testTeams: [{ id: string; model: string; persona: string }, { id: string; model: string; persona: string }] = [
  { id: 'team-a', model: 'claude:architect', persona: 'architect' },
  { id: 'team-b', model: 'claude:speedrunner', persona: 'speedrunner' },
];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('CompetitionRunner', () => {
  let runner: CompetitionRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new CompetitionRunner(testBrief, testTeams, {
      skipSandbox: true,
      printResults: false,
      skipSynthesis: true, // avoid real Claude call in most tests
    });
  });

  it('transitions through the happy-path states', async () => {
    const states: string[] = [];
    runner.on('stateChange', (s: string) => states.push(s));
    await runner.run();

    expect(states).toEqual([
      CompetitionState.CONFIGURED,
      CompetitionState.LAUNCHING,
      CompetitionState.RUNNING,
      CompetitionState.TIME_UP,
      CompetitionState.COLLECTING,
      CompetitionState.JUDGING,
      CompetitionState.SCORED,
      CompetitionState.SYNTHESIZING,
      CompetitionState.COMPLETE,
    ]);
  });

  it('emits SYNTHESIZING state between SCORED and COMPLETE', async () => {
    const states: string[] = [];
    runner.on('stateChange', (s: string) => states.push(s));
    await runner.run();

    const synthesizingIdx = states.indexOf('SYNTHESIZING');
    const completeIdx = states.indexOf('COMPLETE');
    expect(synthesizingIdx).toBeGreaterThan(-1);
    expect(completeIdx).toBeGreaterThan(synthesizingIdx);
  });

  it('includes synthesis in the emitted result', async () => {
    const result = await runner.run();
    expect('synthesis' in result).toBe(true);
  });

  it('returns synthesis: null when skipSynthesis is true', async () => {
    const result = await runner.run();
    expect(result.synthesis).toBeNull();
  });

  it('calls synthesizeDeliverables and returns its value when skipSynthesis is false', async () => {
    const synthRunner = new CompetitionRunner(testBrief, testTeams, {
      skipSandbox: true,
      printResults: false,
      skipSynthesis: false,
    });
    const result = await synthRunner.run();
    expect(synthesizeDeliverables).toHaveBeenCalledOnce();
    expect(result.synthesis).toBe('# Synthesis\n\nBest of both.');
  });

  it('emits a result event with the final CompetitionResult', async () => {
    let emitted: unknown;
    runner.on('result', (r: unknown) => { emitted = r; });
    await runner.run();
    expect(emitted).toBeDefined();
    expect((emitted as { competition: unknown }).competition).toBeDefined();
  });

  it('exposes competitionId', () => {
    expect(typeof runner.competitionId).toBe('string');
    expect(runner.competitionId.length).toBeGreaterThan(0);
  });
});
