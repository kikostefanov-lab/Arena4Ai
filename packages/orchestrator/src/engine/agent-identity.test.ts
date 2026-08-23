/**
 * Two different Armory agents must actually be two different agents.
 *
 * The engine resolves a team's persona one of two ways: by `agentId` (the
 * Armory / New Battle path) or, when there is no agentId, by provider +
 * persona NAME. Two distinct agent rows can share a persona name, so the
 * name-based path collapses them — the user picks Agent A vs Agent B and
 * watches A fight itself with A's system prompt and A's model variant.
 *
 * These tests pin the agentId path end-to-end at the engine layer: distinct
 * ids ⇒ distinct system prompts and distinct model variants at the adapters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompetitionFormat } from '@arena/shared';
import type { Brief, Deliverable, Team } from '@arena/shared';
import type { AgentRepository } from '../db/agent-repository.js';

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
  scoreDeliverable: vi.fn().mockResolvedValue({
    judgeId: 'automated', teamId: 'team-a', scores: [{ criterionId: 'correctness', score: 8 }],
  }),
}));
vi.mock('../judging/ai-judge.js', () => ({
  aiJudge: vi.fn().mockResolvedValue({
    judgeId: 'ai-claude', teamId: 'team-a', model: 'claude-opus-5',
    scores: [{ criterionId: 'correctness', score: 9, commentary: 'good' }],
  }),
  JUDGE_IDS: { automated: 'automated', aiClaude: 'ai-claude', aiAdversarial: 'ai-adversarial' },
}));
vi.mock('../utils/cli-preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/cli-preflight.js')>();
  return { ...actual, findMissingClis: vi.fn().mockResolvedValue([]) };
});
vi.mock('../judging/score-aggregator.js', () => ({
  aggregate: vi.fn().mockReturnValue([
    { teamId: 'team-a', rank: 1, finalScore: 0.85, judgeResults: [] },
    { teamId: 'team-b', rank: 2, finalScore: 0.70, judgeResults: [] },
  ]),
}));
vi.mock('../judging/results-reporter.js', () => ({ printResults: vi.fn() }));
vi.mock('../presentation/presentation-generator.js', () => ({
  generateAllPresentations: vi.fn().mockResolvedValue([]),
}));
// The hardcoded fallback persona — reached only when neither DB path resolves.
vi.mock('../adapters/claude/claude-personas.js', () => ({
  resolvePersona: vi.fn().mockReturnValue({ systemPrompt: 'HARDCODED FALLBACK' }),
}));

// ── Fake adapter that records what it was constructed and briefed with ───────

interface AdapterCall { teamId: string; modelVariant?: string; systemPrompt?: string }
const adapterCalls = vi.hoisted(() => [] as Array<{ teamId: string; modelVariant?: string; systemPrompt?: string }>);

vi.mock('../adapters/claude/claude-adapter.js', async () => {
  const { EventEmitter: EE } = await import('node:events');
  class FakeClaudeAdapter extends EE {
    readonly teamId: string;
    readonly done = Promise.resolve();
    private readonly record: { teamId: string; modelVariant?: string; systemPrompt?: string };

    constructor(teamId: string, opts: { modelVariant?: string }) {
      super();
      this.teamId = teamId;
      this.record = { teamId, modelVariant: opts.modelVariant };
      adapterCalls.push(this.record);
    }

    injectBrief = vi.fn().mockImplementation((_brief: unknown, systemPrompt: string) => {
      this.record.systemPrompt = systemPrompt;
      return Promise.resolve();
    });
    startExecution = vi.fn().mockResolvedValue(undefined);
    collectDeliverables = vi.fn().mockImplementation(() => Promise.resolve({
      teamId: this.teamId,
      files: [{ path: 'solution.py', content: 'print("hi")' }],
      collectedAt: new Date().toISOString(),
    } as Deliverable));
    shutdown = vi.fn().mockResolvedValue(undefined);
    cleanupWorkdir = vi.fn().mockResolvedValue(undefined);
  }
  return { ClaudeAdapter: FakeClaudeAdapter };
});
vi.mock('../adapters/codex/codex-adapter.js', () => ({ CodexAdapter: vi.fn() }));
vi.mock('../adapters/gemini/gemini-adapter.js', () => ({ GeminiAdapter: vi.fn() }));

import { CompetitionRunner } from './competition-runner.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const brief: Brief = {
  id: 'identity-001',
  title: 'Identity Test',
  format: CompetitionFormat.SPRINT,
  problem: 'Write fizzbuzz',
  constraints: ['Must be correct'],
  deliverables: ['solution.py'],
  timeLimitMs: 1000,
  rubric: { criteria: [{ id: 'correctness', description: 'Is it correct?', maxScore: 10, weight: 1 }] },
};

/**
 * Two agent rows that a persona-NAME lookup cannot tell apart: same provider,
 * same persona name, different system prompts and model variants.
 */
