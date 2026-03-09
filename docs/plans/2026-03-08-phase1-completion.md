# Phase 1 Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace in-memory store + SSE + skip-sandbox with PostgreSQL persistence, WebSocket streaming, Docker sandboxing, API key auth, competition controls, and a gallery home page — closing the Phase 1 gap to match the original roadmap.

**Architecture:** CompetitionRepository (Drizzle + Postgres) replaces CompetitionStore. WebSocket server (ws library) mounts on the Express HTTP server; the browser client connects directly to `ws://localhost:3000`. Docker containers run agent CLIs; adapters wrap spawn in `docker run`. Auth middleware guards mutating routes with `ARENA_API_KEY`.

**Tech Stack:** drizzle-orm, drizzle-kit, pg, ws, @types/ws, @types/pg, Docker

**Prerequisites:**
- PostgreSQL running locally: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=arena -e POSTGRES_DB=arena postgres:16`
- Docker Desktop running (for sandbox containers)
- Env vars: `DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena`, `ARENA_API_KEY=<any-string>`

---

## Task 1: Install Dependencies

**Files:**
- Modify: `packages/orchestrator/package.json`

**Step 1: Install runtime and dev deps**

```bash
cd packages/orchestrator
npm install drizzle-orm pg ws
npm install -D drizzle-kit @types/pg @types/ws
```

**Step 2: Verify installs**

```bash
node -e "require('drizzle-orm'); require('pg'); require('ws'); console.log('ok')"
```
Expected: `ok`

**Step 3: Commit**

```bash
git add packages/orchestrator/package.json packages/orchestrator/package-lock.json
git commit -m "chore(orchestrator): add drizzle-orm, pg, ws dependencies"
```

---

## Task 2: Drizzle Schema + DB Client

**Files:**
- Create: `packages/orchestrator/src/db/schema.ts`
- Create: `packages/orchestrator/src/db/client.ts`
- Create: `packages/orchestrator/drizzle.config.ts`

**Step 1: Write the schema**

Create `packages/orchestrator/src/db/schema.ts`:

```typescript
import { pgTable, text, jsonb, timestamp, integer, index } from 'drizzle-orm/pg-core';

