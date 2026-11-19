/**
 * Lifecycle guarantees of CompetitionRunner: the deadline stops the agents before
 * anything is collected, and a cancelled/failed competition never runs a later stage.
 * Everything is stubbed — no database, Docker or agent CLI is involved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { CompetitionState, CompetitionFormat, EventType } from '@arena/shared';
import type { ArenaEvent } from '@arena/shared';
import type { Brief, Deliverable } from '@arena/shared';

vi.mock('node:fs/promises', () => ({ mkdtemp: vi.fn().mockResolvedValue('/tmp/arena-test-workdir') }));
vi.mock('node:os', () => ({ tmpdir: vi.fn().mockReturnValue('/tmp') }));
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
  scoreDeliverable: vi.fn().mockResolvedValue({ judgeId: 'automated', teamId: 'team-a', scores: [] }),
}));
vi.mock('../judging/ai-judge.js', () => ({
  aiJudge: vi.fn(),
  JUDGE_IDS: { automated: 'automated', aiClaude: 'ai-claude', aiAdversarial: 'ai-adversarial' },
}));
vi.mock('../utils/cli-preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/cli-preflight.js')>();
  return { ...actual, findMissingClis: vi.fn().mockResolvedValue([]) };
});
vi.mock('../judging/score-aggregator.js', () => ({
  aggregate: vi.fn().mockReturnValue([{ teamId: 'team-a', rank: 1, finalScore: 0.9, judgeResults: [] }]),
}));
vi.mock('../judging/results-reporter.js', () => ({ printResults: vi.fn() }));
vi.mock('../adapters/claude/claude-personas.js', () => ({
  resolvePersona: vi.fn().mockReturnValue({ systemPrompt: 'x' }),
}));
vi.mock('../presentation/presentation-generator.js', () => ({
  generateAllPresentations: vi.fn().mockResolvedValue([]),
}));

// ── Controllable fake adapter ────────────────────────────────────────────────

const log: string[] = [];
const adapters: FakeAdapter[] = [];
const gates = { collect: null as null | Promise<void> };

class FakeAdapter extends EventEmitter {
  alive = false;
  readonly done: Promise<void>;
  private _resolveDone!: () => void;
  injectBrief = vi.fn().mockResolvedValue(undefined);
  cleanupWorkdir = vi.fn().mockResolvedValue(undefined);
  constructor(readonly teamId: string) {
    super();
    this.done = new Promise<void>((r) => { this._resolveDone = r; });
    adapters.push(this);
  }
  /** The agent runs until it is shut down — it never finishes on its own. */
  startExecution = vi.fn().mockImplementation(async () => { this.alive = true; });
  shutdown = vi.fn().mockImplementation(async () => {
    log.push(`shutdown:${this.teamId}`);
    this.alive = false;
    this._resolveDone();
  });
  collectDeliverables = vi.fn().mockImplementation(async (): Promise<Deliverable> => {
    log.push(`collect:${this.teamId}:${this.alive ? 'alive' : 'stopped'}`);
    if (gates.collect) await gates.collect;
    return { teamId: this.teamId, files: [], collectedAt: new Date().toISOString() };
  });
}
vi.mock('../adapters/claude/claude-adapter.js', () => ({
  ClaudeAdapter: vi.fn().mockImplementation((teamId: string) => new FakeAdapter(teamId)),
}));
vi.mock('../adapters/codex/codex-adapter.js', () => ({ CodexAdapter: vi.fn() }));
vi.mock('../adapters/gemini/gemini-adapter.js', () => ({ GeminiAdapter: vi.fn() }));

import { CompetitionRunner, JUDGE_RATE_LIMIT_RETRY_DELAY_MS } from './competition-runner.js';
import { aiJudge } from '../judging/ai-judge.js';
import { generateAllPresentations } from '../presentation/presentation-generator.js';
import { scoreDeliverable } from '../judging/rubric-scorer.js';

const brief: Brief = {
  id: 'lc-1',
  title: 'Lifecycle',
  format: CompetitionFormat.SPRINT,
  problem: 'p',
  constraints: [],
  deliverables: ['a.txt'],
  timeLimitMs: 40, // deadline fires after 40ms of real time
  rubric: { criteria: [{ id: 'c', description: 'd', maxScore: 10, weight: 1 }] },
};
const teams = [
  { id: 'team-a', model: 'claude:architect', persona: 'architect' },
  { id: 'team-b', model: 'claude:speedrunner', persona: 'speedrunner' },
];

function makeRunner(b: Brief = brief) {
  const runner = new CompetitionRunner(b, teams, { skipSandbox: true, printResults: false });
  const states: string[] = [];
  const results: unknown[] = [];
  runner.on('stateChange', (s: string) => states.push(s));
  runner.on('result', (r: unknown) => results.push(r));
  return { runner, states, results };
}

