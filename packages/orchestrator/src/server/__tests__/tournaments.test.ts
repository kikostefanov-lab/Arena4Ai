import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock DB client before any module that transitively imports it
vi.mock('../../db/client.js', () => ({ db: {} }));

// Use vi.hoisted so the store and repo object are available inside the hoisted vi.mock factory
const { tournamentStore, mockTournamentRepo } = vi.hoisted(() => {
  const store = new Map<string, object>();
  const repo = {
    createTournament: vi.fn().mockImplementation((t: { id: string; name: string; teams: string[]; state: string; matchIds: string[]; rankings: null }) => {
      store.set(t.id, { ...t, createdAt: new Date().toISOString(), completedAt: null });
      return Promise.resolve(undefined);
    }),
    getTournament: vi.fn().mockImplementation((id: string) => {
      return Promise.resolve(store.get(id) ?? null);
    }),
    updateTournamentState: vi.fn().mockResolvedValue(undefined),
    updateTournamentProgress: vi.fn().mockResolvedValue(undefined),
    listTournaments: vi.fn().mockImplementation(() => {
      return Promise.resolve(Array.from(store.values()));
    }),
  };
  return { tournamentStore: store, mockTournamentRepo: repo };
});

vi.mock('../../db/repository.js', () => ({
  CompetitionRepository: vi.fn(),
  TournamentRepository: vi.fn().mockImplementation(() => mockTournamentRepo),
}));

// Mock dependencies before importing app
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

// Mock TournamentRunner — resolves immediately so POST returns 201
vi.mock('../../engine/tournament-runner.js', async () => {
  const { EventEmitter } = await import('node:events');

  class MockTournamentRunner extends EventEmitter {
    readonly tournamentId = 'mock-tournament-id';
    run = vi.fn().mockResolvedValue({
      tournamentId: 'mock-tournament-id',
      name: 'Mock Tournament',
      matchIds: ['match-1', 'match-2'],
      rankings: [
        { model: 'claude:architect', wins: 1, losses: 0, draws: 0, totalScore: 8, matchesPlayed: 1 },
        { model: 'gemini:speedrunner', wins: 0, losses: 1, draws: 0, totalScore: 5, matchesPlayed: 1 },
      ],
    });
    cancel = vi.fn();
  }

  return { TournamentRunner: MockTournamentRunner };
});

import { createApp } from '../app.js';
import type { Application } from 'express';

// Clear in-memory store between tests
beforeEach(() => {
  tournamentStore.clear();
});

const validBrief = {
  title: 'Test Tournament Brief',
  format: 'SPRINT',
  problem: 'Solve FizzBuzz',
  constraints: ['No libraries'],
  deliverables: ['A working solution'],
  timeLimitMs: 60_000,
  rubric: {
    criteria: [
      { id: 'correctness', description: 'Is it correct?', maxScore: 10, weight: 1 },
    ],
  },
};

const validTeams = ['claude:architect', 'gemini:speedrunner'];

describe('POST /tournaments', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp();
  });

  it('returns 201 with tournamentId for a valid body', async () => {
    const res = await request(app)
      .post('/tournaments')
      .send({ brief: validBrief, teams: validTeams });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('tournamentId');
    expect(typeof res.body.tournamentId).toBe('string');
  });

  it('returns 400 for an invalid body (missing brief)', async () => {
    const res = await request(app)
      .post('/tournaments')
      .send({ teams: validTeams });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when teams has fewer than 2 entries', async () => {
    const res = await request(app)
      .post('/tournaments')
      .send({ brief: validBrief, teams: ['claude:architect'] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('GET /tournaments/:id', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp();
  });

  it('returns 404 for a non-existent tournament', async () => {
    const res = await request(app).get('/tournaments/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Tournament not found');
  });

  it('returns 200 with tournament data after creating a tournament', async () => {
    // Create a tournament first
    const createRes = await request(app)
      .post('/tournaments')
      .send({ brief: validBrief, teams: validTeams });

    expect(createRes.status).toBe(201);
    const { tournamentId } = createRes.body as { tournamentId: string };

    const getRes = await request(app).get(`/tournaments/${tournamentId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveProperty('id', tournamentId);
    expect(getRes.body).toHaveProperty('state');
    expect(getRes.body).toHaveProperty('teams');
  });
});

describe('GET /tournaments', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp();
  });

  it('returns an array', async () => {
    const res = await request(app).get('/tournaments');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
