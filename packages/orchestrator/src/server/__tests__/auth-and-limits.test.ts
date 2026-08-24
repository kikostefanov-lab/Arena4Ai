/**
 * The HTTP surface as a stranger sees it.
 *
 * Two regressions live here, both found while getting the project ready to be
 * self-hosted by people we have never met:
 *
 *  1. `requireApiKey` was wired into exactly one router (competitions). Every
 *     other mutating route was open — including ones that LAUNCH competitions
 *     or spawn the `claude` CLI on the operator's own machine with the
 *     operator's own subscription. Auth now applies app-wide to mutating verbs.
 *
 *  2. The 5/min limiter on forge and synthesis was registered AFTER the
 *     /competitions router. Express matches in registration order, so the
 *     router answered first and the limiter never ran — the two most expensive
 *     routes in the product were capped only by the generic 10/min.
 *
 * Read-only routes stay open on purpose; that is the documented behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompetitionState } from '@arena/shared';
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

// Nothing below should ever reach an LLM. If auth regresses, these blow up
// loudly instead of quietly spending the operator's tokens.
const spawnedLlmCalls: string[] = [];
vi.mock('../routes/generate-brief.js', async () => {
  const { Router } = await import('express');
  const router = Router();
  router.post('/', (_req, res) => { spawnedLlmCalls.push('generate-brief'); res.json({ ok: true }); });
  router.post('/intake', (_req, res) => { spawnedLlmCalls.push('intake'); res.json({ ok: true }); });
  router.post('/generate', (_req, res) => { spawnedLlmCalls.push('generate'); res.json({ ok: true }); });
  return { generateBriefRouter: router };
});
vi.mock('../routes/generate-persona.js', async () => {
  const { Router } = await import('express');
  const router = Router();
  router.post('/', (_req, res) => { spawnedLlmCalls.push('generate-persona'); res.json({ ok: true }); });
  return { generatePersonaRouter: router };
});

import { createApp } from '../app.js';
import type { Application } from 'express';

/** Mutating routes that were reachable without a key before this fix. */
const UNGATED_MUTATING_ROUTES: Array<[method: 'post' | 'put' | 'delete', path: string]> = [
  ['post', '/tournaments'],
  ['post', '/briefs'],
  ['put', '/briefs/some-brief'],
  ['delete', '/briefs/some-brief'],
  ['post', '/generate-brief'],
  ['post', '/generate-brief/intake'],
  ['post', '/generate-brief/generate'],
  ['post', '/generate-persona'],
  ['post', '/agents'],
  ['post', '/personas'],
  ['post', '/agent-profiles'],
];

describe('auth covers every mutating route, not just /competitions', () => {
  let app: Application;
  const savedKey = process.env.ARENA_API_KEY;

  beforeEach(() => {
    spawnedLlmCalls.length = 0;
    process.env.ARENA_API_KEY = 'test-key';
    app = createApp();
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ARENA_API_KEY;
    else process.env.ARENA_API_KEY = savedKey;
  });

  it.each(UNGATED_MUTATING_ROUTES)(
    'rejects an unauthenticated %s %s with 401',
    async (method, path) => {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(401);
    },
  );

  it('never reaches an LLM-spawning handler without a key', async () => {
    await request(app).post('/generate-brief').send({ idea: 'x' });
    await request(app).post('/generate-persona').send({ idea: 'x' });
    await request(app).post('/generate-brief/intake').send({ idea: 'x' });
    expect(spawnedLlmCalls).toEqual([]);
  });

  it('lets a correctly-keyed mutating request through', async () => {
    const res = await request(app)
      .post('/briefs')
      .set('Authorization', 'Bearer test-key')
      .send({ brief: { title: 'A brief' } });
    expect(res.status).toBe(201);
  });

  it('rejects a wrong key', async () => {
    const res = await request(app)
      .post('/briefs')
      .set('Authorization', 'Bearer nope')
      .send({ brief: { title: 'A brief' } });
    expect(res.status).toBe(401);
  });

  it('leaves read-only routes open — that is the documented contract', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/briefs')).status).toBe(200);
    expect((await request(app).get('/models')).status).toBe(200);
  });

  it('still answers the CORS preflight without a key', async () => {
    const res = await request(app).options('/briefs');
    expect(res.status).toBe(204);
  });
});

describe('auth stays off when no key is configured (dev mode)', () => {
  const savedKey = process.env.ARENA_API_KEY;

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ARENA_API_KEY;
    else process.env.ARENA_API_KEY = savedKey;
  });

  it('allows an unauthenticated mutating request', async () => {
    delete process.env.ARENA_API_KEY;
    const app = createApp();
    const res = await request(app).post('/briefs').send({ brief: { title: 'A brief' } });
    expect(res.status).toBe(201);
  });
});

describe('the 5/min forge + synthesis limiter actually runs', () => {
  const savedKey = process.env.ARENA_API_KEY;

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ARENA_API_KEY;
    else process.env.ARENA_API_KEY = savedKey;
  });

  it.each(['forge', 'synthesis'])('caps POST /competitions/:id/%s at 5 per minute', async (route) => {
    delete process.env.ARENA_API_KEY;
    const app = createApp();
    const path = `/competitions/abc/${route}`;

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await request(app).post(path).send({})).status);
    }

    // The first five get through to the handler (404 — no such competition).
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    // The sixth is refused by the limiter, which previously never ran.
    expect(statuses[5]).toBe(429);
  });
});

describe('the create limiter charges CREATES ONLY, never reads', () => {
  const savedKey = process.env.ARENA_API_KEY;

  afterEach(() => {
    if (savedKey === undefined) delete process.env.ARENA_API_KEY;
    else process.env.ARENA_API_KEY = savedKey;
  });

  // The bug: mounted as `app.use('/competitions', createLimiter, router)`, the
  // 10-per-minute CREATE budget was spent by every GET underneath it. Opening a
  // competition page a few times returned 429 and the arena rendered nothing —
  // a limiter on a read path fails as missing content, not as a visible error.
  it.each([
    ['list', '/competitions'],
    ['one competition', '/competitions/abc'],
    ['its events', '/competitions/abc/events'],
    ['forge status', '/competitions/abc/forge'],
    ['synthesis status', '/competitions/abc/synthesis'],
  ])('never 429s a GET of %s, however many times it is read', async (_label, path) => {
    delete process.env.ARENA_API_KEY;
    const app = createApp();

    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await request(app).get(path)).status);
    }

    expect(statuses.filter((s) => s === 429)).toEqual([]);
  });

  it('still caps POST /competitions at 10 per minute', async () => {
    delete process.env.ARENA_API_KEY;
    const app = createApp();

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await request(app).post('/competitions').send({}).catch(() => ({ status: 0 }) as never)).status);
    }

    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('reading does not consume the create budget', async () => {
    // The property that actually matters: a viewer refreshing a page must not
    // make the next legitimate create fail.
    delete process.env.ARENA_API_KEY;
    const app = createApp();

    for (let i = 0; i < 30; i++) await request(app).get('/competitions/abc/events');
    const afterReads = await request(app).post('/competitions').send({});

    expect(afterReads.status).not.toBe(429);
  });
});
