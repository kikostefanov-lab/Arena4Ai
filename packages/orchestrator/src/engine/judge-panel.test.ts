/**
 * Cross-vendor judge panel: with `judgePanel`, Claude, Codex and Gemini each
 * judge every team and finalScore is the mean of the judges that succeeded.
 * The aggregator is the real one, so the mean is the production averaging.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { CompetitionFormat, CLI_DEFAULT_MODEL, type ArenaEvent, type Brief, type Deliverable } from '@arena/shared';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  mkdtemp: vi.fn().mockResolvedValue('/tmp/arena-test-workdir'),
}));
vi.mock('../sandbox/sandbox-manager.js', () => ({
  SandboxManager: vi.fn().mockImplementation(() => ({ verify: vi.fn().mockResolvedValue(undefined) })),
}));
vi.mock('../events/event-logger.js', () => ({
  EventLogger: vi.fn().mockImplementation(() => ({
    open: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../judging/rubric-scorer.js', () => ({
  scoreDeliverable: vi.fn().mockImplementation(async (_id: string, d: Deliverable) => ({
    judgeId: 'automated', teamId: d.teamId, scores: [], overallScore: 0.2, heuristic: true,
  })),
}));
vi.mock('../judging/ai-judge.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../judging/ai-judge.js')>()),
  aiJudge: vi.fn(),
}));
vi.mock('../utils/cli-preflight.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/cli-preflight.js')>()),
  findMissingClis: vi.fn().mockResolvedValue([]),
  findUnavailableModels: vi.fn().mockResolvedValue([]),
}));
vi.mock('../judging/results-reporter.js', () => ({ printResults: vi.fn() }));
vi.mock('../adapters/claude/claude-personas.js', () => ({
  resolvePersona: vi.fn().mockReturnValue({ systemPrompt: 'x' }),
}));
vi.mock('../presentation/presentation-generator.js', () => ({
  generateAllPresentations: vi.fn().mockResolvedValue([]),
}));

class FakeAdapter extends EventEmitter {
  readonly done: Promise<void>;
  private _resolveDone!: () => void;
  injectBrief = vi.fn().mockResolvedValue(undefined);
  cleanupWorkdir = vi.fn().mockResolvedValue(undefined);
  shutdown = vi.fn().mockResolvedValue(undefined);
  constructor(readonly teamId: string) {
    super();
    this.done = new Promise<void>((r) => { this._resolveDone = r; });
  }
  startExecution = vi.fn().mockImplementation(async () => { this._resolveDone(); });
  collectDeliverables = vi.fn().mockImplementation(async (): Promise<Deliverable> => ({
    teamId: this.teamId, files: [{ path: 'solution.py', content: 'print(1)' }], collectedAt: new Date().toISOString(),
  }));
}
vi.mock('../adapters/claude/claude-adapter.js', () => ({
  ClaudeAdapter: vi.fn().mockImplementation((teamId: string) => new FakeAdapter(teamId)),
}));
vi.mock('../adapters/codex/codex-adapter.js', () => ({
  CodexAdapter: vi.fn().mockImplementation((teamId: string) => new FakeAdapter(teamId)),
}));
vi.mock('../adapters/gemini/gemini-adapter.js', () => ({
  GeminiAdapter: vi.fn().mockImplementation((teamId: string) => new FakeAdapter(teamId)),
}));

import { CompetitionRunner, type RunOptions } from './competition-runner.js';
import { aiJudge, type AiJudgeOptions, type AiJudgeResult, type AiJudgeFailureKind } from '../judging/ai-judge.js';
import { findMissingClis } from '../utils/cli-preflight.js';
import { DEFAULT_JUDGE_MODEL } from '../adapters/model-registry.js';

const brief: Brief = {
  id: 'panel-1',
  title: 'Panel',
  format: CompetitionFormat.SPRINT,
  problem: 'p',
  constraints: [],
  deliverables: ['solution.py'],
  timeLimitMs: 5000,
  rubric: { criteria: [{ id: 'c', description: 'd', maxScore: 10, weight: 1 }] },
};
const teams = [
  { id: 'team-a', model: 'claude:architect', persona: 'architect' },
  { id: 'team-b', model: 'codex:standard', persona: 'standard' },
  { id: 'team-c', model: 'gemini:standard', persona: 'standard' },
];

/** What each provider's judge awards, per team. */
const AWARD: Record<string, Record<string, number>> = {
  claude: { 'team-a': 0.9, 'team-b': 0.6, 'team-c': 0.3 },
  codex:  { 'team-a': 0.6, 'team-b': 0.9, 'team-c': 0.6 },
  gemini: { 'team-a': 0.3, 'team-b': 0.6, 'team-c': 0.9 },
};

