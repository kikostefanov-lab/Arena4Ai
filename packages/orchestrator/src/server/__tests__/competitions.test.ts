import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompetitionState, CompetitionFormat } from '@arena/shared';
import request from 'supertest';

// Mock DB client and repository — must be before any module imports.
vi.mock('../../db/client.js', () => ({ db: {} }));
vi.mock('../../db/repository.js', () => {
  const knownIds = new Set<string>();
  const MockRepo = vi.fn().mockImplementation(() => ({
    create: vi.fn().mockImplementation((id: string) => {
      knownIds.add(id);
      return Promise.resolve();
    }),
    updateState: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    saveResult: vi.fn().mockResolvedValue(undefined),
    getCompetition: vi.fn().mockImplementation((id: string) => {
      if (knownIds.has(id)) {
        return Promise.resolve({ id, state: 'COMPLETE', startedAt: null, completedAt: null });
      }
      return Promise.resolve(null);
    }),
    getEvents: vi.fn().mockResolvedValue([]),
    countEvents: vi.fn().mockResolvedValue(0),
    getResult: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
  }));
  return { CompetitionRepository: MockRepo };
});
vi.mock('../runner-registry.js', () => ({ runnerRegistry: new Map() }));
vi.mock('../websocket.js', () => ({ attachWebSocket: vi.fn() }));

// Mock CompetitionRunner — must be declared before importing modules that use it.
// vi.mock is hoisted to the top of the file by Vitest automatically.
vi.mock('../../engine/competition-runner.js', async () => {
  const { EventEmitter } = await import('node:events');

  class MockCompetitionRunner extends EventEmitter {
    competitionId = 'mock-competition';
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

// Import after mock is declared (vi.mock is hoisted so order here doesn't matter at runtime)
import { createApp } from '../app.js';
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
    criteria: [
      {
        id: 'correctness',
        description: 'Is the solution correct?',
        maxScore: 10,
        weight: 1,
      },
    ],
  },
};

const validTeams = [
  { id: 'team-a', model: 'claude', persona: 'speedrunner' },
  { id: 'team-b', model: 'claude', persona: 'architect' },
];

describe('POST /competitions', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp();
  });

  it('returns 201 with competitionId for a valid brief', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({ brief: validBrief, teams: validTeams });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('competitionId');
    expect(typeof res.body.competitionId).toBe('string');
  });

  it('returns 400 for an invalid brief (missing required field)', async () => {
    const { title: _title, ...invalidBrief } = validBrief;

    const res = await request(app)
      .post('/competitions')
      .send({ brief: invalidBrief, teams: validTeams });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid brief');
    expect(res.body).toHaveProperty('details');
  });

  it('returns 400 for an invalid brief (wrong type)', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({ brief: 'not-an-object', teams: validTeams });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid brief');
  });

  it('returns 400 when teams is missing', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({ brief: validBrief });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when teams has wrong length', async () => {
    const res = await request(app)
      .post('/competitions')
      .send({ brief: validBrief, teams: [validTeams[0]] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when rubric weights do not sum to 1', async () => {
    const badBrief = {
      ...validBrief,
      rubric: {
        criteria: [
          { id: 'a', description: 'A', maxScore: 10, weight: 0.5 },
          { id: 'b', description: 'B', maxScore: 10, weight: 0.3 },
        ],
      },
    };

    const res = await request(app)
      .post('/competitions')
      .send({ brief: badBrief, teams: validTeams });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid brief');
  });
});

describe('GET /competitions/:id', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp();
  });

  it('returns 404 for a nonexistent competition', async () => {
    const res = await request(app).get('/competitions/nonexistent-id');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Competition not found');
  });

  it('returns 200 with state info after creating a competition', async () => {
    const createRes = await request(app)
      .post('/competitions')
      .send({ brief: validBrief, teams: validTeams });

    expect(createRes.status).toBe(201);
    const { competitionId } = createRes.body as { competitionId: string };

    const getRes = await request(app).get(`/competitions/${competitionId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveProperty('id', competitionId);
    expect(getRes.body).toHaveProperty('state');
    expect(getRes.body).toHaveProperty('eventCount');
  });
});

describe('GET /health', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp();
  });

  it('returns { ok: true }', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('POST /competitions/:id/cancel', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp();
  });

  it('returns 404 when competition not found', async () => {
    const res = await request(app).post('/competitions/nonexistent/cancel');
    expect(res.status).toBe(404);
  });

  it('cancels running competition and returns ok', async () => {
    // Start a competition first — runner is registered in runnerRegistry under its competitionId
    const startRes = await request(app)
      .post('/competitions')
      .send({ brief: validBrief, teams: validTeams });
    expect(startRes.status).toBe(201);
    const { competitionId } = startRes.body as { competitionId: string };

    const res = await request(app).post(`/competitions/${competitionId}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('POST /competitions/:id/pause', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp();
  });

  it('returns 404 when competition not found', async () => {
    const res = await request(app).post('/competitions/nonexistent/pause');
    expect(res.status).toBe(404);
  });
});

describe('POST /competitions/:id/resume', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp();
  });

  it('returns 404 when competition not found', async () => {
    const res = await request(app).post('/competitions/nonexistent/resume');
    expect(res.status).toBe(404);
  });
});