export const competitions = pgTable('competitions', {
  id:          text('id').primaryKey(),
  brief:       jsonb('brief').notNull(),
  teams:       jsonb('teams').notNull(),
  state:       text('state').notNull(),
  startedAt:   timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const events = pgTable('events', {
  id:            text('id').primaryKey(),
  competitionId: text('competition_id').notNull().references(() => competitions.id),
  teamId:        text('team_id').notNull(),
  timestamp:     timestamp('timestamp', { withTimezone: true }).notNull(),
  type:          text('type').notNull(),
  payload:       jsonb('payload'),
  metadata:      jsonb('metadata'),
  seq:           integer('seq').notNull(),
}, (t) => [index('events_competition_id_idx').on(t.competitionId)]);

export const results = pgTable('results', {
  competitionId: text('competition_id').primaryKey().references(() => competitions.id),
  scorecards:    jsonb('scorecards').notNull(),
  winnerId:      text('winner_id'),
  summary:       text('summary'),
});
```

**Step 2: Write the DB client**

Create `packages/orchestrator/src/db/client.ts`:

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export type Db = typeof db;
```

**Step 3: Write Drizzle config**

Create `packages/orchestrator/drizzle.config.ts`:

```typescript
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config;
```

**Step 4: Add db scripts to package.json**

In `packages/orchestrator/package.json`, add to `"scripts"`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate"
```

**Step 5: Generate and run migration**

```bash
cd packages/orchestrator
DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena npm run db:generate
DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena npm run db:migrate
```

Expected: migration files created in `src/db/migrations/`, tables created in Postgres.

**Step 6: Verify tables exist**

```bash
docker exec -it $(docker ps -q -f ancestor=postgres:16) psql -U postgres -d arena -c "\dt"
```

Expected: `competitions`, `events`, `results` tables listed.

**Step 7: Commit**

```bash
git add packages/orchestrator/src/db/ packages/orchestrator/drizzle.config.ts packages/orchestrator/package.json
git commit -m "feat(db): add drizzle schema and migrations for competitions, events, results"
```

---

## Task 3: CompetitionRepository

**Files:**
- Create: `packages/orchestrator/src/db/repository.ts`
- Create: `packages/orchestrator/src/db/repository.test.ts`

**Step 1: Write the failing test**

Create `packages/orchestrator/src/db/repository.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CompetitionRepository } from './repository.js';
import { db } from './client.js';
import { competitions, events, results } from './schema.js';
import { CompetitionFormat, CompetitionState } from '@arena/shared';

// These tests require a real Postgres connection.
// Run with: DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena npx vitest run src/db/repository.test.ts

const repo = new CompetitionRepository(db);

const testBrief = {
  id: 'test-brief-001',
  title: 'Test',
  format: CompetitionFormat.SPRINT,
  problem: 'Test problem',
  constraints: [],
  deliverables: ['solution'],
  timeLimitMs: 60_000,
  rubric: { criteria: [{ id: 'correctness', description: 'correct', maxScore: 10, weight: 1 }] },
};

const testTeams: [{ id: string; model: string; persona: string }, { id: string; model: string; persona: string }] = [
  { id: 'team-a', model: 'claude:architect', persona: 'architect' },
  { id: 'team-b', model: 'gemini:speedrunner', persona: 'speedrunner' },
];

let competitionId: string;

beforeAll(async () => {
  competitionId = `test-${Date.now()}`;
  await repo.create(competitionId, testBrief as never, testTeams);
});

afterAll(async () => {
  await db.delete(results).where({ competitionId } as never).catch(() => {});
  await db.delete(events).where({ competitionId: competitionId } as never).catch(() => {});
  await db.delete(competitions).where({ id: competitionId } as never).catch(() => {});
});

describe('CompetitionRepository', () => {
  it('creates a competition row', async () => {
    const comp = await repo.getCompetition(competitionId);
    expect(comp).not.toBeNull();
    expect(comp?.state).toBe(CompetitionState.DRAFT);
  });

  it('appends events with sequential seq numbers', async () => {
    const event1 = { eventId: 'evt-1', competitionId, teamId: 'team-a', timestamp: new Date().toISOString(), type: 'REASONING', payload: 'thinking', metadata: {} };
    const event2 = { eventId: 'evt-2', competitionId, teamId: 'team-b', timestamp: new Date().toISOString(), type: 'FILE_CREATE', payload: 'file.ts', metadata: {} };
    await repo.appendEvent(event1 as never);
    await repo.appendEvent(event2 as never);

    const stored = await repo.getEvents(competitionId);
    expect(stored).toHaveLength(2);
    expect(stored[0].id).toBe('evt-1');
    expect(stored[1].seq).toBeGreaterThan(stored[0].seq);
  });

  it('updates state', async () => {
    await repo.updateState(competitionId, CompetitionState.RUNNING);
    const comp = await repo.getCompetition(competitionId);
    expect(comp?.state).toBe(CompetitionState.RUNNING);
  });

  it('saves result', async () => {
    await repo.saveResult(competitionId, { scorecards: [], winner: 'team-a', summary: 'team-a wins' });
    const comp = await repo.getCompetition(competitionId);
    expect(comp).not.toBeNull();
  });

  it('lists competitions', async () => {
    const list = await repo.list(10);
    expect(list.some((c) => c.id === competitionId)).toBe(true);
  });

  it('getEvents with afterSeq returns only newer events', async () => {
    const all = await repo.getEvents(competitionId);
    const afterFirst = await repo.getEvents(competitionId, all[0].seq);
    expect(afterFirst).toHaveLength(all.length - 1);
  });
});
```

**Step 2: Run to confirm it fails**

```bash
cd packages/orchestrator
DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena npx vitest run src/db/repository.test.ts
```

Expected: FAIL — `CompetitionRepository` not defined.

**Step 3: Write the repository**

Create `packages/orchestrator/src/db/repository.ts`:

```typescript
import { eq, gt, desc } from 'drizzle-orm';
import type { Db } from './client.js';
import { competitions, events, results } from './schema.js';
import type { ArenaEvent, Brief, Team, CompetitionState } from '@arena/shared';

export interface StoredResult {
  scorecards: unknown[];
  winner: string | null;
  summary?: string;
}

export class CompetitionRepository {
  constructor(private readonly db: Db) {}

  async create(id: string, brief: Brief, teams: [Team, Team]): Promise<void> {
    await this.db.insert(competitions).values({
      id,
      brief: brief as unknown as Record<string, unknown>,
      teams: teams as unknown as Record<string, unknown>,
      state: 'DRAFT',
    });
  }

  async getCompetition(id: string) {
    const rows = await this.db.select().from(competitions).where(eq(competitions.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async updateState(id: string, state: CompetitionState): Promise<void> {
    const patch: Record<string, unknown> = { state };
    if (state === 'RUNNING') patch.startedAt = new Date();
    if (state === 'COMPLETE') patch.completedAt = new Date();
    await this.db.update(competitions).set(patch as never).where(eq(competitions.id, id));
  }

  async appendEvent(event: ArenaEvent): Promise<void> {
    // seq = count of existing events for this competition + 1
    const existing = await this.db
      .select({ seq: events.seq })
      .from(events)
      .where(eq(events.competitionId, event.competitionId))
      .orderBy(desc(events.seq))
      .limit(1);

    const seq = (existing[0]?.seq ?? 0) + 1;

    await this.db.insert(events).values({
      id: event.eventId,
      competitionId: event.competitionId,
      teamId: event.teamId,
      timestamp: new Date(event.timestamp),
      type: event.type,
      payload: event.payload as Record<string, unknown>,
      metadata: event.metadata as Record<string, unknown>,
      seq,
    });
  }

  async getEvents(competitionId: string, afterSeq?: number) {
    const base = this.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .orderBy(events.seq);

    if (afterSeq !== undefined) {
      return this.db
        .select()
        .from(events)
        .where(eq(events.competitionId, competitionId))
        .where(gt(events.seq, afterSeq))
        .orderBy(events.seq);
    }

    return base;
  }

  async saveResult(competitionId: string, result: StoredResult): Promise<void> {
    await this.db.insert(results).values({
      competitionId,
      scorecards: result.scorecards as Record<string, unknown>[],
      winnerId: result.winner,
      summary: result.summary,
    });
  }

  async getResult(competitionId: string) {
    const rows = await this.db.select().from(results).where(eq(results.competitionId, competitionId)).limit(1);
    return rows[0] ?? null;
  }

  async list(limit = 20) {
    return this.db
      .select()
      .from(competitions)
      .orderBy(desc(competitions.startedAt))
      .limit(limit);
  }
}
```

**Step 4: Run tests**

```bash
DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena npx vitest run src/db/repository.test.ts
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add packages/orchestrator/src/db/
git commit -m "feat(db): add CompetitionRepository with Drizzle ORM"
```

---

## Task 4: Wire Repository into the Server

Replace `CompetitionStore` with `CompetitionRepository` in the server layer. The in-memory EventEmitter still drives live WebSocket events; Postgres is the durable store.

**Files:**
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`
- Modify: `packages/orchestrator/src/server/app.ts`
- Delete: `packages/orchestrator/src/server/competition-store.ts` (after migration)

**Step 1: Update the competitions router**

Replace `packages/orchestrator/src/server/routes/competitions.ts` entirely:

```typescript
import { Router } from 'express';
import type { Request, Response } from 'express';
import { briefSchema } from '@arena/shared';
import type { Team } from '@arena/shared';
import { CompetitionRunner } from '../../engine/competition-runner.js';
import type { RunOptions } from '../../engine/competition-runner.js';
import { db } from '../../db/client.js';
import { CompetitionRepository } from '../../db/repository.js';
import { runnerRegistry } from '../runner-registry.js';

export const competitionsRouter = Router();
const repo = new CompetitionRepository(db);

// POST /competitions — start a new competition
competitionsRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body as {
    brief?: unknown;
    teams?: unknown;
    options?: { skipSandbox?: boolean; claudeBin?: string; logDir?: string };
  };

  const briefResult = briefSchema.safeParse(body.brief);
  if (!briefResult.success) {
    res.status(400).json({ error: 'Invalid brief', details: briefResult.error.errors });
    return;
  }

  if (!Array.isArray(body.teams) || body.teams.length !== 2) {
    res.status(400).json({ error: 'teams must be an array of exactly 2 team objects' });
    return;
  }

  const rawTeams = body.teams as Array<{ id?: unknown; model?: unknown; persona?: unknown }>;
  for (const team of rawTeams) {
    if (!team.id || !team.model) {
      res.status(400).json({ error: 'Each team must have id and model fields' });
      return;
    }
  }

  const teams: [Team, Team] = rawTeams.map((t) => ({
    id: String(t.id),
    model: String(t.model),
    persona: t.persona ? String(t.persona) : 'pragmatist',
  })) as [Team, Team];

  const options: RunOptions = {
    skipSandbox: body.options?.skipSandbox ?? false,
    claudeBin: body.options?.claudeBin,
    logDir: body.options?.logDir,
  };

  const runner = new CompetitionRunner(briefResult.data, teams, options);
  const { competitionId } = runner;

  // Persist to DB before starting
  await repo.create(competitionId, briefResult.data, teams);

  // Wire runner events → DB
  runner.on('stateChange', (state) => {
    repo.updateState(competitionId, state).catch(console.error);
  });
  runner.on('arenaEvent', (event) => {
    repo.appendEvent(event).catch(console.error);
  });
  runner.on('result', (result) => {
    repo.saveResult(competitionId, {
      scorecards: result.scorecards,
      winner: result.winner,
    }).catch(console.error);
  });

  // Register runner for live WebSocket subscriptions
  runnerRegistry.set(competitionId, runner);
  runner.on('result', () => {
    // Keep in registry briefly for late-joining WebSocket clients
    setTimeout(() => runnerRegistry.delete(competitionId), 60_000);
  });

  runner.run().catch((err: Error) => {
    console.error(`[arena] competition ${competitionId} failed: ${err.message}`);
  });

  res.status(201).json({ competitionId });
});

// GET /competitions — list past competitions
competitionsRouter.get('/', async (_req: Request, res: Response) => {
  const list = await repo.list(20);
  res.json(list);
});

// GET /competitions/:id — get competition status
competitionsRouter.get('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const comp = await repo.getCompetition(id);
  if (!comp) {
    res.status(404).json({ error: 'Competition not found' });
    return;
  }
  const eventCount = await repo.getEvents(id).then((evts) => evts.length);
  const result = await repo.getResult(id);
  res.json({ id: comp.id, state: comp.state, eventCount, result });
});

// POST /competitions/:id/cancel
competitionsRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const runner = runnerRegistry.get(id);
  if (!runner) {
    res.status(404).json({ error: 'Competition not found or already complete' });
    return;
  }
  await runner.cancel();
  res.json({ ok: true });
});

// POST /competitions/:id/pause
competitionsRouter.post('/:id/pause', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const runner = runnerRegistry.get(id);
  if (!runner) {
    res.status(404).json({ error: 'Competition not found or already complete' });
    return;
  }
  runner.pause();
  res.json({ ok: true });
});

// POST /competitions/:id/resume
competitionsRouter.post('/:id/resume', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const runner = runnerRegistry.get(id);
  if (!runner) {
    res.status(404).json({ error: 'Competition not found or already complete' });
    return;
  }
  runner.resume();
  res.json({ ok: true });
});
```

**Step 2: Create the runner registry**

Create `packages/orchestrator/src/server/runner-registry.ts`:

```typescript
import type { CompetitionRunner } from '../engine/competition-runner.js';

/**
 * In-memory map of competitionId → active CompetitionRunner.
 * Used to subscribe WebSocket clients to live events and to
 * route control commands (cancel/pause/resume).
 *
 * Entries are removed 60s after competition completes.
 */
export const runnerRegistry = new Map<string, CompetitionRunner>();
```

**Step 3: Delete the old competition-store.ts**

```bash
rm packages/orchestrator/src/server/competition-store.ts
```

**Step 4: Update the server tests**

The existing `competitions.test.ts` mocks `CompetitionRunner` and tests HTTP responses. Update it to mock the DB too:

In `packages/orchestrator/src/server/__tests__/competitions.test.ts`, add at the top (before the existing `vi.mock`):

```typescript
vi.mock('../../db/client.js', () => ({ db: {} }));
vi.mock('../../db/repository.js', () => {
  const MockRepo = vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    updateState: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
    saveResult: vi.fn().mockResolvedValue(undefined),
    getCompetition: vi.fn().mockResolvedValue({ id: 'mock-competition', state: 'COMPLETE', startedAt: null, completedAt: null }),
    getEvents: vi.fn().mockResolvedValue([]),
    getResult: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
  }));
  return { CompetitionRepository: MockRepo };
});
```

**Step 5: Run tests**

```bash
cd packages/orchestrator
npm run test
```

Expected: 84 tests pass.

**Step 6: Commit**

```bash
git add packages/orchestrator/src/server/ packages/orchestrator/src/db/
git commit -m "feat(server): replace CompetitionStore with CompetitionRepository, add cancel/pause/resume routes"
```

---

## Task 5: WebSocket Server

Replace SSE with a WebSocket server mounted on the same Express HTTP server.

**Files:**
- Create: `packages/orchestrator/src/server/websocket.ts`
- Modify: `packages/orchestrator/src/server/app.ts`
- Delete: `packages/orchestrator/src/server/sse.ts`

**Step 1: Create the WebSocket handler**

Create `packages/orchestrator/src/server/websocket.ts`:

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { db } from '../db/client.js';
import { CompetitionRepository } from '../db/repository.js';
import { runnerRegistry } from './runner-registry.js';

const repo = new CompetitionRepository(db);

export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = req.url ?? '';
    const match = url.match(/^\/competitions\/([^/]+)\/stream$/);
    if (!match) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, match[1]);
    });
  });

  wss.on('connection', async (ws: WebSocket, _req: IncomingMessage, competitionId: string) => {
    let lastSeq = 0;

    // Client may send { lastSeq: number } to resume from a point
    ws.once('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as { lastSeq?: number };
        if (typeof msg.lastSeq === 'number') lastSeq = msg.lastSeq;
      } catch { /* ignore */ }
    });

    // Small delay to allow lastSeq message to arrive before replay
    await new Promise((r) => setTimeout(r, 50));

    const send = (payload: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    // Replay past events from Postgres
    try {
      const pastEvents = await repo.getEvents(competitionId, lastSeq > 0 ? lastSeq : undefined);
      for (const row of pastEvents) {
        send({
          eventId: row.id,
          competitionId: row.competitionId,
          teamId: row.teamId,
          timestamp: row.timestamp,
          type: row.type,
          payload: row.payload,
          metadata: row.metadata,
          _seq: row.seq,
        });
      }
      if (pastEvents.length > 0) {
        lastSeq = pastEvents[pastEvents.length - 1].seq;
      }
    } catch (err) {
      console.error('[ws] replay error:', err);
    }

    // Check if already complete
    const result = await repo.getResult(competitionId);
    if (result) {
      send({ type: 'COMPLETE', result });
      ws.close();
      return;
    }

    // Subscribe to live events from the active runner
    const runner = runnerRegistry.get(competitionId);
    if (!runner) {
      ws.close();
      return;
    }

    let seq = lastSeq;
    const onArenaEvent = (event: unknown) => { seq++; send({ ...(event as object), _seq: seq }); };
    const onStateChange = (state: unknown) => { send({ type: 'STATE_CHANGE', state }); };
    const onResult = (r: unknown) => { send({ type: 'COMPLETE', result: r }); ws.close(); };
    const onError = (err: Error) => { send({ type: 'ERROR', message: err.message }); ws.close(); };

    runner.on('arenaEvent', onArenaEvent);
    runner.on('stateChange', onStateChange);
    runner.on('result', onResult);
    runner.on('error', onError);

    ws.on('close', () => {
      runner.off('arenaEvent', onArenaEvent);
      runner.off('stateChange', onStateChange);
      runner.off('result', onResult);
      runner.off('error', onError);
    });
  });
}
```

**Step 2: Update app.ts to export the HTTP server and attach WebSocket**

Replace `packages/orchestrator/src/server/app.ts`:

```typescript
import http from 'node:http';
import express from 'express';
import type { Application } from 'express';
import { competitionsRouter } from './routes/competitions.js';
import { attachWebSocket } from './websocket.js';

