import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/client.js', () => ({ db: {} }));
vi.mock('../../db/repository.js', () => ({
  CompetitionRepository: vi.fn(),
  TournamentRepository: vi.fn().mockImplementation(() => ({})),
  BriefsRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('../routes/briefs-seed.js', () => ({ seedYamlBriefs: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../repo.js', () => ({ repo: { list: vi.fn(), listResults: vi.fn() } }));
vi.mock('../runner-registry.js', () => ({ runnerRegistry: new Map() }));
vi.mock('../websocket.js', () => ({ attachWebSocket: vi.fn() }));

import { createApp } from '../app.js';
import { repo } from '../repo.js';

const mockList = repo.list as ReturnType<typeof vi.fn>;
const mockListResults = repo.listResults as ReturnType<typeof vi.fn>;

describe('GET /analytics/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['COMPLETE', 'FORGING', 'FORGE_COMPLETE'])('counts a %s competition as completed', async (state) => {
    const start = new Date('2026-01-01T00:00:00Z');
    mockList.mockResolvedValue([
      {
        id: 'c1',
        state,
        brief: { title: 'T', format: 'SPRINT' },
        teams: [{ id: 'a', model: 'claude' }, { id: 'b', model: 'gemini' }],
        startedAt: start,
        completedAt: new Date(start.getTime() + 60_000),
      },
    ]);
    mockListResults.mockResolvedValue([{ competitionId: 'c1', winnerId: 'a', synthesis: null }]);

    const res = await request(createApp()).get('/analytics/summary');
    expect(res.status).toBe(200);
    expect(mockListResults).toHaveBeenCalledWith(['c1']);
    expect(res.body.completedCompetitions).toBe(1);
    expect(res.body.completionRate).toBe(1);
    expect(res.body.avgDurationMs).toBe(60_000);
    expect(res.body.recentCompetitions).toHaveLength(1);
    expect(res.body.byFormat[0].completed).toBe(1);
  });
});