/** Fake judge: scores from AWARD; a CLI-default judge "reports" a concrete model. */
function judgeWith(failing: Partial<Record<string, AiJudgeFailureKind>> = {}) {
  return async (_b: Brief, d: Deliverable, _r: unknown, o: AiJudgeOptions): Promise<AiJudgeResult> => {
    const provider = o.provider ?? 'claude';
    const model = o.model === CLI_DEFAULT_MODEL ? `${provider}-reported-model` : (o.model ?? 'unset');
    const kind = failing[provider];
    const overallScore = kind ? 0 : AWARD[provider]![d.teamId]!;
    return {
      judgeId: o.judgeId, teamId: d.teamId, provider, model, overallScore,
      scores: [{ criterionId: 'c', score: overallScore * 10, commentary: 'x' }],
      ...(kind ? { failure: { kind, message: `${provider} judge unavailable (${kind})` } } : {}),
    };
  };
}

async function run(options: RunOptions = {}, runTeams = teams) {
  const runner = new CompetitionRunner(brief, runTeams, { skipSandbox: true, printResults: false, ...options });
  const events: ArenaEvent[] = [];
  runner.on('arenaEvent', (e: ArenaEvent) => events.push(e));
  const result = await runner.run();
  return { result, events };
}

const card = (result: Awaited<ReturnType<typeof run>>['result'], teamId: string) =>
  result.scorecards.find((c) => c.teamId === teamId)!;
type LooseEvent = { type: string; payload: Record<string, unknown> };
const judgingErrors = (events: ArenaEvent[]): LooseEvent[] =>
  (events as unknown as LooseEvent[]).filter((e) => e.type === 'ERROR' && e.payload['stage'] === 'judging');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findMissingClis).mockResolvedValue([]);
  vi.mocked(aiJudge).mockImplementation(judgeWith());
});
afterEach(() => {
  delete process.env['ARENA_JUDGE_MODEL_CODEX'];
});

