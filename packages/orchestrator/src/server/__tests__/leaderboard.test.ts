import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock DB client before any module that transitively imports it
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

// Mock repo before imports
vi.mock('../repo.js', () => ({
  repo: {
    list: vi.fn(),
    listResults: vi.fn(),
  },
}));
vi.mock('../runner-registry.js', () => ({ runnerRegistry: new Map() }));
vi.mock('../websocket.js', () => ({ attachWebSocket: vi.fn() }));

import { createApp } from '../app.js';
import { repo } from '../repo.js';
import type { Application } from 'express';

// Helpers
const mockList = repo.list as ReturnType<typeof vi.fn>;
const mockListResults = repo.listResults as ReturnType<typeof vi.fn>;

describe('GET /leaderboard', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
  });

  it('returns [] when there are no completed competitions', async () => {
    mockList.mockResolvedValue([]);
    mockListResults.mockResolvedValue([]);

    const res = await request(app).get('/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns [] when all competitions are not yet complete', async () => {
    mockList.mockResolvedValue([
      { id: 'c1', state: 'RUNNING', teams: [{ id: 'a', model: 'claude' }, { id: 'b', model: 'gemini' }] },
    ]);
    mockListResults.mockResolvedValue([]);

    const res = await request(app).get('/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns correct stats for a single completed competition', async () => {
    mockList.mockResolvedValue([
      {
        id: 'comp-1',
        state: 'COMPLETE',
        teams: [
          { id: 'team-a', model: 'claude', persona: 'architect' },
          { id: 'team-b', model: 'gemini', persona: 'speedrunner' },
        ],
      },
    ]);

    mockListResults.mockResolvedValue([
      {
        competitionId: 'comp-1',
        winnerId: 'team-a',
        scorecards: [
          { teamId: 'team-a', finalScore: 0.8, judgeResults: [], rank: 1 },
          { teamId: 'team-b', finalScore: 0.6, judgeResults: [], rank: 1 },
        ],
      },
    ]);

    const res = await request(app).get('/leaderboard');
    expect(res.status).toBe(200);

    const leaderboard = res.body as Array<{
      rank: number;
      model: string;
      wins: number;
      losses: number;
      ties: number;
      totalCompetitions: number;
      avgScore: number;
      winRate: number;
    }>;

    expect(leaderboard).toHaveLength(2);

    const claudeEntry = leaderboard.find((e) => e.model === 'claude');
    const geminiEntry = leaderboard.find((e) => e.model === 'gemini');

    expect(claudeEntry).toBeDefined();
    expect(claudeEntry!.wins).toBe(1);
    expect(claudeEntry!.losses).toBe(0);
    expect(claudeEntry!.ties).toBe(0);
    expect(claudeEntry!.totalCompetitions).toBe(1);
    expect(claudeEntry!.avgScore).toBe(0.8);
    expect(claudeEntry!.winRate).toBe(1);
    expect(claudeEntry!.rank).toBe(1);

    expect(geminiEntry).toBeDefined();
    expect(geminiEntry!.wins).toBe(0);
    expect(geminiEntry!.losses).toBe(1);
    expect(geminiEntry!.ties).toBe(0);
    expect(geminiEntry!.totalCompetitions).toBe(1);
    expect(geminiEntry!.avgScore).toBe(0.6);
    expect(geminiEntry!.winRate).toBe(0);
    expect(geminiEntry!.rank).toBe(2);
  });

  it('in a three-team match with a tie for first, the third team lost rather than drew', async () => {
    mockList.mockResolvedValue([
      { id: 'c3', state: 'COMPLETE', teams: [{ id: 'a', model: 'claude' }, { id: 'b', model: 'codex' }, { id: 'c', model: 'gemini' }] },
    ]);
    mockListResults.mockResolvedValue([
      {
        competitionId: 'c3',
        winnerId: null,
        scorecards: [
          { teamId: 'a', finalScore: 0.8, judgeResults: [], rank: 1 },
          { teamId: 'b', finalScore: 0.8, judgeResults: [], rank: 1 },
          { teamId: 'c', finalScore: 0.4, judgeResults: [], rank: 3 },
        ],
      },
    ]);
    const res = await request(app).get('/leaderboard');
    const by = (m: string) => (res.body as Array<{ model: string; wins: number; losses: number; ties: number }>).find((e) => e.model === m)!;
    expect(by('claude')).toMatchObject({ wins: 0, losses: 0, ties: 1 });
    expect(by('codex')).toMatchObject({ wins: 0, losses: 0, ties: 1 });
    expect(by('gemini')).toMatchObject({ wins: 0, losses: 1, ties: 0 });
  });

  it('counts ties when winnerId is null', async () => {
    mockList.mockResolvedValue([
      {
        id: 'comp-tie',
        state: 'COMPLETE',
        teams: [
          { id: 'team-a', model: 'claude' },
          { id: 'team-b', model: 'codex' },
        ],
      },
    ]);

    mockListResults.mockResolvedValue([
      {
        competitionId: 'comp-tie',
        winnerId: null,
        scorecards: [
          { teamId: 'team-a', finalScore: 0.7, judgeResults: [], rank: 1 },
          { teamId: 'team-b', finalScore: 0.7, judgeResults: [], rank: 1 },
        ],
      },
    ]);

    const res = await request(app).get('/leaderboard');
    expect(res.status).toBe(200);

    const leaderboard = res.body as Array<{ model: string; wins: number; losses: number; ties: number }>;
    const claudeEntry = leaderboard.find((e) => e.model === 'claude');
    const codexEntry  = leaderboard.find((e) => e.model === 'codex');

    expect(claudeEntry!.ties).toBe(1);
    expect(claudeEntry!.wins).toBe(0);
    expect(codexEntry!.ties).toBe(1);
    expect(codexEntry!.wins).toBe(0);
  });

  it('aggregates stats across multiple competitions', async () => {
    mockList.mockResolvedValue([
      {
        id: 'comp-1',
        state: 'COMPLETE',
        teams: [
          { id: 'a1', model: 'claude' },
          { id: 'b1', model: 'gemini' },
        ],
      },
      {
        id: 'comp-2',
        state: 'COMPLETE',
        teams: [
          { id: 'a2', model: 'claude' },
          { id: 'b2', model: 'gemini' },
        ],
      },
    ]);

    mockListResults.mockResolvedValue([
      {
        competitionId: 'comp-1',
        winnerId: 'a1',
        scorecards: [{ teamId: 'a1', finalScore: 0.9, judgeResults: [], rank: 1 }, { teamId: 'b1', finalScore: 0.5, judgeResults: [], rank: 1 }],
      },
      {
        competitionId: 'comp-2',
        winnerId: 'b2',
        scorecards: [{ teamId: 'a2', finalScore: 0.4, judgeResults: [], rank: 1 }, { teamId: 'b2', finalScore: 0.8, judgeResults: [], rank: 1 }],
      },
    ]);

    const res = await request(app).get('/leaderboard');
    expect(res.status).toBe(200);

    const leaderboard = res.body as Array<{
      model: string;
      wins: number;
      losses: number;
      totalCompetitions: number;
      avgScore: number;
      winRate: number;
    }>;

    const claudeEntry = leaderboard.find((e) => e.model === 'claude');
    const geminiEntry = leaderboard.find((e) => e.model === 'gemini');

    expect(claudeEntry!.wins).toBe(1);
    expect(claudeEntry!.losses).toBe(1);
    expect(claudeEntry!.totalCompetitions).toBe(2);
    // avgScore = (90 + 40) / 2 = 65
    expect(claudeEntry!.avgScore).toBe(0.65);
    expect(claudeEntry!.winRate).toBe(0.5);

    expect(geminiEntry!.wins).toBe(1);
    expect(geminiEntry!.losses).toBe(1);
    expect(geminiEntry!.totalCompetitions).toBe(2);
    // avgScore = (50 + 80) / 2 = 65
    expect(geminiEntry!.avgScore).toBe(0.65);
    expect(geminiEntry!.winRate).toBe(0.5);
  });

  it.each(['SCORED', 'SYNTHESIZING', 'COMPLETE', 'FORGING', 'FORGE_COMPLETE'])(
    'keeps a %s competition in the standings',
    async (state) => {
      mockList.mockResolvedValue([
        { id: 'c', state, teams: [{ id: 'a', model: 'claude' }, { id: 'b', model: 'gemini' }] },
      ]);
      mockListResults.mockResolvedValue([
        { competitionId: 'c', winnerId: 'a', scorecards: [
          { teamId: 'a', finalScore: 0.9, judgeResults: [], rank: 1 },
          { teamId: 'b', finalScore: 0.5, judgeResults: [], rank: 2 },
        ] },
      ]);
      const res = await request(app).get('/leaderboard');
      expect(res.body).toHaveLength(2);
      expect(mockListResults).toHaveBeenCalledWith(['c']);
    },
  );

  it.each(['RUNNING', 'FAILED', 'CANCELLED'])('excludes a %s competition', async (state) => {
    mockList.mockResolvedValue([
      { id: 'c', state, teams: [{ id: 'a', model: 'claude' }, { id: 'b', model: 'gemini' }] },
    ]);
    const res = await request(app).get('/leaderboard');
    expect(res.body).toEqual([]);
  });
});
