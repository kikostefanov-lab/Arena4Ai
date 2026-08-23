import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { CompetitionState, CompetitionFormat } from '@arena/shared';
import type { Brief, Deliverable } from '@arena/shared';
import type { AgentRepository } from '../db/agent-repository.js';

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
const OK_JUDGE_RESULT = {
  judgeId: 'ai-claude',
  teamId: 'team-a',
  model: 'claude-opus-5',
  scores: [{ criterionId: 'correctness', score: 9, commentary: 'good' }],
};
vi.mock('../judging/ai-judge.js', () => ({
  aiJudge: vi.fn(),
  JUDGE_IDS: { automated: 'automated', aiClaude: 'ai-claude', aiAdversarial: 'ai-adversarial' },
}));

// Mock cli-preflight — real spawns would make the suite depend on which agent
// CLIs happen to be installed on the machine running the tests.
vi.mock('../utils/cli-preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/cli-preflight.js')>();
  return { ...actual, findMissingClis: vi.fn().mockResolvedValue([]) };
});

// Mock score-aggregator
vi.mock('../judging/score-aggregator.js', () => ({
  aggregate: vi.fn().mockReturnValue([
    { teamId: 'team-a', rank: 1, finalScore: 0.85, judgeResults: [] },
    { teamId: 'team-b', rank: 2, finalScore: 0.70, judgeResults: [] },
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

// Mock presentation-generator
vi.mock('../presentation/presentation-generator.js', () => ({
  generateAllPresentations: vi.fn().mockResolvedValue([]),
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
  cleanupWorkdir = vi.fn().mockResolvedValue(undefined);
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
import { aiJudge } from '../judging/ai-judge.js';
import { findMissingClis } from '../utils/cli-preflight.js';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTestRunner(opts: { agentRepo?: AgentRepository } = {}): CompetitionRunner {
  return new CompetitionRunner(testBrief, testTeams, {
    skipSandbox: true,
    printResults: false,
    agentRepo: opts.agentRepo,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('CompetitionRunner', () => {
  let runner: CompetitionRunner;

  beforeEach(() => {
    vi.mocked(aiJudge).mockResolvedValue(OK_JUDGE_RESULT as never);
    vi.mocked(findMissingClis).mockResolvedValue([]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new CompetitionRunner(testBrief, testTeams, {
      skipSandbox: true,
      printResults: false,
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
      CompetitionState.PRESENTING,
      CompetitionState.JUDGING,
      CompetitionState.SCORED,
      CompetitionState.COMPLETE,
    ]);
  });

  it('includes synthesis (null) in the emitted result', async () => {
    const result = await runner.run();
    expect('synthesis' in result).toBe(true);
    expect(result.synthesis).toBeNull();
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

  it('calls incrementStats on agent repo after SCORED transition when agentId is set', async () => {
    // Arrange: mock repo with spy
    const mockIncrementStats = vi.fn().mockResolvedValue(undefined);
    const mockGetByProviderAndPersonaName = vi.fn().mockResolvedValue(null);
    const mockGet = vi.fn().mockResolvedValue(null);
    const mockRepo = {
      get: mockGet,
      getByProviderAndPersonaName: mockGetByProviderAndPersonaName,
      incrementStats: mockIncrementStats,
    } as unknown as AgentRepository;

    // Use teams with agentId so incrementStats is triggered
    const teamsWithAgentId = testTeams.map((t, i) => ({ ...t, agentId: `agent-${i}` }));
    const testRunner = new CompetitionRunner(testBrief, teamsWithAgentId, {
      skipSandbox: true,
      printResults: false,
      agentRepo: mockRepo,
    });
    await testRunner.run();

    // After SCORED, incrementStats should have been called for each team with agentId
    expect(mockIncrementStats).toHaveBeenCalled();
  });
});


// ── AA-016 / preflight: failures must be explicit ────────────────────────────

describe('CompetitionRunner failure visibility', () => {
  beforeEach(() => {
    vi.mocked(findMissingClis).mockResolvedValue([]);
    vi.mocked(aiJudge).mockResolvedValue(OK_JUDGE_RESULT as never);
  });

  it('falls back to the automated scorer using the judge failure FIELD, not commentary text', async () => {
    // A failed judge that nonetheless produced a plausible non-zero score:
    // the old string-match heuristic ("does any commentary contain 'fallback'?")
    // would have accepted this as a real AI score.
    vi.mocked(aiJudge).mockResolvedValue({
      judgeId: 'ai-claude',
      teamId: 'team-a',
      model: 'claude-opus-5',
      scores: [{ criterionId: 'correctness', score: 6, commentary: 'looks fine to me' }],
      failure: { kind: 'model-unavailable', message: 'model "o4-mini" was rejected by the CLI' },
    } as never);

    const runner = makeTestRunner();
    const result = await runner.run();

    expect(result.scorecards.length).toBeGreaterThan(0);
    const { aggregate } = await import('../judging/score-aggregator.js');
    const judged = vi.mocked(aggregate).mock.calls.at(-1)![0];
    expect(judged.every((r: { judgeId: string }) => r.judgeId === 'automated')).toBe(true);
  });

  it('emits an ERROR event naming the judging failure so it is not silent', async () => {
    vi.mocked(aiJudge).mockResolvedValue({
      judgeId: 'ai-claude',
      teamId: 'team-a',
      model: 'claude-opus-5',
      scores: [{ criterionId: 'correctness', score: 0, commentary: 'x' }],
      failure: { kind: 'cli-missing', message: 'the "claude" CLI was not found on PATH' },
    } as never);

    const runner = makeTestRunner();
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    runner.on('arenaEvent', (e) => events.push(e));
    await runner.run();

    const errors = events.filter(e => e.type === 'ERROR' && e.payload['stage'] === 'judging');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.payload['kind']).toBe('cli-missing');
    expect(String(errors[0]!.payload['message'])).toContain('claude');
  });

  it('uses the AI judge when it reports no failure', async () => {
    const runner = makeTestRunner();
    await runner.run();
    const { aggregate } = await import('../judging/score-aggregator.js');
    const judged = vi.mocked(aggregate).mock.calls.at(-1)![0];
    expect(judged.some((r: { judgeId: string }) => r.judgeId === 'ai-claude')).toBe(true);
  });

  it('refuses to launch with a clear message when a provider CLI is missing', async () => {
    vi.mocked(findMissingClis).mockResolvedValue([
      { provider: 'gemini', bin: 'gemini', hint: 'npm i -g @google/gemini-cli' },
    ]);

    const runner = makeTestRunner();
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    runner.on('arenaEvent', (e) => events.push(e));

    await expect(runner.run()).rejects.toThrow(/"gemini" not found on PATH/);
    expect(events.some(e => e.type === 'ERROR' && e.payload['stage'] === 'preflight')).toBe(true);
  });
});