describe('cross-vendor judge panel', () => {
  it('judges every team with claude, codex and gemini, and finalScore is their mean', async () => {
    const { result } = await run({ judgePanel: true });

    const calls = vi.mocked(aiJudge).mock.calls;
    expect(calls).toHaveLength(9);
    for (const t of teams) {
      const providers = calls.filter((c) => (c[1] as Deliverable).teamId === t.id).map((c) => c[3].provider).sort();
      expect(providers).toEqual(['claude', 'codex', 'gemini']);
    }
    // Same rubric and context for every judge.
    expect(new Set(calls.map((c) => c[2]))).toEqual(new Set([brief.rubric]));

    for (const t of teams) {
      const expected = (AWARD.claude![t.id]! + AWARD.codex![t.id]! + AWARD.gemini![t.id]!) / 3;
      expect(card(result, t.id).finalScore).toBeCloseTo(expected, 10);
      expect(card(result, t.id).judgeResults).toHaveLength(3);
    }
  });

  it('pins claude to the judge model, runs codex and gemini on their CLI default, and names each judge by the model it ran on', async () => {
    const { result } = await run({ judgePanel: true });
    const models = Object.fromEntries(vi.mocked(aiJudge).mock.calls.map((c) => [c[3].provider, c[3].model]));
    expect(models).toEqual({ claude: DEFAULT_JUDGE_MODEL, codex: CLI_DEFAULT_MODEL, gemini: CLI_DEFAULT_MODEL });

    expect(card(result, 'team-a').judgeResults.map((r) => r.judgeId).sort()).toEqual([
      `ai-claude/${DEFAULT_JUDGE_MODEL}`, 'ai-codex/codex-reported-model', 'ai-gemini/gemini-reported-model',
    ]);
    expect(card(result, 'team-a').judgePanel).toEqual(expect.arrayContaining([
      { provider: 'codex', model: 'codex-reported-model', judgeId: 'ai-codex/codex-reported-model' },
    ]));
  });

  it('honours ARENA_JUDGE_MODEL_CODEX', async () => {
    process.env['ARENA_JUDGE_MODEL_CODEX'] = 'codex-pinned';
    await run({ judgePanel: true });
    expect(vi.mocked(aiJudge).mock.calls.find((c) => c[3].provider === 'codex')![3].model).toBe('codex-pinned');
  });

  it('drops a failing judge: the mean of the other two, and an ERROR naming that provider', async () => {
    vi.mocked(aiJudge).mockImplementation(judgeWith({ gemini: 'auth' }));
    const { result, events } = await run({ judgePanel: true });

    for (const t of teams) {
      expect(card(result, t.id).finalScore).toBeCloseTo((AWARD.claude![t.id]! + AWARD.codex![t.id]!) / 2, 10);
      expect(card(result, t.id).judgeResults.map((r) => (r as AiJudgeResult).provider).sort()).toEqual(['claude', 'codex']);
      const seat = card(result, t.id).judgePanel!.find((p) => p.provider === 'gemini')!;
      expect(seat.failure).toBe('auth');
    }
    const errors = judgingErrors(events);
    expect(errors).toHaveLength(3);
    for (const e of errors) {
      expect(e.payload['provider']).toBe('gemini');
      expect(e.payload['failure']).toMatchObject({ kind: 'auth' });
    }
    // auth will not fix itself: no retry, so exactly one gemini call per team.
    expect(vi.mocked(aiJudge).mock.calls.filter((c) => c[3].provider === 'gemini')).toHaveLength(3);
  });

  it('retries a panel judge once on a retryable failure, as a single judge does', async () => {
    let geminiCalls = 0;
    const ok = judgeWith();
    vi.mocked(aiJudge).mockImplementation(async (b, d, r, o) => {
      if (o.provider === 'gemini' && d.teamId === 'team-a' && geminiCalls++ === 0) {
        return judgeWith({ gemini: 'timeout' })(b, d, r, o);
      }
      return ok(b, d, r, o);
    });
    const { result, events } = await run({ judgePanel: true });
    expect(card(result, 'team-a').judgeResults).toHaveLength(3);
    const recovered = judgingErrors(events).filter((e) => e.payload['recovered']);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.payload['provider']).toBe('gemini');
  });

  it('falls back to the heuristic scorer when all three judges fail', async () => {
    vi.mocked(aiJudge).mockImplementation(judgeWith({ claude: 'auth', codex: 'cli-missing', gemini: 'model-unavailable' }));
    const { result, events } = await run({ judgePanel: true });
    for (const t of teams) {
      expect(card(result, t.id).judgeResults).toEqual([expect.objectContaining({ judgeId: 'automated', heuristic: true })]);
      expect(card(result, t.id).judgePanel!.every((p) => p.failure)).toBe(true);
    }
    expect(new Set(judgingErrors(events).map((e) => e.payload['provider']))).toEqual(new Set(['claude', 'codex', 'gemini']));
  });

  it('replaces the adversarial pair rather than adding a second claude judge', async () => {
    await run({ judgePanel: true, adversarialJudge: true });
    const providers = vi.mocked(aiJudge).mock.calls.map((c) => c[3].provider);
    expect(providers.filter((p) => p === 'claude')).toHaveLength(3);
    expect(providers).toHaveLength(9);
  });

  it('checks the judges\' CLIs before launch, even when no team runs on them', async () => {
    const claudeOnly = teams.map((t) => ({ ...t, model: 'claude:architect' }));
    await run({ judgePanel: true }, claudeOnly);
    expect(vi.mocked(findMissingClis).mock.calls[0]![0]).toEqual(expect.arrayContaining(['claude', 'codex', 'gemini']));
  });

  it('without the panel, judges with claude alone and records no panel', async () => {
    const { result } = await run();
    expect(vi.mocked(aiJudge).mock.calls.map((c) => c[3].provider)).toEqual(['claude', 'claude', 'claude']);
    expect(vi.mocked(aiJudge).mock.calls.map((c) => c[3].judgeId)).toEqual(['ai-claude', 'ai-claude', 'ai-claude']);
    expect(card(result, 'team-a').judgePanel).toBeUndefined();
  });
});