export function createApp(): Application {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/competitions', competitionsRouter);

  return app;
}

export function createServer(): http.Server {
  const app = createApp();
  const server = http.createServer(app);
  attachWebSocket(server);
  return server;
}
```

**Step 3: Update cli.ts to use createServer**

In `packages/orchestrator/src/cli.ts`, find the `serve` command and replace:

```typescript
// Before:
const app = createApp();
app.listen(port, ...)

// After:
const server = createServer();
server.listen(port, ...)
```

Update imports accordingly: `import { createServer } from './server/app.js'`

**Step 4: Delete sse.ts**

```bash
rm packages/orchestrator/src/server/sse.ts
```

**Step 5: Update competitions.test.ts to mock the new modules**

Add to the mocks in `competitions.test.ts`:

```typescript
vi.mock('../../server/websocket.js', () => ({ attachWebSocket: vi.fn() }));
vi.mock('../../server/runner-registry.js', () => ({ runnerRegistry: new Map() }));
```

**Step 6: Run tests**

```bash
npm run test
```

Expected: all tests pass.

**Step 7: Commit**

```bash
git add packages/orchestrator/src/
git commit -m "feat(server): replace SSE with WebSocket server, attach to HTTP server"
```

---

## Task 6: WebSocket Client

Replace `EventSource` with `WebSocket` in the competition view. The client connects directly to `ws://localhost:3000` (not through the Next.js proxy).

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`
- Modify: `packages/web/app/api/competitions/[id]/events/route.ts` → delete (SSE proxy no longer needed)
- Create: `packages/web/.env.local` (if not exists)

**Step 1: Add env var**

Create/update `packages/web/.env.local`:

```
NEXT_PUBLIC_WS_URL=ws://localhost:3000
```

**Step 2: Delete the SSE proxy route**

```bash
rm packages/web/app/api/competitions/[id]/events/route.ts
```

**Step 3: Update the competition page**

In `packages/web/app/competitions/[id]/page.tsx`, replace the SSE `useEffect` block (lines 114–171) with:

```typescript
// WebSocket connection
useEffect(() => {
  if (!id) return;

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000';
  let ws: WebSocket;
  let lastSeq = 0;
  let retries = 0;
  const MAX_RETRIES = 5;

  function connect() {
    ws = new WebSocket(`${wsUrl}/competitions/${id}/stream`);

    ws.onopen = () => {
      setConnected(true);
      setSseError(null);
      retries = 0;
      // Send resume cursor
      ws.send(JSON.stringify({ lastSeq }));
    };

    ws.onmessage = (e) => {
      try {
        const event: ArenaEvent & { type: string; result?: CompetitionResult; _seq?: number; state?: string } = JSON.parse(e.data);

        if (typeof event._seq === 'number') lastSeq = event._seq;

        if (event.type === 'STATE_CHANGE') {
          const s = event.state ?? '';
          if (s === 'RUNNING') setState('RUNNING');
          else if (s === 'JUDGING') setState('JUDGING');
          return;
        }

        if (event.type === 'COMPETITION_START') setState('RUNNING');
        if (event.type === 'JUDGE_SCORE') setState('JUDGING');
        if (event.type === 'COMPETITION_COMPLETE' || event.type === 'COMPLETE') {
          setState('COMPLETE');
          if (event.result) setResult(event.result);
          ws.close();
          return;
        }

        const teamId = event.teamId ?? '';
        if (teamId === 'team-a') {
          setTeamAEvents(prev => [...prev, event]);
        } else if (teamId === 'team-b') {
          setTeamBEvents(prev => [...prev, event]);
        } else {
          setTeamAEvents(prev => [...prev, event]);
          setTeamBEvents(prev => [...prev, event]);
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      setSseError('WebSocket error');
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect with backoff if competition not complete
      if (retries < MAX_RETRIES) {
        retries++;
        setTimeout(connect, Math.min(1000 * retries, 5000));
      }
    };
  }

  connect();
  return () => { ws?.close(); };
}, [id]);
```

Also remove the now-unused `connected` state display text from `"connecting…"` → keep it but update the label from `"connecting…"` to `"connecting…"` (no change needed, it already works).

**Step 4: Typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: no errors.

**Step 5: Commit**

```bash
git add packages/web/
git commit -m "feat(web): replace SSE EventSource with WebSocket client, connect directly to orchestrator"
```

---

## Task 7: API Key Auth Middleware

**Files:**
- Create: `packages/orchestrator/src/server/middleware/auth.ts`
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`

**Step 1: Write the middleware**

Create `packages/orchestrator/src/server/middleware/auth.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';

/**
 * Checks Authorization: Bearer <ARENA_API_KEY> on the request.
 * If ARENA_API_KEY is not set in the environment, auth is disabled (dev mode).
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.ARENA_API_KEY;
  if (!apiKey) {
    // Auth disabled — no key configured
    next();
    return;
  }

  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (token !== apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
```

**Step 2: Apply middleware to mutating routes**

In `packages/orchestrator/src/server/routes/competitions.ts`, import and apply:

```typescript
import { requireApiKey } from '../middleware/auth.js';

// Apply to POST and control routes only — GET routes stay public
competitionsRouter.post('/', requireApiKey, async (req, res) => { ... });
competitionsRouter.post('/:id/cancel', requireApiKey, async (req, res) => { ... });
competitionsRouter.post('/:id/pause', requireApiKey, async (req, res) => { ... });
competitionsRouter.post('/:id/resume', requireApiKey, async (req, res) => { ... });
```

**Step 3: Write a test for the middleware**

Add to `packages/orchestrator/src/server/__tests__/competitions.test.ts`:

```typescript
describe('Auth middleware', () => {
  it('returns 401 when ARENA_API_KEY is set and header is missing', async () => {
    process.env.ARENA_API_KEY = 'test-key';
    const res = await request(app).post('/competitions').send({ brief: validBrief, teams: validTeams });
    expect(res.status).toBe(401);
    delete process.env.ARENA_API_KEY;
  });

  it('returns 201 when correct key is provided', async () => {
    process.env.ARENA_API_KEY = 'test-key';
    const res = await request(app)
      .post('/competitions')
      .set('Authorization', 'Bearer test-key')
      .send({ brief: validBrief, teams: validTeams });
    expect(res.status).toBe(201);
    delete process.env.ARENA_API_KEY;
  });
});
```

**Step 4: Run tests**

```bash
npm run test
```

Expected: all tests pass including new auth tests.

**Step 5: Update web client to send the key**

In `packages/web/app/api/competitions/route.ts` (Next.js proxy), add the Authorization header when forwarding:

```typescript
const apiKey = process.env.ARENA_API_KEY;
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
```

Add `ARENA_API_KEY` to `packages/web/.env.local`:
```
ARENA_API_KEY=dev-key
```

**Step 6: Commit**

```bash
git add packages/orchestrator/src/server/middleware/ packages/orchestrator/src/server/ packages/web/
git commit -m "feat(auth): add ARENA_API_KEY bearer token middleware on mutating routes"
```

---

## Task 8: Competition Controls in the UI

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`
- Modify: `packages/web/app/api/competitions/[id]/route.ts`

**Step 1: Add proxy routes for controls**

In `packages/web/app/api/competitions/[id]/route.ts`, add POST handler:

```typescript
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action'); // cancel | pause | resume
  if (!action) return Response.json({ error: 'action required' }, { status: 400 });

  const apiKey = process.env.ARENA_API_KEY;
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const upstream = await fetch(
    `${process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000'}/competitions/${params.id}/${action}`,
    { method: 'POST', headers }
  );
  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
```

**Step 2: Add control buttons to the competition page**

In `packages/web/app/competitions/[id]/page.tsx`, add state and handlers:

```typescript
const [isPaused, setIsPaused] = useState(false);

const sendControl = async (action: 'cancel' | 'pause' | 'resume') => {
  await fetch(`/api/competitions/${id}?action=${action}`, { method: 'POST' });
  if (action === 'pause') setIsPaused(true);
  if (action === 'resume') setIsPaused(false);
  if (action === 'cancel') setState('COMPLETE');
};
```

In the header JSX, after the elapsed timer, add (visible only when `state === 'RUNNING'`):

```tsx
{state === 'RUNNING' && (
  <div className="flex items-center gap-2">
    {!isPaused ? (
      <button
        onClick={() => sendControl('pause')}
        className="text-xs px-3 py-1 bg-yellow-900 text-yellow-300 rounded hover:bg-yellow-800"
      >
        Pause
      </button>
    ) : (
      <button
        onClick={() => sendControl('resume')}
        className="text-xs px-3 py-1 bg-green-900 text-green-300 rounded hover:bg-green-800"
      >
        Resume
      </button>
    )}
    <button
      onClick={() => sendControl('cancel')}
      className="text-xs px-3 py-1 bg-red-900 text-red-300 rounded hover:bg-red-800"
    >
      Cancel
    </button>
  </div>
)}
```

**Step 3: Add cancel() and pause()/resume() to CompetitionRunner**

In `packages/orchestrator/src/engine/competition-runner.ts`, add:

```typescript
/** Cancel a running competition — shuts down all adapters immediately. */
async cancel(): Promise<void> {
  this._cancelled = true;
  for (const adapter of this._activeAdapters) {
    await adapter.shutdown();
  }
}

/** Pause — docker pause each container (no-op without Docker). */
pause(): void {
  for (const adapter of this._activeAdapters) {
    adapter.pause?.();
  }
  this.clock?.pause();
}

/** Resume — docker unpause each container. */
resume(): void {
  for (const adapter of this._activeAdapters) {
    adapter.resume?.();
  }
  this.clock?.resume();
}
```

Store active adapters on the instance: add `private _activeAdapters: BaseAdapter[] = []` and `private _cancelled = false` and `private clock?: ClockManager` as instance fields. Populate `_activeAdapters` in `run()` after creating each adapter, and `clock` when `ClockManager` is instantiated.

**Step 4: Add pause/resume to ClockManager**

In `packages/orchestrator/src/engine/clock-manager.ts`, add:

```typescript
pause(): void {
  if (this.timer) clearTimeout(this.timer);
  this._pausedAt = Date.now();
}

resume(): void {
  if (!this._pausedAt) return;
  const elapsed = Date.now() - this._startedAt - (this._pausedAt - this._startedAt);
  // Restart with remaining time
  this._pausedAt = undefined;
  // Re-arm the timer with remaining budget
}
```

**Step 5: Typecheck**

```bash
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: no errors.

**Step 6: Commit**

```bash
git add packages/orchestrator/src/ packages/web/
git commit -m "feat: add competition controls (cancel/pause/resume) to API and UI"
```

---

## Task 9: Dockerfile.agent + Real Docker Sandbox

**Files:**
- Create: `Dockerfile.agent` (repo root)
- Modify: `packages/orchestrator/src/sandbox/sandbox-manager.ts`
- Modify: `packages/orchestrator/src/adapters/base-adapter.ts`

**Step 1: Write the Dockerfile**

Create `Dockerfile.agent` at repo root:

```dockerfile
FROM node:20-slim

# Install all three agent CLIs globally
RUN npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli

WORKDIR /workspace
```

**Step 2: Build the image**

```bash
docker build -f Dockerfile.agent -t arena-agent:latest .
```

Expected: image builds successfully. This takes ~2 minutes on first run.

**Step 3: Verify CLIs are available in the image**

```bash
docker run --rm arena-agent:latest claude --version
docker run --rm arena-agent:latest codex --version
docker run --rm arena-agent:latest gemini --version
```

Expected: version strings printed for each.

**Step 4: Rewrite SandboxManager to wrap docker run**

Replace `packages/orchestrator/src/sandbox/sandbox-manager.ts`:

```typescript
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

const AGENT_IMAGE = process.env.ARENA_AGENT_IMAGE ?? 'arena-agent:latest';

/**
 * SandboxManager provides Docker-based isolation for agent processes.
 *
 * Each team gets one container worth of isolation — the agent CLI runs
 * inside `arena-agent:latest` with the team workdir bind-mounted at /workspace.
 *
 * Events still flow back via stdout piping (same as no-sandbox mode).
 */
export class SandboxManager {
  private readonly containerIds = new Map<string, string>();

  /**
   * Verify the agent image is available locally.
   * Throws a helpful error if not built yet.
   */
  async verify(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('docker', ['image', 'inspect', AGENT_IMAGE], { stdio: 'ignore' });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(
          `arena-agent image not found. Build it first:\n  docker build -f Dockerfile.agent -t ${AGENT_IMAGE} .`
        ));
      });
    });
  }

  /**
   * Spawn an agent CLI inside a Docker container.
   * Returns the ChildProcess (stdout/stderr still piped — identical to direct spawn).
   */
  spawnInContainer(
    teamId: string,
    workdir: string,
    command: string,
    args: string[],
    env: Record<string, string>,
  ): ChildProcess {
    const containerName = `arena-${teamId}-${Date.now()}`;

    const dockerArgs = [
      'run',
      '--rm',
      '--name', containerName,
      '-v', `${workdir}:/workspace`,
      '-w', '/workspace',
      '--network', 'host',
      '--memory', '2g',
      '--cpus', '1',
      ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      AGENT_IMAGE,
      command,
      ...args,
    ];

    const child = spawn('docker', dockerArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.containerIds.set(teamId, containerName);
    child.on('close', () => this.containerIds.delete(teamId));
    return child;
  }

  async killContainer(teamId: string): Promise<void> {
    const name = this.containerIds.get(teamId);
    if (!name) return;
    spawn('docker', ['kill', name], { stdio: 'ignore' });
  }

  async pauseContainer(teamId: string): Promise<void> {
    const name = this.containerIds.get(teamId);
    if (name) spawn('docker', ['pause', name], { stdio: 'ignore' });
  }

  async resumeContainer(teamId: string): Promise<void> {
    const name = this.containerIds.get(teamId);
    if (name) spawn('docker', ['unpause', name], { stdio: 'ignore' });
  }
}
```

**Step 5: Update adapters to accept sandbox**

In `packages/orchestrator/src/adapters/base-adapter.ts`, add optional `sandbox` to the constructor:

```typescript
import type { SandboxManager } from '../sandbox/sandbox-manager.js';

// Add to constructor:
protected readonly sandbox?: SandboxManager;
```

Each adapter's `startExecution()` should use `this.sandbox?.spawnInContainer(...)` when available, otherwise fall back to direct `spawn`. Example for ClaudeAdapter:

```typescript
// In claude-adapter.ts startExecution():
const child = this.sandbox
  ? this.sandbox.spawnInContainer(
      this.teamId, this.workdir,
      this.claudeBin,
      ['--print', this.promptText, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
      claudeEnv(),
    )
  : spawn(this.claudeBin,
      ['--print', this.promptText, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
      { cwd: this.workdir, stdio: ['ignore', 'pipe', 'pipe'], env: claudeEnv() }
    );
```

Apply the same pattern to CodexAdapter and GeminiAdapter.

**Step 6: Update CompetitionRunner to pass sandbox to adapters**

In `packages/orchestrator/src/engine/competition-runner.ts`, when `!this.options.skipSandbox`:
1. Create a `SandboxManager` instance
2. Call `await sandboxManager.verify()` before proceeding
3. Pass the sandbox to each adapter constructor

**Step 7: Run all tests**

```bash
npm run test --workspace=packages/orchestrator
```

Expected: all tests pass (sandbox is mocked in tests via `skipSandbox: true`).

**Step 8: Commit**

```bash
git add Dockerfile.agent packages/orchestrator/src/
git commit -m "feat(sandbox): add Dockerfile.agent and real Docker sandbox via SandboxManager"
```

---

## Task 10: Gallery Home Page + Brief Builder Fix

**Files:**
- Modify: `packages/web/app/page.tsx` → gallery
- Move existing form to: `packages/web/app/competitions/new/page.tsx`
- Modify: `packages/web/app/api/competitions/route.ts` → add GET

**Step 1: Add GET to the competitions proxy**

In `packages/web/app/api/competitions/route.ts`, add:

```typescript
export async function GET() {
  const upstream = await fetch(
    `${process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000'}/competitions`
  );
  const data = await upstream.json();
  return Response.json(data);
}
```

**Step 2: Create the Brief Builder page**

Move the entire current `packages/web/app/page.tsx` contents to `packages/web/app/competitions/new/page.tsx`, with these changes:

- Fix missing `id` field: add `id: \`comp-${Date.now()}\`` to the brief object in `handleSubmit`
- Add `expectedOutput` textarea field (optional, placed in Rubric section)
- Remove the `skipSandbox` checkbox — Docker handles isolation now
- Change the form title from "New Competition" to "Configure Competition"

```typescript
// In handleSubmit, add id to brief:
const brief = {
  id: `comp-${Date.now()}`,
  title,
  format,
  problem,
  // ... rest of fields
  ...(expectedOutput.trim() ? { expectedOutput: expectedOutput.trim() } : {}),
};

// Remove skipSandbox from options:
options: {
  claudeBin: 'claude',
  logDir: '/tmp/arena-logs',
},
```

**Step 3: Replace home page with gallery**

Replace `packages/web/app/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface CompetitionSummary {
  id: string;
  state: string;
  startedAt: string | null;
  brief: { title: string };
  teams: Array<{ model: string }>;
}

export default function GalleryPage() {
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/competitions')
      .then((r) => r.json())
      .then((data) => { setCompetitions(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Agent Arena</h1>
          <p className="text-gray-400 text-sm mt-1">AI agent head-to-head competitions</p>
        </div>
        <Link
          href="/competitions/new"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded transition-colors"
        >
          New Competition
        </Link>
      </div>

      {loading && <p className="text-gray-600 text-sm">Loading...</p>}

      {!loading && competitions.length === 0 && (
        <div className="text-center py-20 text-gray-600">
          <p className="text-lg mb-2">No competitions yet</p>
          <Link href="/competitions/new" className="text-blue-400 hover:text-blue-300 text-sm">
            Run your first competition →
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {competitions.map((comp) => (
          <Link
            key={comp.id}
            href={`/competitions/${comp.id}`}
            className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-white font-medium">{comp.brief?.title ?? comp.id}</h2>
                <p className="text-gray-500 text-xs mt-1 font-mono">
                  {comp.teams?.map((t) => t.model).join(' vs ')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {comp.startedAt && (
                  <span className="text-gray-600 text-xs">
                    {new Date(comp.startedAt).toLocaleDateString()}
                  </span>
                )}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  comp.state === 'COMPLETE' ? 'bg-blue-900 text-blue-300' :
                  comp.state === 'RUNNING' ? 'bg-green-900 text-green-300' :
                  'bg-gray-700 text-gray-300'
                }`}>
                  {comp.state}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