/** Resolve once `predicate` holds (polled — keeps the tests free of fixed sleeps). */
async function until(predicate: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('until(): timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
}

beforeEach(() => {
  log.length = 0;
  adapters.length = 0;
  gates.collect = null;
  vi.mocked(aiJudge).mockReset().mockImplementation((async (_b: unknown, d: { teamId: string }) => ({
    judgeId: 'ai-claude', teamId: d.teamId, model: 'm', scores: [{ criterionId: 'c', score: 9, commentary: '' }],
  })) as never);
  vi.mocked(generateAllPresentations).mockClear();
});

describe('deadline stops the agents before collection', () => {
  it('shuts every adapter down before any deliverable is collected', async () => {
    const { runner } = makeRunner();
    await runner.run();

    const firstCollect = log.findIndex((l) => l.startsWith('collect:'));
    const shutdowns = log.map((l, i) => (l.startsWith('shutdown:') ? i : -1)).filter((i) => i >= 0);
    expect(shutdowns.length).toBeGreaterThanOrEqual(2);
    expect(shutdowns.filter((i) => i < firstCollect).length).toBeGreaterThanOrEqual(2);
    expect(log.filter((l) => l.startsWith('collect:')).every((l) => l.endsWith(':stopped'))).toBe(true);
  });
});

describe('cancellation is terminal', () => {
  async function cancelDuring(stage: 'collect' | 'presentation' | 'judging') {
    const { runner, states, results } = makeRunner();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    if (stage === 'collect') gates.collect = gate;
    if (stage === 'presentation') {
      vi.mocked(generateAllPresentations).mockImplementationOnce(async () => { await gate; return []; });
    }
    if (stage === 'judging') {
      vi.mocked(aiJudge).mockImplementation((async (_b: unknown, d: { teamId: string }) => {
        await gate;
        return { judgeId: 'ai-claude', teamId: d.teamId, model: 'm', scores: [] };
      }) as never);
    }
    const settled = runner.run().then(() => 'resolved' as const, (e: Error) => e);
    const reachedState = {
      collect: CompetitionState.COLLECTING,
      presentation: CompetitionState.PRESENTING,
      judging: CompetitionState.JUDGING,
    }[stage];
    await until(() => states.includes(reachedState));
    if (stage === 'collect') await until(() => log.some((l) => l.startsWith('collect:')));
    await runner.cancel();
    release();
    const outcome = await settled;
    return { states, results, outcome };
  }

  for (const stage of ['collect', 'presentation', 'judging'] as const) {
    it(`never advances or completes after a cancel during ${stage}`, async () => {
      const { states, results, outcome } = await cancelDuring(stage);

      const cancelledAt = states.indexOf(CompetitionState.CANCELLED);
      expect(cancelledAt).toBeGreaterThan(-1);
      expect(states.slice(cancelledAt + 1)).toEqual([]); // CANCELLED is last
      expect(states).not.toContain(CompetitionState.COMPLETE);
      expect(results).toEqual([]);
      // run() rejects with a cancellation error, not an "Invalid transition" one.
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).not.toMatch(/Invalid transition/);
      expect((outcome as Error).name).toBe('CompetitionCancelledError');
    });
  }

  it('does not start presenting or judging when cancelled during collection', async () => {
    await cancelDuring('collect');
    expect(generateAllPresentations).not.toHaveBeenCalled();
    expect(aiJudge).not.toHaveBeenCalled();
  });

  it('does not run judging when cancelled during presentation generation', async () => {
    await cancelDuring('presentation');
    expect(aiJudge).not.toHaveBeenCalled();
  });

  it('stays CANCELLED (never FAILED) and runs nothing when cancelled before run()', async () => {
    const { runner, states } = makeRunner();
    await runner.cancel();
    await expect(runner.run()).rejects.toMatchObject({ name: 'CompetitionCancelledError' });
    expect(states).toEqual([CompetitionState.CANCELLED]);
    expect(adapters).toHaveLength(0);
  });

  it('is idempotent and a second cancel() waits for the same shutdown', async () => {
    const { runner } = makeRunner();
    const running = runner.run().catch(() => undefined);
    await until(() => adapters.length === 2 && adapters.every((a) => a.alive));
    await Promise.all([runner.cancel(), runner.cancel()]);
    await running;
    expect(adapters.every((a) => !a.alive)).toBe(true);
  });
});

