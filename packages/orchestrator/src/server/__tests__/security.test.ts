/**
 * Security regressions for the HTTP surface.
 *
 * The orchestrator listens on a port on a self-hoster's machine. Everything in
 * here guards the two ways a request used to be able to reach the host:
 * naming the binary to spawn, and turning the Docker sandbox off.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompetitionState, CompetitionFormat } from '@arena/shared';
import request from 'supertest';

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

/** Every RunOptions object the route handed to a CompetitionRunner. */
const runnerOptions: Array<Record<string, unknown>> = [];

vi.mock('../../engine/competition-runner.js', async () => {
  const { EventEmitter } = await import('node:events');

  class MockCompetitionRunner extends EventEmitter {
    competitionId = 'mock-competition';
    constructor(_brief: unknown, _teams: unknown, options: Record<string, unknown> = {}) {
      super();
      runnerOptions.push(options);
    }
    run = vi.fn().mockResolvedValue({
      competition: { id: 'mock-competition', state: CompetitionState.COMPLETE },
      scorecards: [],
      winner: null,
    });
    cancel = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    resume = vi.fn();
  }

  return { CompetitionRunner: MockCompetitionRunner };
});

import { createApp } from '../app.js';
import { isSafeTeamId, resolveRunOptions } from '../run-options.js';
import type { Application } from 'express';

const validBrief = {
  id: 'test-001',
  title: 'Test Competition',
  format: CompetitionFormat.SPRINT,
  problem: 'Solve this test problem',
  constraints: ['No external APIs'],
  deliverables: ['A working solution'],
  timeLimitMs: 300_000,
  rubric: {
    criteria: [{ id: 'correctness', description: 'Is it correct?', maxScore: 10, weight: 1 }],
  },
};

const validTeams = [
  { id: 'team-a', model: 'claude', persona: 'speedrunner' },
  { id: 'team-b', model: 'claude', persona: 'architect' },
];

describe('POST /competitions — execution options are not caller-controlled', () => {
  let app: Application;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    runnerOptions.length = 0;
    delete process.env.ARENA_SKIP_SANDBOX;
    delete process.env.CLAUDE_BIN;
    delete process.env.ARENA_LOG_DIR;
    app = createApp();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('IGNORES a claudeBin supplied in the request body (RCE guard)', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({
        brief: validBrief,
        teams: validTeams,
        options: { claudeBin: '/tmp/evil.sh' },
      });

    expect(res.status).toBe(201);
    expect(runnerOptions).toHaveLength(1);
    expect(runnerOptions[0].claudeBin).toBeUndefined();
  });

  it('takes the agent binary from the environment, never the body', async () => {
    process.env.CLAUDE_BIN = '/usr/local/bin/claude';

    const res = await request(app)
      .post('/competitions')
      .send({ brief: validBrief, teams: validTeams, options: { claudeBin: '/tmp/evil.sh' } });

    expect(res.status).toBe(201);
    expect(runnerOptions[0].claudeBin).toBe('/usr/local/bin/claude');
  });

  it('IGNORES a body-supplied logDir', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({ brief: validBrief, teams: validTeams, options: { logDir: '/etc/cron.d' } });

    expect(res.status).toBe(201);
    expect(runnerOptions[0].logDir).toBeUndefined();
  });

  it('runs sandboxed by default — the body cannot turn the sandbox off', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({ brief: validBrief, teams: validTeams, options: { skipSandbox: true } });

    expect(res.status).toBe(201);
    expect(runnerOptions[0].skipSandbox).toBe(false);
  });

  it('honours ARENA_SKIP_SANDBOX=true as the deliberate local-dev opt-out', async () => {
    process.env.ARENA_SKIP_SANDBOX = 'true';
    const envApp = createApp();

    const res = await request(envApp)
      .post('/competitions')
      .send({ brief: validBrief, teams: validTeams });

    expect(res.status).toBe(201);
    expect(runnerOptions[0].skipSandbox).toBe(true);
  });

  it('still forwards the harmless commentary flag', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({ brief: validBrief, teams: validTeams, options: { commentary: true } });

    expect(res.status).toBe(201);
    expect(runnerOptions[0].commentary).toBe(true);
  });
});

describe('POST /competitions — team id validation', () => {
  let app: Application;

  beforeEach(() => {
    runnerOptions.length = 0;
    app = createApp();
  });

  it.each([
    ['path traversal', '../../../../etc'],
    ['shell metacharacters', 'a; touch /tmp/pwned'],
    ['command substitution', '$(id)'],
    ['a slash', 'team/a'],
  ])('rejects a team id with %s', async (_label, badId) => {
    const res = await request(app)
      .post('/competitions')
      .send({
        brief: validBrief,
        teams: [{ id: badId, model: 'claude' }, { id: 'team-b', model: 'claude' }],
      });

    expect(res.status).toBe(400);
    expect(runnerOptions).toHaveLength(0);
  });

  it('accepts ordinary team ids', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({ brief: validBrief, teams: validTeams });

    expect(res.status).toBe(201);
  });
});

describe('POST /tournaments — execution options are not caller-controlled', () => {
  let app: Application;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ARENA_SKIP_SANDBOX;
    app = createApp();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('rejects a team spec carrying shell metacharacters', async () => {
    const res = await request(app)
      .post('/tournaments')
      .send({
        brief: {
          title: 'T',
          format: 'SPRINT',
          problem: 'p',
          rubric: { criteria: [{ id: 'c', description: 'd', maxScore: 10, weight: 1 }] },
        },
        teams: ['claude:architect', 'gemini:speedrunner; touch /tmp/pwned'],
      });

    expect(res.status).toBe(400);
  });
});

describe('run-options helpers', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('defaults skipSandbox to false', () => {
    delete process.env.ARENA_SKIP_SANDBOX;
    expect(resolveRunOptions().skipSandbox).toBe(false);
  });

  it('only accepts an exact "true" for the opt-out', () => {
    process.env.ARENA_SKIP_SANDBOX = 'yes';
    expect(resolveRunOptions().skipSandbox).toBe(false);
    process.env.ARENA_SKIP_SANDBOX = 'TRUE';
    expect(resolveRunOptions().skipSandbox).toBe(true);
  });

  it('isSafeTeamId accepts normal ids and rejects traversal/shell characters', () => {
    expect(isSafeTeamId('team-a')).toBe(true);
    expect(isSafeTeamId('Team_1.v2')).toBe(true);
    expect(isSafeTeamId('..')).toBe(false);
    expect(isSafeTeamId('a b')).toBe(false);
    expect(isSafeTeamId('`id`')).toBe(false);
    expect(isSafeTeamId('')).toBe(false);
    expect(isSafeTeamId('x'.repeat(65))).toBe(false);
  });
});