**Step 5: Commit**

```bash
git add packages/web/
git commit -m "feat(web): add gallery home page, move brief builder to /competitions/new, fix missing id field"
```

---

## Task 11: Environment Setup + README

**Files:**
- Create: `.env.example`
- Modify: `CLAUDE.md`

**Step 1: Create .env.example**

Create `.env.example` at repo root:

```bash
# Required for PostgreSQL
DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena

# Optional — if set, API requests require Authorization: Bearer <key>
ARENA_API_KEY=

# Web UI points at this for WebSocket connections
NEXT_PUBLIC_WS_URL=ws://localhost:3000

# Orchestrator base URL for Next.js proxy routes
ORCHESTRATOR_URL=http://localhost:3000
```

**Step 2: Add setup commands to CLAUDE.md**

In `CLAUDE.md`, update the "Running the Stack" section to add prerequisites:

```bash
# Prerequisites
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=arena -e POSTGRES_DB=arena postgres:16
docker build -f Dockerfile.agent -t arena-agent:latest .
cp .env.example packages/web/.env.local
cd packages/orchestrator && DATABASE_URL=... npm run db:migrate

# Then as before...
```

**Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: add .env.example and updated setup instructions"
```

---

## Verification Checklist

After all tasks complete, verify end-to-end:

```bash
# 1. Start Postgres
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=arena -e POSTGRES_DB=arena postgres:16

# 2. Run migrations
cd packages/orchestrator && DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena npm run db:migrate

# 3. Start orchestrator
DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena \
  npx tsx packages/orchestrator/src/cli.ts serve --port 3000

# 4. Start web UI
cd packages/web && npm run dev

# 5. Open http://localhost:3001 — should see gallery (empty)
# 6. Click "New Competition" → fill form → Launch
# 7. Competition page opens → events stream in via WebSocket
# 8. After completion → scoreboard shows
# 9. Back on gallery → competition appears in list
# 10. Restart orchestrator → gallery still shows past competitions (Postgres persists)
```

**Gate 1 checklist:**
- [ ] 3-model competition runs end-to-end with Docker sandbox
- [ ] Gallery shows past competitions after restart
- [ ] WebSocket reconnects cleanly after disconnect
- [ ] Cancel button terminates a running competition
- [ ] Brief Builder produces valid briefs in < 10 minutes
- [ ] All 84+ tests pass