describe('judge retry', () => {
  const ok = (d: { teamId: string }) => ({
    judgeId: 'ai-claude', teamId: d.teamId, model: 'm', scores: [{ criterionId: 'c', score: 9, commentary: '' }],
  });
  const failed = (d: { teamId: string }, kind: string) => ({
    judgeId: 'ai-claude', teamId: d.teamId, model: 'm', scores: [], failure: { kind, message: kind },
  });

  it('retries once after a timeout and uses the AI scores, not the fallback', async () => {
    const calls = new Map<string, number>();
    vi.mocked(aiJudge).mockImplementation((async (_b: unknown, d: { teamId: string }) => {
      const n = (calls.get(d.teamId) ?? 0) + 1;
      calls.set(d.teamId, n);
      return n === 1 ? failed(d, 'timeout') : ok(d);
    }) as never);
    const { runner } = makeRunner();
    await runner.run();
    expect(calls.get('team-a')).toBe(2);
    expect(vi.mocked(scoreDeliverable)).toHaveBeenCalled(); // computed in parallel, but unused
    const { aggregate } = await import('../judging/score-aggregator.js');
    const judged = vi.mocked(aggregate).mock.calls.at(-1)![0] as Array<{ judgeId: string }>;
    expect(judged.every((r) => r.judgeId === 'ai-claude')).toBe(true);
  });

  it('a recovered first failure is still reported, as a recovered judging ERROR', async () => {
    const calls = new Map<string, number>();
    vi.mocked(aiJudge).mockImplementation((async (_b: unknown, d: { teamId: string }) => {
      const n = (calls.get(d.teamId) ?? 0) + 1;
      calls.set(d.teamId, n);
      return n === 1 && d.teamId === 'team-a' ? failed(d, 'bad-output') : ok(d);
    }) as never);
    const { runner } = makeRunner();
    const events: ArenaEvent[] = [];
    runner.on('arenaEvent', (e: ArenaEvent) => events.push(e));
    await runner.run();
    const judging = events.filter((e) => e.type === EventType.ERROR && (e.payload as { stage?: string }).stage === 'judging');
    expect(judging).toHaveLength(1);
    expect(judging[0]!.teamId).toBe('team-a');
    expect(judging[0]!.payload).toMatchObject({ recovered: true, kind: 'bad-output', judgeId: 'ai-claude' });
  });

  it('waits before retrying a rate-limited judge', async () => {
    // The 15 s wait is shortened to 0 here; what is checked is that it is asked for.
    const realSetTimeout = globalThis.setTimeout;
    const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) =>
      realSetTimeout(fn, ms === JUDGE_RATE_LIMIT_RETRY_DELAY_MS ? 0 : ms)) as typeof setTimeout);
    try {
      const calls = new Map<string, number>();
      vi.mocked(aiJudge).mockImplementation((async (_b: unknown, d: { teamId: string }) => {
        const n = (calls.get(d.teamId) ?? 0) + 1;
        calls.set(d.teamId, n);
        return n === 1 && d.teamId === 'team-a' ? failed(d, 'rate-limit') : ok(d);
      }) as never);
      const { runner } = makeRunner();
      await runner.run();
      expect(calls.get('team-a')).toBe(2);
      expect(timers.mock.calls.some((c) => c[1] === JUDGE_RATE_LIMIT_RETRY_DELAY_MS)).toBe(true);
      expect(JUDGE_RATE_LIMIT_RETRY_DELAY_MS).toBe(15_000);
    } finally {
      timers.mockRestore();
    }
  });

  it('does not retry an auth failure and falls back to the automated scorer', async () => {
    vi.mocked(aiJudge).mockImplementation((async (_b: unknown, d: { teamId: string }) => failed(d, 'auth')) as never);
    const { runner } = makeRunner();
    await runner.run();
    expect(vi.mocked(aiJudge)).toHaveBeenCalledTimes(2); // one per team, no retry
    const { aggregate } = await import('../judging/score-aggregator.js');
    const judged = vi.mocked(aggregate).mock.calls.at(-1)![0] as Array<{ judgeId: string }>;
    expect(judged.every((r) => r.judgeId === 'automated')).toBe(true);
  });

  it('passes a scaled timeout to the judge', async () => {
    const { runner } = makeRunner();
    await runner.run();
    expect(vi.mocked(aiJudge).mock.calls[0]![3]).toMatchObject({ timeoutMs: 120_000 });
  });
});

describe('wall-clock stop', () => {
  it('ends a run whose clock is paused, at 1.5x the time limit of real time', async () => {
    vi.useFakeTimers();
    try {
      const long: Brief = { ...brief, timeLimitMs: 3_600_000 };
      const { runner, states } = makeRunner(long);
      const done = runner.run();
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(states).toContain(CompetitionState.RUNNING));
      await vi.advanceTimersByTimeAsync(0); // the clock starts right after the agents do
      runner.pause();
      await vi.advanceTimersByTimeAsync(3_600_000 * 1.5 - 5_000); // just short of the stop
      expect(states).not.toContain(CompetitionState.COLLECTING);
      await vi.advanceTimersByTimeAsync(5_000);
      await done;
      expect(states).toContain(CompetitionState.COLLECTING);
      expect(adapters.every((a) => !a.alive)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
