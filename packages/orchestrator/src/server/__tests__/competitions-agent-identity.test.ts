/**
 * Agent identity over HTTP.
 *
 * The Armory lets a user pick a *specific* agent per team, and the New Battle
 * page sends that agent's id in the request body. If the route drops it, the
 * engine falls back to a provider+persona-NAME lookup — so two different agents
 * that happen to share a persona name silently collapse into the same one, and
 * the user watches one agent fight itself.
 *
 * These tests pin the contract: agentId and modelVariant are competition
 * CONTENT and must survive the request → Team mapping. Execution options
 * (binaries, sandbox, log dir) must NOT — those come from the environment only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompetitionFormat } from '@arena/shared';
import type { Team } from '@arena/shared';
import request from 'supertest';

// Captures every (brief, teams, options) triple the route hands the runner.
const captured = vi.hoisted(() => ({ calls: [] as Array<{ teams: Team[]; options: Record<string, unknown> }> }));

vi.mock('../../db/client.js', () => ({ db: {} }));
vi.mock('../../db/repository.js', () => ({
  CompetitionRepository: vi.fn(),
  TournamentRepository: vi.fn().mockImplementation(() => ({
    createTournament: vi.fn().mockResolvedValue(undefined),
    getTournament: vi.fn().mockResolvedValue(null),
    updateTournamentState: vi.fn().mockResolvedValue(undefined),
    updateTournamentProgress: vi.fn().mockResolvedValue(undefined),
    listTournaments: vi.fn().mockResolvedValue([]),
  })),
  BriefsRepository: vi.fn().mockImplementation(() => ({
    list: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    seedFromYaml: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../routes/briefs-seed.js', () => ({ seedYamlBriefs: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../db/seed-personas-agents.js', () => ({ seedPersonasAgents: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../repo.js', () => ({
  repo: {
    create: vi.fn().mockResolvedValue(undefined),
    updateState: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    saveResult: vi.fn().mockResolvedValue(undefined),
    getCompetition: vi.fn().mockResolvedValue(null),
    getEvents: vi.fn().mockResolvedValue([]),
    countEvents: vi.fn().mockResolvedValue(0),
    getResult: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    listSummary: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../runner-registry.js', () => ({ runnerRegistry: new Map() }));
vi.mock('../websocket.js', () => ({ attachWebSocket: vi.fn() }));

vi.mock('../../engine/competition-runner.js', async () => {
  const { EventEmitter } = await import('node:events');
  const { CompetitionState: State } = await import('@arena/shared');

  class MockCompetitionRunner extends EventEmitter {
    competitionId = 'mock-competition';
    run = vi.fn().mockResolvedValue({
      competition: { id: 'mock-competition', state: State.COMPLETE },
      scorecards: [],
      winner: null,
    });
    cancel = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    resume = vi.fn();

    constructor(_brief: unknown, teams: Team[], options: Record<string, unknown>) {
      super();
      captured.calls.push({ teams, options });
    }
  }

  return { CompetitionRunner: MockCompetitionRunner };
});

import { createApp } from '../app.js';
import type { Application } from 'express';

const validBrief = {
  id: 'test-identity-001',
  title: 'Test Competition',
  format: CompetitionFormat.SPRINT,
  problem: 'Solve this test problem',
  constraints: ['No external APIs'],
  deliverables: ['A working solution'],
  timeLimitMs: 300_000,
  rubric: {
    criteria: [{ id: 'correctness', description: 'Is the solution correct?', maxScore: 10, weight: 1 }],
  },
};

describe('POST /competitions — agent identity', () => {
  let app: Application;

  beforeEach(() => {
    captured.calls.length = 0;
    app = createApp();
  });

  it('keeps two different agentIds distinct instead of collapsing them into one agent', async () => {
    // Same provider, same persona NAME — the Armory case where only the agent id
    // tells the two apart. Before the fix both teams reached the engine with no
    // agentId at all and resolved to the same DB agent by persona name.
    const res = await request(app)
      .post('/competitions')
      .send({
        brief: validBrief,
        teams: [
          { id: 'team-a', model: 'claude', persona: 'architect', agentId: 'agent-alpha' },
          { id: 'team-b', model: 'claude', persona: 'architect', agentId: 'agent-beta' },
        ],
      });

    expect(res.status).toBe(201);
    expect(captured.calls).toHaveLength(1);

    const teams = captured.calls[0]!.teams;
    expect(teams.map(t => t.agentId)).toEqual(['agent-alpha', 'agent-beta']);
    expect(teams[0]!.agentId).not.toBe(teams[1]!.agentId);
  });

  it('preserves per-team modelVariant', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({
        brief: validBrief,
        teams: [
          { id: 'team-a', model: 'claude', persona: 'architect', modelVariant: 'claude-opus-5' },
          { id: 'team-b', model: 'claude', persona: 'architect', modelVariant: 'claude-haiku-4-5' },
        ],
      });

    expect(res.status).toBe(201);
    const teams = captured.calls[0]!.teams;
    expect(teams.map(t => t.modelVariant)).toEqual(['claude-opus-5', 'claude-haiku-4-5']);
  });

  it('omits agentId/modelVariant when the caller does not send them', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({
        brief: validBrief,
        teams: [
          { id: 'team-a', model: 'claude', persona: 'architect' },
          { id: 'team-b', model: 'claude', persona: 'speedrunner' },
        ],
      });

    expect(res.status).toBe(201);
    const teams = captured.calls[0]!.teams;
    expect(teams[0]!.agentId).toBeUndefined();
    expect(teams[0]!.modelVariant).toBeUndefined();
  });

  it('rejects a non-string agentId rather than silently dropping it', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({
        brief: validBrief,
        teams: [
          { id: 'team-a', model: 'claude', persona: 'architect', agentId: { $ne: null } },
          { id: 'team-b', model: 'claude', persona: 'architect' },
        ],
      });

    expect(res.status).toBe(400);
    expect(captured.calls).toHaveLength(0);
  });

  it('still refuses body-supplied execution options', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({
        brief: validBrief,
        teams: [
          { id: 'team-a', model: 'claude', persona: 'architect', agentId: 'agent-alpha' },
          { id: 'team-b', model: 'claude', persona: 'architect', agentId: 'agent-beta' },
        ],
        options: { claudeBin: '/tmp/evil', skipSandbox: true, logDir: '/tmp/evil-logs' },
      });

    expect(res.status).toBe(201);
    const options = captured.calls[0]!.options;
    expect(options.claudeBin).toBe(process.env.CLAUDE_BIN);
    expect(options.skipSandbox).toBe((process.env.ARENA_SKIP_SANDBOX ?? '').toLowerCase() === 'true');
    expect(options.logDir).toBe(process.env.ARENA_LOG_DIR);
  });
});