const AGENTS: Record<string, { id: string; modelVariant: string; persona: { systemPrompt: string } }> = {
  'agent-alpha': { id: 'agent-alpha', modelVariant: 'claude-opus-5', persona: { systemPrompt: 'I AM ALPHA' } },
  'agent-beta': { id: 'agent-beta', modelVariant: 'claude-haiku-4-5', persona: { systemPrompt: 'I AM BETA' } },
};

function makeAgentRepo(): AgentRepository {
  return {
    get: vi.fn().mockImplementation((id: string) => Promise.resolve(AGENTS[id] ?? null)),
    // Name-based lookup always answers with the SAME agent — that is exactly
    // the collapse the agentId path has to avoid.
    getByProviderAndPersonaName: vi.fn().mockResolvedValue(AGENTS['agent-alpha']),
    findByProviderAndModel: vi.fn().mockResolvedValue(AGENTS['agent-alpha']),
    incrementStats: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentRepository;
}

function run(teams: Team[]) {
  const agentRepo = makeAgentRepo();
  const runner = new CompetitionRunner(brief, teams, {
    skipSandbox: true,
    printResults: false,
    agentRepo,
  });
  return runner.run();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('agent identity resolution', () => {
  beforeEach(() => {
    adapterCalls.length = 0;
  });

  it('gives two teams with different agentIds different agents', async () => {
    await run([
      { id: 'team-a', model: 'claude', persona: 'architect', agentId: 'agent-alpha' },
      { id: 'team-b', model: 'claude', persona: 'architect', agentId: 'agent-beta' },
    ]);

    expect(adapterCalls).toHaveLength(2);
    const byTeam = Object.fromEntries(adapterCalls.map(c => [c.teamId, c])) as Record<string, AdapterCall>;

    expect(byTeam['team-a']!.systemPrompt).toBe('I AM ALPHA');
    expect(byTeam['team-b']!.systemPrompt).toBe('I AM BETA');
    expect(byTeam['team-a']!.systemPrompt).not.toBe(byTeam['team-b']!.systemPrompt);

    expect(byTeam['team-a']!.modelVariant).toBe('claude-opus-5');
    expect(byTeam['team-b']!.modelVariant).toBe('claude-haiku-4-5');
  });

  it('collapses to one agent when no agentId is supplied (the pre-fix behaviour)', async () => {
    await run([
      { id: 'team-a', model: 'claude', persona: 'architect' },
      { id: 'team-b', model: 'claude', persona: 'architect' },
    ]);

    // Documents WHY the route must forward agentId: without it, the name-based
    // path hands both teams the same agent.
    expect(adapterCalls.map(c => c.systemPrompt)).toEqual(['I AM ALPHA', 'I AM ALPHA']);
  });

  it('lets an explicit team modelVariant win over the agent record', async () => {
    await run([
      { id: 'team-a', model: 'claude', persona: 'architect', agentId: 'agent-alpha', modelVariant: 'claude-sonnet-5' },
      { id: 'team-b', model: 'claude', persona: 'architect', agentId: 'agent-beta' },
    ]);

    const byTeam = Object.fromEntries(adapterCalls.map(c => [c.teamId, c])) as Record<string, AdapterCall>;
    expect(byTeam['team-a']!.modelVariant).toBe('claude-sonnet-5');
    expect(byTeam['team-b']!.modelVariant).toBe('claude-haiku-4-5');
  });
});
