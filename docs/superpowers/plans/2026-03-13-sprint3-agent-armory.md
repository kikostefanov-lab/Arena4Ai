> **Historical design document, March 2026.** Model ids, APIs and file paths referenced below are as of that date and are **not current**. It is kept as a record of what was decided then, not as guidance. See `README.md` for current models and `CLAUDE.md` for current usage.


# Sprint 3 — Agent Armory Implementation Plan

> **Status: COMPLETE**

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the localStorage-only `/personas` page with a DB-backed Agent Armory, migrate existing localStorage personas on first visit, seed 9 built-in system agents, show win/loss stats on agent cards, support fork/retire/tags/model variant, and wire the Armory picker into competition creation Step 3.

**Architecture:** A new `agent_profiles` Postgres table stores all profiles (system and custom). `AgentProfileRepository` handles CRUD + stats updates. An Express router at `/agent-profiles` exposes 6 endpoints. Next.js proxy routes forward to the orchestrator. The `/agent-armory` page renders a TRON-styled card gallery. Competition creation Step 3 fetches profiles from the API. After `SCORED`, the competition runner fire-and-forget updates stats for matching profiles.

**Tech Stack:** TypeScript, Drizzle ORM (PostgreSQL), Vitest, Express, React + Next.js 15 App Router, `html { font-size: 120% }` baseline (1rem = 19.2px)

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/shared/src/types/agent-profile.ts` | Create | `AgentProfile` TypeScript interface |
| `packages/shared/src/types/index.ts` | Modify | Re-export `AgentProfile` |
| `packages/orchestrator/src/db/schema.ts` | Modify | Add `agentProfiles` Drizzle table |
| `packages/orchestrator/src/db/migrations/0008_agent_profiles.sql` | Create | Plain SQL migration |
| `packages/orchestrator/src/db/agent-profile-repository.ts` | Create | CRUD + stats update methods |
| `packages/orchestrator/src/db/agent-profile-repository.test.ts` | Create | Repository unit tests |
| `packages/orchestrator/src/db/seed-agent-profiles.ts` | Create | 9 built-in system persona seeds |
| `packages/orchestrator/src/server/routes/agent-profiles.ts` | Create | Express router — 6 endpoints |
| `packages/orchestrator/src/app.ts` | Modify | Register agent-profiles router + seed on startup |
| `packages/orchestrator/src/engine/competition-runner.ts` | Modify | Stats update hook after SCORED |
| `packages/orchestrator/src/engine/competition-runner.test.ts` | Modify | Tests for stats update |
| `packages/web/app/api/agent-profiles/route.ts` | Create | Next.js proxy: GET list + POST create |
| `packages/web/app/api/agent-profiles/[id]/route.ts` | Create | Next.js proxy: GET one + PATCH + DELETE |
| `packages/web/app/api/agent-profiles/[id]/fork/route.ts` | Create | Next.js proxy: POST fork |
| `packages/web/components/AgentCard.tsx` | Create | Reusable agent profile card |
| `packages/web/components/EmojiPicker.tsx` | Create | Emoji grid picker (colored by model) |
| `packages/web/app/agent-armory/page.tsx` | Create | Gallery + filter bar + create/edit + migration banner |
| `packages/web/app/personas/page.tsx` | Modify | 301 redirect to `/agent-armory` |
| `packages/web/components/TopBar.tsx` | Modify | "Personas" → "Armory", href → `/agent-armory` |
| `packages/web/app/competitions/new/page.tsx` | Modify | Step 3 Armory picker replaces localStorage picker |

---

## Chunk 1: Data Layer

---

### Task 1: AgentProfile shared type, Drizzle schema, and migration

**Files:**
- Create: `packages/shared/src/types/agent-profile.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/orchestrator/src/db/schema.ts`
- Create: `packages/orchestrator/src/db/migrations/0008_agent_profiles.sql`

**Context:** The `AgentProfile` interface is the shared contract between orchestrator and web. The Drizzle schema mirrors the DB columns. The migration is plain SQL — no Drizzle generate needed.

- [ ] **Step 1: Read current schema.ts and types/index.ts**

  ```bash
  cat packages/orchestrator/src/db/schema.ts
  cat packages/shared/src/types/index.ts
  ```

- [ ] **Step 2: Create `packages/shared/src/types/agent-profile.ts`**

  ```ts
  export interface AgentProfile {
    id: string;
    name: string;
    description?: string;
    provider: 'claude' | 'codex' | 'gemini';
    modelVariant: string;
    systemPrompt: string;
    avatar?: string;
    tags?: string[];
    retired: boolean;
    createdBy: string;
    forkedFromId?: string;
    statsWins: number;
    statsLosses: number;
    statsTotal: number;
    statsAvgScore?: number;
    statsLastUsedAt?: string;
    createdAt: string;
    updatedAt: string;
  }
  ```

- [ ] **Step 3: Add re-export to `packages/shared/src/types/index.ts`**

  Add at end of file:
  ```ts
  export type { AgentProfile } from './agent-profile.js';
  ```

- [ ] **Step 4: Add Drizzle table to `packages/orchestrator/src/db/schema.ts`**

  At end of file, add:
  ```ts
  export const agentProfiles = pgTable('agent_profiles', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    provider: text('provider').notNull(),
    modelVariant: text('model_variant').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    avatar: text('avatar'),
    tags: jsonb('tags').$type<string[]>(),
    retired: boolean('retired').default(false).notNull(),
    createdBy: text('created_by').notNull(),
    forkedFromId: text('forked_from_id').references((): AnyPgColumn => agentProfiles.id, { onDelete: 'set null' }),
    statsWins: integer('stats_wins').default(0).notNull(),
    statsLosses: integer('stats_losses').default(0).notNull(),
    statsTotal: integer('stats_total').default(0).notNull(),
    statsAvgScore: numeric('stats_avg_score'),
    statsLastUsedAt: timestamp('stats_last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  });
  ```

  Also add `AnyPgColumn` to the drizzle-orm import at top if not present:
  ```ts
  import { pgTable, text, timestamp, jsonb, boolean, integer, numeric, AnyPgColumn } from 'drizzle-orm/pg-core';
  ```

- [ ] **Step 5: Create the migration file**

  Create `packages/orchestrator/src/db/migrations/0008_agent_profiles.sql`:
  ```sql
  CREATE TABLE "agent_profiles" (
    "id"                 TEXT PRIMARY KEY,
    "name"               TEXT NOT NULL,
    "description"        TEXT,
    "provider"           TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini')),
    "model_variant"      TEXT NOT NULL,
    "system_prompt"      TEXT NOT NULL,
    "avatar"             TEXT,
    "tags"               JSONB,
    "retired"            BOOLEAN NOT NULL DEFAULT FALSE,
    "created_by"         TEXT NOT NULL,
    "forked_from_id"     TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    "stats_wins"         INTEGER NOT NULL DEFAULT 0,
    "stats_losses"       INTEGER NOT NULL DEFAULT 0,
    "stats_total"        INTEGER NOT NULL DEFAULT 0,
    "stats_avg_score"    NUMERIC,
    "stats_last_used_at" TIMESTAMPTZ,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX idx_agent_profiles_provider ON agent_profiles(provider);
  CREATE INDEX idx_agent_profiles_retired  ON agent_profiles(retired);
  -- Enforce unique (provider, name) among active profiles for stats lookup
  CREATE UNIQUE INDEX idx_agent_profiles_provider_name_active ON agent_profiles(provider, name) WHERE retired = FALSE;
  ```

- [ ] **Step 6: Run migration**

  ```bash
  DATABASE_URL=postgresql://localhost/arena npm run db:migrate --workspace=packages/orchestrator
  ```

  Expected: Migration `0008_agent_profiles` applied successfully.

- [ ] **Step 7: Build shared package**

  ```bash
  npm run build --workspace=packages/shared 2>&1
  ```

  Expected: No errors.

- [ ] **Step 8: Run orchestrator typecheck**

  ```bash
  npm run typecheck --workspace=packages/orchestrator 2>&1
  ```

  Expected: No output (clean).

- [ ] **Step 9: Commit**

  ```bash
  git add packages/shared/src/types/agent-profile.ts \
          packages/shared/src/types/index.ts \
          packages/shared/dist/ \
          packages/orchestrator/src/db/schema.ts \
          packages/orchestrator/src/db/migrations/0008_agent_profiles.sql
  git commit -m "feat(schema): add agent_profiles table and AgentProfile shared type"
  ```

---

### Task 2: AgentProfileRepository

**Files:**
- Create: `packages/orchestrator/src/db/agent-profile-repository.ts`
- Create: `packages/orchestrator/src/db/agent-profile-repository.test.ts`

**Context:** Follows the same pattern as `CompetitionRepository`. Uses Drizzle for queries. The `updateStats` method recalculates `statsAvgScore` as a running weighted average: `newAvg = ((oldAvg * oldTotal) + newScore) / newTotal`. Repository tests use a real test DB — follow the pattern in existing repository.test.ts.

- [ ] **Step 1: Read existing repository.test.ts to understand test DB setup**

  ```bash
  head -60 packages/orchestrator/src/db/repository.test.ts
  ```

- [ ] **Step 2: Write the failing tests**

  Create `packages/orchestrator/src/db/agent-profile-repository.test.ts`:

  ```ts
  import { describe, it, expect, beforeEach, afterEach } from 'vitest';
  import { drizzle } from 'drizzle-orm/node-postgres';
  import pg from 'pg';
  import { AgentProfileRepository } from './agent-profile-repository.js';

  const { Pool } = pg;

  // Skip if no DB available
  const DATABASE_URL = process.env.DATABASE_URL;
  const describeWithDb = DATABASE_URL ? describe : describe.skip;

  describeWithDb('AgentProfileRepository', () => {
    let pool: InstanceType<typeof Pool>;
    let repo: AgentProfileRepository;

    beforeEach(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      const db = drizzle(pool);
      repo = new AgentProfileRepository(db);
    });

    afterEach(async () => {
      // Clean up test records
      await pool.query("DELETE FROM agent_profiles WHERE created_by = 'test'");
      await pool.end();
    });

    it('creates and retrieves a profile', async () => {
      await repo.create({
        id: 'test-profile-1',
        name: 'Test Agent',
        provider: 'claude',
        modelVariant: 'claude-sonnet-4-6',
        systemPrompt: 'You are a test agent.',
        createdBy: 'test',
      });
      const profile = await repo.get('test-profile-1');
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe('Test Agent');
      expect(profile!.retired).toBe(false);
      expect(profile!.statsWins).toBe(0);
    });

    it('lists profiles with provider filter', async () => {
      await repo.create({ id: 'test-claude-1', name: 'Claude Agent', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', createdBy: 'test' });
      await repo.create({ id: 'test-codex-1', name: 'Codex Agent', provider: 'codex', modelVariant: 'codex-standard', systemPrompt: 'test', createdBy: 'test' });
      const claudeProfiles = await repo.list({ provider: 'claude', retired: false });
      const ids = claudeProfiles.map(p => p.id);
      expect(ids).toContain('test-claude-1');
      expect(ids).not.toContain('test-codex-1');
    });

    it('updates profile fields', async () => {
      await repo.create({ id: 'test-profile-2', name: 'Before', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'before', createdBy: 'test' });
      const updated = await repo.update('test-profile-2', { name: 'After', avatar: '🧪' });
      expect(updated!.name).toBe('After');
      expect(updated!.avatar).toBe('🧪');
    });

    it('retires a profile (soft delete)', async () => {
      await repo.create({ id: 'test-profile-3', name: 'To Retire', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', createdBy: 'test' });
      const ok = await repo.retire('test-profile-3');
      expect(ok).toBe(true);
      const profile = await repo.get('test-profile-3');
      expect(profile!.retired).toBe(true);
    });

    it('forks a profile', async () => {
      await repo.create({ id: 'test-profile-4', name: 'Original', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'original prompt', createdBy: 'test' });
      const fork = await repo.fork('test-profile-4', 'My Fork', 'test');
      expect(fork.name).toBe('My Fork');
      expect(fork.forkedFromId).toBe('test-profile-4');
      expect(fork.systemPrompt).toBe('original prompt');
      expect(fork.createdBy).toBe('test');
      // Clean up fork
      await pool.query("DELETE FROM agent_profiles WHERE id = $1", [fork.id]);
    });

    it('updates stats correctly (win)', async () => {
      await repo.create({ id: 'test-profile-5', name: 'Stats Agent', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', createdBy: 'test' });
      await repo.updateStats('test-profile-5', true, 0.85);
      const profile = await repo.get('test-profile-5');
      expect(profile!.statsWins).toBe(1);
      expect(profile!.statsLosses).toBe(0);
      expect(profile!.statsTotal).toBe(1);
      expect(Number(profile!.statsAvgScore)).toBeCloseTo(0.85, 2);
    });

    it('updates stats correctly (loss)', async () => {
      await repo.create({ id: 'test-profile-6', name: 'Stats Agent 2', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', createdBy: 'test' });
      await repo.updateStats('test-profile-6', true, 0.9);
      await repo.updateStats('test-profile-6', false, 0.4);
      const profile = await repo.get('test-profile-6');
      expect(profile!.statsWins).toBe(1);
      expect(profile!.statsLosses).toBe(1);
      expect(profile!.statsTotal).toBe(2);
      expect(Number(profile!.statsAvgScore)).toBeCloseTo(0.65, 2);
    });

    it('getByProviderAndName returns profile', async () => {
      await repo.create({ id: 'test-profile-7', name: 'architect', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', createdBy: 'test' });
      const found = await repo.getByProviderAndName('claude', 'architect');
      expect(found).not.toBeNull();
      expect(found!.id).toBe('test-profile-7');
    });

    it('returns null for non-existent profile', async () => {
      const profile = await repo.get('does-not-exist');
      expect(profile).toBeNull();
    });

    it('lists profiles by tags filter', async () => {
      await repo.create({ id: 'test-tagged-1', name: 'Tagged Agent', provider: 'claude', modelVariant: 'claude-sonnet-4-6', systemPrompt: 'test', tags: ['security', 'testing'], createdBy: 'test' });
      const tagged = await repo.list({ tags: ['security'] });
      const ids = tagged.map(p => p.id);
      expect(ids).toContain('test-tagged-1');
    });
  });
  ```

- [ ] **Step 3: Run to confirm tests fail**

  ```bash
  cd "/Users/kstefano/Personal Projects/agentarena" && DATABASE_URL=postgresql://localhost/arena npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E "AgentProfileRepository|FAIL|PASS" | head -20
  ```

  Expected: FAIL — `AgentProfileRepository` not found.

- [ ] **Step 4: Create `packages/orchestrator/src/db/agent-profile-repository.ts`**

  ```ts
  import { eq, and, inArray } from 'drizzle-orm';
  import { agentProfiles } from './schema.js';
  import type { AgentProfile } from '@arena/shared';
  import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
  import { randomUUID } from 'crypto';

  type Db = NodePgDatabase;

  type CreateInput = {
    id?: string;
    name: string;
    description?: string;
    provider: string;
    modelVariant: string;
    systemPrompt: string;
    avatar?: string;
    tags?: string[];
    createdBy: string;
    forkedFromId?: string;
  };

  type UpdateInput = Partial<Pick<AgentProfile, 'name' | 'description' | 'systemPrompt' | 'avatar' | 'tags' | 'modelVariant'>>;

  type ListFilters = {
    provider?: string;
    retired?: boolean;
    tags?: string[];
  };

  function rowToProfile(row: typeof agentProfiles.$inferSelect): AgentProfile {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      provider: row.provider as AgentProfile['provider'],
      modelVariant: row.modelVariant,
      systemPrompt: row.systemPrompt,
      avatar: row.avatar ?? undefined,
      tags: (row.tags as string[] | null) ?? undefined,
      retired: row.retired,
      createdBy: row.createdBy,
      forkedFromId: row.forkedFromId ?? undefined,
      statsWins: row.statsWins,
      statsLosses: row.statsLosses,
      statsTotal: row.statsTotal,
      statsAvgScore: row.statsAvgScore ? Number(row.statsAvgScore) : undefined,
      statsLastUsedAt: row.statsLastUsedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  export class AgentProfileRepository {
    constructor(private readonly db: Db) {}

    async create(input: CreateInput): Promise<void> {
      await this.db.insert(agentProfiles).values({
        id: input.id ?? `agent-${randomUUID()}`,
        name: input.name,
        description: input.description,
        provider: input.provider,
        modelVariant: input.modelVariant,
        systemPrompt: input.systemPrompt,
        avatar: input.avatar,
        tags: input.tags ?? null,
        retired: false,
        createdBy: input.createdBy,
        forkedFromId: input.forkedFromId,
        statsWins: 0,
        statsLosses: 0,
        statsTotal: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    async get(id: string): Promise<AgentProfile | null> {
      const rows = await this.db.select().from(agentProfiles).where(eq(agentProfiles.id, id));
      return rows[0] ? rowToProfile(rows[0]) : null;
    }

    async getByProviderAndName(provider: string, name: string): Promise<AgentProfile | null> {
      const rows = await this.db.select().from(agentProfiles)
        .where(and(eq(agentProfiles.provider, provider), eq(agentProfiles.name, name), eq(agentProfiles.retired, false)));
      return rows[0] ? rowToProfile(rows[0]) : null;
    }

    async list(filters: ListFilters = {}): Promise<AgentProfile[]> {
      let query = this.db.select().from(agentProfiles);
      const conditions = [];
      if (filters.provider) conditions.push(eq(agentProfiles.provider, filters.provider));
      if (filters.retired !== undefined) conditions.push(eq(agentProfiles.retired, filters.retired));
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }
      const rows = await query.orderBy(agentProfiles.createdAt);
      let profiles = rows.map(rowToProfile);
      // Tags filter applied in JS (JSONB containment; data set is small)
      if (filters.tags && filters.tags.length > 0) {
        profiles = profiles.filter(p => filters.tags!.every(t => p.tags?.includes(t)));
      }
      return profiles;
    }

    async update(id: string, patch: UpdateInput): Promise<AgentProfile | null> {
      const rows = await this.db.update(agentProfiles)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(agentProfiles.id, id))
        .returning();
      return rows[0] ? rowToProfile(rows[0]) : null;
    }

    async retire(id: string): Promise<boolean> {
      const rows = await this.db.update(agentProfiles)
        .set({ retired: true, updatedAt: new Date() })
        .where(eq(agentProfiles.id, id))
        .returning();
      return rows.length > 0;
    }

    async fork(sourceId: string, name: string, createdBy: string): Promise<AgentProfile> {
      const source = await this.get(sourceId);
      if (!source) throw new Error(`Agent profile ${sourceId} not found`);
      const newId = `agent-${randomUUID()}`;
      await this.create({
        id: newId,
        name,
        description: source.description,
        provider: source.provider,
        modelVariant: source.modelVariant,
        systemPrompt: source.systemPrompt,
        avatar: source.avatar,
        tags: source.tags,
        createdBy,
        forkedFromId: sourceId,
      });
      return (await this.get(newId))!;
    }

    async updateStats(id: string, won: boolean, score: number): Promise<void> {
      const profile = await this.get(id);
      if (!profile) return;
      const newTotal = profile.statsTotal + 1;
      const newWins = profile.statsWins + (won ? 1 : 0);
      const newLosses = profile.statsLosses + (won ? 0 : 1);
      const oldAvg = profile.statsAvgScore ?? 0;
      const newAvg = ((oldAvg * profile.statsTotal) + score) / newTotal;
      await this.db.update(agentProfiles).set({
        statsWins: newWins,
        statsLosses: newLosses,
        statsTotal: newTotal,
        statsAvgScore: String(newAvg),
        statsLastUsedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(agentProfiles.id, id));
    }
  }
  ```

- [ ] **Step 5: Run the new tests**

  ```bash
  cd "/Users/kstefano/Personal Projects/agentarena" && DATABASE_URL=postgresql://localhost/arena npm run test --workspace=packages/orchestrator 2>&1 | tail -5
  ```

  Expected: All tests pass. Count goes from 159 to 168 (9 new tests including the tags filter test).

- [ ] **Step 6: Run typecheck**

  ```bash
  npm run typecheck --workspace=packages/orchestrator 2>&1
  ```

  Expected: No output (clean).

- [ ] **Step 7: Commit**

  ```bash
  git add packages/orchestrator/src/db/agent-profile-repository.ts \
          packages/orchestrator/src/db/agent-profile-repository.test.ts
  git commit -m "feat(db): add AgentProfileRepository with CRUD and stats update"
  ```

---

### Task 3: Stats update hook in competition-runner.ts

**Files:**
- Modify: `packages/orchestrator/src/engine/competition-runner.ts`
- Modify: `packages/orchestrator/src/engine/competition-runner.test.ts`

**Context:** After `this.advance(CompetitionState.SCORED)`, fire-and-forget `updateAgentStats()`. The `CompetitionRunner` already takes a `db` parameter or can be given one. Check the constructor. If `db` is not currently injected, add it as an optional parameter. The stats update is non-blocking — wrap in `void ... .catch(() => {})`.

- [ ] **Step 1: Read competition-runner.ts constructor and SCORED transition**

  ```bash
  grep -n "constructor\|SCORED\|CompetitionState\|advance\|this.db\|Db\b" \
    packages/orchestrator/src/engine/competition-runner.ts | head -30
  ```

- [ ] **Step 2: Write the failing test**

  In `packages/orchestrator/src/engine/competition-runner.test.ts`, find the SCORED-state tests and add:

  ```ts
  it('calls updateStats on agent profiles after SCORED transition', async () => {
    // Arrange: mock repo with spy
    const mockUpdateStats = vi.fn().mockResolvedValue(undefined);
    const mockGetByProviderAndName = vi.fn().mockResolvedValue({
      id: 'agent-claude-architect',
      name: 'architect',
      provider: 'claude',
    });
    const mockRepo = {
      getByProviderAndName: mockGetByProviderAndName,
      updateStats: mockUpdateStats,
    } as unknown as AgentProfileRepository;

    // makeTestRunner must accept agentProfileRepo option (not yet wired — this test will FAIL until Step 4)
    const runner = makeTestRunner({ agentProfileRepo: mockRepo });
    await runner.run();

    // After SCORED, updateStats should have been called for each team
    expect(mockUpdateStats).toHaveBeenCalled();
  });
  ```

  **Note:** Read the existing test file to understand `makeTestRunner` pattern. Import `AgentProfileRepository` at the top of the test file. This test will fail until `agentProfileRepo` is wired in Step 4.

- [ ] **Step 3: Run to confirm the test FAILS**

  ```bash
  cd "/Users/kstefano/Personal Projects/agentarena" && DATABASE_URL=postgresql://localhost/arena npm run test --workspace=packages/orchestrator 2>&1 | tail -5
  ```

  Expected: 1 test FAILS (makeTestRunner does not accept agentProfileRepo yet / updateStats not called).

- [ ] **Step 4: Add stats update to competition-runner.ts**

  a) Add optional `agentProfileRepo` to the constructor options (check existing options type):
  ```ts
  // In RunOptions or constructor params, add:
  agentProfileRepo?: AgentProfileRepository;
  ```

  b) After `this.advance(CompetitionState.SCORED)`, add the fire-and-forget hook:
  ```ts
  // Fire-and-forget stats update — does not block competition flow
  if (this.agentProfileRepo) {
    void this.updateAgentStats(scorecards).catch((err) => {
      console.warn('[stats] Failed to update agent stats:', err);
    });
  }
  ```

  c) Add the private method:
  ```ts
  private async updateAgentStats(scorecards: ScoreCard[]): Promise<void> {
    if (!this.agentProfileRepo || scorecards.length === 0) return;
    // Find winner: reduce tracking both teamId and score to avoid repeated array scans
    const winner = scorecards.reduce<{ teamId: string; score: number }>(
      (best, sc) => sc.finalScore > best.score ? { teamId: sc.teamId, score: sc.finalScore } : best,
      { teamId: scorecards[0].teamId, score: scorecards[0].finalScore }
    );
    const winnerId = winner.teamId;
    for (const sc of scorecards) {
      const team = this.competition.teams.find(t => t.id === sc.teamId);
      if (!team) continue;
      const colonIdx = team.model.indexOf(':');
      if (colonIdx === -1) continue;
      const provider = team.model.slice(0, colonIdx);
      const name = team.model.slice(colonIdx + 1);
      const profile = await this.agentProfileRepo.getByProviderAndName(provider, name);
      if (!profile) continue;
      await this.agentProfileRepo.updateStats(profile.id, sc.teamId === winnerId, sc.finalScore);
    }
  }
  ```

- [ ] **Step 5: Run tests**

  ```bash
  cd "/Users/kstefano/Personal Projects/agentarena" && DATABASE_URL=postgresql://localhost/arena npm run test --workspace=packages/orchestrator 2>&1 | tail -5
  ```

  Expected: All tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/orchestrator/src/engine/competition-runner.ts \
          packages/orchestrator/src/engine/competition-runner.test.ts
  git commit -m "feat(runner): fire-and-forget agent stats update after SCORED transition"
  ```

---

## Chunk 2: API + Proxy

---

### Task 4: Orchestrator API router + seed data

**Files:**
- Create: `packages/orchestrator/src/server/routes/agent-profiles.ts`
- Create: `packages/orchestrator/src/db/seed-agent-profiles.ts`
- Modify: `packages/orchestrator/src/server/app.ts`

**Context:** 6 REST endpoints. The router receives a `db` instance via closure (same pattern as other routers — check `routes/competitions.ts`). Seed data runs once on app startup: check for existing system agents, skip if already seeded.

- [ ] **Step 1: Read routes/competitions.ts to understand router pattern**

  ```bash
  head -50 packages/orchestrator/src/server/routes/competitions.ts
  ```

- [ ] **Step 2: Create `packages/orchestrator/src/db/seed-agent-profiles.ts`**

  ```ts
  import type { AgentProfileRepository } from './agent-profile-repository.js';

  const SYSTEM_AGENTS = [
    { id: 'agent-claude-architect',   name: 'architect',   provider: 'claude',  modelVariant: 'claude-sonnet-4-6', avatar: '🏗️', tags: ['thorough', 'design'],     systemPrompt: 'You are The Architect: methodical, structured, focused on long-term quality and clean design patterns. You write complete, production-ready solutions.' },
    { id: 'agent-claude-speedrunner', name: 'speedrunner', provider: 'claude',  modelVariant: 'claude-sonnet-4-6', avatar: '⚡',  tags: ['fast', 'minimal'],        systemPrompt: 'You are The Speedrunner: ruthlessly efficient, shipping the minimal working solution first. You optimize for time-to-completion above all.' },
    { id: 'agent-claude-pragmatist',  name: 'pragmatist',  provider: 'claude',  modelVariant: 'claude-sonnet-4-6', avatar: '🔧', tags: ['practical', 'balanced'],   systemPrompt: 'You are The Pragmatist: balancing speed and quality, choosing proven patterns, avoiding over-engineering. You deliver working solutions fast.' },
    { id: 'agent-claude-researcher',  name: 'researcher',  provider: 'claude',  modelVariant: 'claude-sonnet-4-6', avatar: '🔬', tags: ['thorough', 'analysis'],    systemPrompt: 'You are The Researcher: deep analysis, comprehensive documentation, exploring edge cases and trade-offs before committing to an approach.' },
    { id: 'agent-claude-adversarial', name: 'adversarial', provider: 'claude',  modelVariant: 'claude-sonnet-4-6', avatar: '⚔️', tags: ['security', 'testing'],    systemPrompt: 'You are The Adversarial: focused on breaking assumptions, finding vulnerabilities, writing adversarial tests, and hardening implementations.' },
    { id: 'agent-claude-defender',    name: 'defender',    provider: 'claude',  modelVariant: 'claude-sonnet-4-6', avatar: '🛡️', tags: ['security', 'quality'],    systemPrompt: 'You are The Defender: prioritizing robustness, error handling, security, and defensive programming patterns in every solution.' },
    { id: 'agent-claude-pioneer',     name: 'pioneer',     provider: 'claude',  modelVariant: 'claude-sonnet-4-6', avatar: '🚀', tags: ['creative', 'innovative'],  systemPrompt: 'You are The Pioneer: exploring unconventional approaches, experimenting with creative solutions, pushing boundaries while staying practical.' },
    { id: 'agent-codex-standard',     name: 'standard',   provider: 'codex',   modelVariant: 'codex-standard',    avatar: '💻', tags: ['coding'],                  systemPrompt: 'You are a Codex coding agent. Write clean, efficient code to solve the given problem.' },
    { id: 'agent-gemini-standard',    name: 'standard',   provider: 'gemini',  modelVariant: 'gemini-2-flash',    avatar: '✨', tags: ['versatile'],               systemPrompt: 'You are a Gemini agent. Approach the problem creatively and deliver a comprehensive solution.' },
  ];

  export async function seedAgentProfiles(repo: AgentProfileRepository): Promise<void> {
    for (const agent of SYSTEM_AGENTS) {
      const existing = await repo.get(agent.id);
      if (existing) continue;
      await repo.create({ ...agent, createdBy: 'system' });
    }
  }
  ```

- [ ] **Step 3: Create `packages/orchestrator/src/server/routes/agent-profiles.ts`**

  ```ts
  import { Router } from 'express';
  import { randomUUID } from 'crypto';
  import type { AgentProfileRepository } from '../../db/agent-profile-repository.js';

  export function createAgentProfilesRouter(repo: AgentProfileRepository): Router {
    const router = Router();

    // GET /agent-profiles?provider=claude&retired=false
    router.get('/', async (req, res) => {
      try {
        const { provider, retired } = req.query as Record<string, string>;
        const filters: Record<string, unknown> = {};
        if (provider) filters.provider = provider;
        if (retired !== undefined) filters.retired = retired === 'true';
        const profiles = await repo.list(filters);
        res.json(profiles);
      } catch (err) {
        res.status(500).json({ error: 'Failed to list agent profiles' });
      }
    });

    // POST /agent-profiles
    router.post('/', async (req, res) => {
      try {
        const { name, provider, modelVariant, systemPrompt, description, avatar, tags } = req.body;
        if (!name || !provider || !modelVariant || !systemPrompt) {
          return res.status(400).json({ error: 'name, provider, modelVariant, systemPrompt are required' });
        }
        // Generate ID here so we can retrieve it deterministically after create
        const id = `agent-${randomUUID()}`;
        await repo.create({ id, name, provider, modelVariant, systemPrompt, description, avatar, tags, createdBy: 'user' });
        const created = await repo.get(id);
        res.status(201).json(created);
      } catch (err) {
        res.status(500).json({ error: 'Failed to create agent profile' });
      }
    });

    // GET /agent-profiles/:id
    router.get('/:id', async (req, res) => {
      try {
        const profile = await repo.get(req.params.id);
        if (!profile) return res.status(404).json({ error: 'Not found' });
        res.json(profile);
      } catch (err) {
        res.status(500).json({ error: 'Failed to get agent profile' });
      }
    });

    // PATCH /agent-profiles/:id
    router.patch('/:id', async (req, res) => {
      try {
        const profile = await repo.get(req.params.id);
        if (!profile) return res.status(404).json({ error: 'Not found' });
        if (profile.createdBy === 'system') return res.status(403).json({ error: 'System profiles cannot be edited' });
        const updated = await repo.update(req.params.id, req.body);
        res.json(updated);
      } catch (err) {
        res.status(500).json({ error: 'Failed to update agent profile' });
      }
    });

    // DELETE /agent-profiles/:id  (soft delete)
    router.delete('/:id', async (req, res) => {
      try {
        const profile = await repo.get(req.params.id);
        if (!profile) return res.status(404).json({ error: 'Not found' });
        if (profile.createdBy === 'system') return res.status(403).json({ error: 'System profiles cannot be deleted' });
        const ok = await repo.retire(req.params.id);
        res.json({ ok });
      } catch (err) {
        res.status(500).json({ error: 'Failed to retire agent profile' });
      }
    });

    // POST /agent-profiles/:id/fork
    router.post('/:id/fork', async (req, res) => {
      try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });
        const fork = await repo.fork(req.params.id, name, 'user');
        res.status(201).json(fork);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to fork';
        res.status(err instanceof Error && err.message.includes('not found') ? 404 : 500).json({ error: msg });
      }
    });

    return router;
  }
  ```

- [ ] **Step 4: Register router and run seed in app.ts**

  Read app.ts to find the correct insertion point:
  ```bash
  grep -n "import\|createApp\|app.use\|router\|Repository\|rateLimit" packages/orchestrator/src/server/app.ts | head -40
  ```

  Then add to the import block at top, and inside `createApp()` before `return app`:
  ```ts
  // Add to imports:
  import { AgentProfileRepository } from '../db/agent-profile-repository.js';
  import { createAgentProfilesRouter } from './routes/agent-profiles.js';
  import { seedAgentProfiles } from '../db/seed-agent-profiles.js';

  // Add inside createApp(), after the existing limiter definitions:
  const agentProfileRepo = new AgentProfileRepository(db);

  // Seed system agents (async, non-blocking)
  void seedAgentProfiles(agentProfileRepo).catch(err =>
    console.warn('[seed] Failed to seed agent profiles:', err)
  );

  app.use('/agent-profiles', createAgentProfilesRouter(agentProfileRepo));
  // Rate-limit fork endpoint (creates DB rows) at same level as forge/synthesis (5/min)
  app.post('/agent-profiles/:id/fork', forgeSynthesisLimiter);
  ```

- [ ] **Step 5: Run typecheck**

  ```bash
  npm run typecheck --workspace=packages/orchestrator 2>&1
  ```

  Expected: Clean.

- [ ] **Step 6: Run all tests**

  ```bash
  DATABASE_URL=postgresql://localhost/arena npm run test --workspace=packages/orchestrator 2>&1 | tail -5
  ```

  Expected: All tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/orchestrator/src/server/routes/agent-profiles.ts \
          packages/orchestrator/src/db/seed-agent-profiles.ts \
          packages/orchestrator/src/server/app.ts
  git commit -m "feat(api): add /agent-profiles REST endpoints and seed 9 system personas"
  ```

---

### Task 5: Next.js proxy routes

**Files:**
- Create: `packages/web/app/api/agent-profiles/route.ts`
- Create: `packages/web/app/api/agent-profiles/[id]/route.ts`
- Create: `packages/web/app/api/agent-profiles/[id]/fork/route.ts`

**Context:** Follow the exact pattern of existing proxy routes (e.g., `app/api/competitions/[id]/synthesis/route.ts`). They forward to `http://localhost:3000` (the orchestrator). Use the Next.js 15 `params: Promise<{id: string}>` pattern.

- [ ] **Step 1: Read an existing proxy route to understand the pattern**

  ```bash
  cat packages/web/app/api/competitions/[id]/synthesis/route.ts
  ```

- [ ] **Step 2: Create `packages/web/app/api/agent-profiles/route.ts`**

  ```ts
  const ORCHESTRATOR = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

  export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const qs = searchParams.toString();
    const res = await fetch(`${ORCHESTRATOR}/agent-profiles${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  }

  export async function POST(req: Request) {
    const body = await req.json();
    const res = await fetch(`${ORCHESTRATOR}/agent-profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  }
  ```

- [ ] **Step 3: Create `packages/web/app/api/agent-profiles/[id]/route.ts`**

  ```ts
  const ORCHESTRATOR = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

  export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const res = await fetch(`${ORCHESTRATOR}/agent-profiles/${id}`, { cache: 'no-store' });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  }

  export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json();
    const res = await fetch(`${ORCHESTRATOR}/agent-profiles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  }

  export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const res = await fetch(`${ORCHESTRATOR}/agent-profiles/${id}`, { method: 'DELETE' });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  }
  ```

- [ ] **Step 4: Create `packages/web/app/api/agent-profiles/[id]/fork/route.ts`**

  ```ts
  const ORCHESTRATOR = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

  export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json();
    const res = await fetch(`${ORCHESTRATOR}/agent-profiles/${id}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  }
  ```

- [ ] **Step 5: Typecheck web package**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json 2>&1
  ```

  Expected: No errors.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/web/app/api/agent-profiles/
  git commit -m "feat(web): add Next.js proxy routes for agent-profiles API"
  ```

---

## Chunk 3: UI + Integration

---

### Task 6: AgentCard and EmojiPicker components

**Files:**
- Create: `packages/web/components/AgentCard.tsx`
- Create: `packages/web/components/EmojiPicker.tsx`

**Context:** Design tokens from `packages/web/lib/design-tokens.ts`. Use `getModelColor()` for avatar circle color. `AgentCard` renders a single profile card. `EmojiPicker` is a grid of emoji buttons, colored by the currently selected model/provider.

- [ ] **Step 1: Create `packages/web/components/AgentCard.tsx`**

  ```tsx
  'use client';
  import { getModelColor, MODEL_BADGE_COLORS, MONOSPACE_FONT, BODY_FONT } from '../lib/design-tokens';
  import type { AgentProfile } from '@arena/shared';
  import Link from 'next/link';

  interface AgentCardProps {
    profile: AgentProfile;
    onEdit?: (profile: AgentProfile) => void;
    onFork?: (profile: AgentProfile) => void;
    onRetire?: (profile: AgentProfile) => void;
  }

  export function AgentCard({ profile, onEdit, onFork, onRetire }: AgentCardProps) {
    const modelColor = getModelColor(profile.provider);
    const badgeColors = MODEL_BADGE_COLORS[profile.provider] ?? { bg: 'rgba(74,143,168,0.15)', fg: '#4a8fa8', border: 'rgba(74,143,168,0.3)' };
    const isSystem = profile.createdBy === 'system';
    const statsLabel = profile.statsTotal > 0
      ? `${profile.statsWins}W / ${profile.statsLosses}L · ${profile.statsAvgScore !== undefined ? profile.statsAvgScore.toFixed(2) : '—'} avg`
      : '— no battles yet';

    return (
      <div style={{
        background: 'rgba(0,8,16,0.7)',
        border: '1px solid rgba(0,240,255,0.12)',
        borderRadius: '10px',
        padding: '1.1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.7rem',
        position: 'relative',
        transition: 'border-color 0.15s',
      }}>
        {/* Header: avatar + name + provider badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          {/* Avatar circle */}
          <div style={{
            width: '2.4rem',
            height: '2.4rem',
            borderRadius: '50%',
            background: `${modelColor}22`,
            border: `1.5px solid ${modelColor}66`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.1rem',
            flexShrink: 0,
          }}>
            {profile.avatar ?? '🤖'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: MONOSPACE_FONT,
              fontSize: '0.75rem',
              fontWeight: 800,
              color: '#c8eef8',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {profile.name}
            </div>
            <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', marginTop: '0.15rem', flexWrap: 'wrap' }}>
              {/* Provider badge */}
              <span style={{
                fontSize: '0.55rem',
                fontWeight: 800,
                padding: '0.08rem 0.35rem',
                borderRadius: '3px',
                background: badgeColors.bg,
                color: badgeColors.fg,
                border: `1px solid ${badgeColors.border}`,
                fontFamily: MONOSPACE_FONT,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
              }}>
                {profile.provider}
              </span>
              {/* Fork badge */}
              {profile.forkedFromId && (
                <span style={{ fontSize: '0.55rem', color: '#4a8fa8', fontFamily: MONOSPACE_FONT }}>
                  ⑂ fork
                </span>
              )}
              {/* System badge */}
              {isSystem && (
                <span style={{
                  fontSize: '0.55rem',
                  fontWeight: 800,
                  padding: '0.08rem 0.35rem',
                  borderRadius: '3px',
                  background: 'rgba(255,215,0,0.1)',
                  color: '#ffd700',
                  border: '1px solid rgba(255,215,0,0.3)',
                  fontFamily: MONOSPACE_FONT,
                  letterSpacing: '0.5px',
                }}>
                  SYSTEM
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tags */}
        {profile.tags && profile.tags.length > 0 && (
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {profile.tags.map(tag => (
              <span key={tag} style={{
                fontSize: '0.58rem',
                padding: '0.1rem 0.4rem',
                borderRadius: '3px',
                background: 'rgba(0,240,255,0.06)',
                color: '#3d7d94',
                border: '1px solid rgba(0,240,255,0.1)',
                fontFamily: BODY_FONT,
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Stats */}
        <div style={{
          fontSize: '0.62rem',
          color: profile.statsTotal > 0 ? '#7cc6db' : '#3d7d94',
          fontFamily: BODY_FONT,
          borderTop: '1px solid rgba(0,240,255,0.06)',
          paddingTop: '0.5rem',
        }}>
          {statsLabel}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <Link
            href={`/competitions/new?personaProvider=${profile.provider}&personaName=${profile.name}`}
            style={{
              fontSize: '0.62rem',
              fontWeight: 700,
              padding: '0.25rem 0.6rem',
              borderRadius: '4px',
              background: 'rgba(255,102,0,0.12)',
              color: '#ff6600',
              border: '1px solid rgba(255,102,0,0.3)',
              fontFamily: MONOSPACE_FONT,
              textDecoration: 'none',
              letterSpacing: '0.3px',
            }}
          >
            ⚔ Use
          </Link>
          {!isSystem && onEdit && (
            <button
              onClick={() => onEdit(profile)}
              style={{
                fontSize: '0.62rem',
                fontWeight: 700,
                padding: '0.25rem 0.6rem',
                borderRadius: '4px',
                background: 'transparent',
                color: '#4a8fa8',
                border: '1px solid rgba(74,143,168,0.3)',
                fontFamily: MONOSPACE_FONT,
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
          )}
          {onFork && (
            <button
              onClick={() => onFork(profile)}
              style={{
                fontSize: '0.62rem',
                fontWeight: 700,
                padding: '0.25rem 0.6rem',
                borderRadius: '4px',
                background: 'transparent',
                color: '#4a8fa8',
                border: '1px solid rgba(74,143,168,0.3)',
                fontFamily: MONOSPACE_FONT,
                cursor: 'pointer',
              }}
            >
              ⑂ Fork
            </button>
          )}
          {!isSystem && onRetire && (
            <button
              onClick={() => onRetire(profile)}
              style={{
                fontSize: '0.62rem',
                padding: '0.25rem 0.6rem',
                borderRadius: '4px',
                background: 'transparent',
                color: '#3d7d94',
                border: '1px solid rgba(61,125,148,0.2)',
                fontFamily: MONOSPACE_FONT,
                cursor: 'pointer',
              }}
            >
              Retire
            </button>
          )}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Create `packages/web/components/EmojiPicker.tsx`**

  ```tsx
  'use client';
  import { getModelColor } from '../lib/design-tokens';

  const EMOJI_OPTIONS = ['🤖','🧠','⚡','🏗️','🔬','⚔️','🛡️','🚀','🔧','💻','✨','🎯','🦾','🌊','🔮','🧬','💡','🎲','🧩','🦅'];

  interface EmojiPickerProps {
    selected: string;
    provider: string;
    onChange: (emoji: string) => void;
  }

  export function EmojiPicker({ selected, provider, onChange }: EmojiPickerProps) {
    const color = getModelColor(provider);
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', maxWidth: '280px' }}>
        {EMOJI_OPTIONS.map(emoji => (
          <button
            key={emoji}
            type="button"
            onClick={() => onChange(emoji)}
            style={{
              width: '2rem',
              height: '2rem',
              borderRadius: '6px',
              border: selected === emoji ? `1.5px solid ${color}` : '1.5px solid rgba(0,240,255,0.1)',
              background: selected === emoji ? `${color}1a` : 'transparent',
              cursor: 'pointer',
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.1s',
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 3: Typecheck web package**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json 2>&1
  ```

  Expected: No errors.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/web/components/AgentCard.tsx \
          packages/web/components/EmojiPicker.tsx
  git commit -m "feat(components): add AgentCard and EmojiPicker components"
  ```

---

### Task 7: Agent Armory page (gallery + filters + localStorage migration banner)

**Files:**
- Create: `packages/web/app/agent-armory/page.tsx`

**Context:** This is the main page. It fetches profiles from `/api/agent-profiles`, renders a filter bar and card gallery. Uses the same hero pattern as all other pages. Migration banner appears if `localStorage.getItem('arena4ai:personas')` has data. Create/edit form is rendered as an inline panel (not a modal) when `editingProfile` is set.

- [ ] **Step 1: Read the gallery page (`app/page.tsx`) hero pattern for reference**

  ```bash
  grep -n "KICKER_STYLE\|gradient\|hero\|maxWidth.*1400" packages/web/app/page.tsx | head -20
  ```

- [ ] **Step 2: Create `packages/web/app/agent-armory/page.tsx`**

  Create this file with:

  ```tsx
  'use client';

  import { useState, useEffect } from 'react';
  import { AgentCard } from '../../components/AgentCard';
  import { EmojiPicker } from '../../components/EmojiPicker';
  import { MONOSPACE_FONT, BODY_FONT, KICKER_STYLE, getModelColor } from '../../lib/design-tokens';
  import type { AgentProfile } from '@arena/shared';

  type Provider = 'claude' | 'codex' | 'gemini';
  type FormState = {
    name: string;
    provider: Provider;
    modelVariant: string;
    avatar: string;
    description: string;
    tags: string;
    systemPrompt: string;
  };

  const BLANK_FORM: FormState = {
    name: '', provider: 'claude', modelVariant: 'claude-sonnet-4-6',
    avatar: '🤖', description: '', tags: '', systemPrompt: '',
  };

  const MODEL_VARIANTS: Record<Provider, string[]> = {
    claude: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
    codex: ['codex-standard'],
    gemini: ['gemini-2-flash', 'gemini-1-5-pro'],
  };

  export default function AgentArmoryPage() {
    const [profiles, setProfiles] = useState<AgentProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterProvider, setFilterProvider] = useState<Provider | 'all'>('all');
    const [showRetired, setShowRetired] = useState(false);
    const [editingProfile, setEditingProfile] = useState<AgentProfile | null>(null);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [form, setForm] = useState<FormState>(BLANK_FORM);
    const [saving, setSaving] = useState(false);
    const [migrationCount, setMigrationCount] = useState(0);
    const [migrationDismissed, setMigrationDismissed] = useState(false);

    // Load profiles
    useEffect(() => {
      fetch('/api/agent-profiles')
        .then(r => r.json())
        .then((data: AgentProfile[]) => { setProfiles(data); setLoading(false); })
        .catch(() => setLoading(false));
    }, []);

    // Check localStorage migration
    useEffect(() => {
      const migrated = localStorage.getItem('arena4ai:personas-migrated');
      if (migrated) return;
      const raw = localStorage.getItem('arena4ai:personas');
      if (raw) {
        try {
          const personas = JSON.parse(raw);
          if (Array.isArray(personas) && personas.length > 0) {
            setMigrationCount(personas.length);
          }
        } catch {}
      }
    }, []);

    const refresh = async () => {
      const r = await fetch('/api/agent-profiles');
      const data: AgentProfile[] = await r.json();
      setProfiles(data);
    };

    const handleMigrate = async () => {
      const raw = localStorage.getItem('arena4ai:personas');
      if (!raw) return;
      try {
        const personas = JSON.parse(raw);
        for (const p of personas) {
          await fetch('/api/agent-profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: p.name,
              provider: p.model,
              modelVariant: MODEL_VARIANTS[p.model as Provider]?.[0] ?? 'claude-sonnet-4-6',
              systemPrompt: p.systemPrompt,
              description: p.description,
              avatar: '🤖',
            }),
          });
        }
        localStorage.removeItem('arena4ai:personas');
        localStorage.setItem('arena4ai:personas-migrated', '1');
        setMigrationCount(0);
        await refresh();
      } catch {}
    };

    const handleDismiss = () => {
      localStorage.setItem('arena4ai:personas-migrated', '1');
      setMigrationCount(0);
      setMigrationDismissed(true);
    };

    const openCreate = () => { setForm(BLANK_FORM); setEditingProfile(null); setShowCreateForm(true); };
    const openEdit = (p: AgentProfile) => {
      setForm({ name: p.name, provider: p.provider, modelVariant: p.modelVariant, avatar: p.avatar ?? '🤖', description: p.description ?? '', tags: (p.tags ?? []).join(', '), systemPrompt: p.systemPrompt });
      setEditingProfile(p);
      setShowCreateForm(true);
    };
    const closeForm = () => { setShowCreateForm(false); setEditingProfile(null); };

    const handleSave = async () => {
      setSaving(true);
      const body = { ...form, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean) };
      if (editingProfile) {
        await fetch(`/api/agent-profiles/${editingProfile.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await fetch('/api/agent-profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      setSaving(false);
      closeForm();
      await refresh();
    };

    const handleFork = async (p: AgentProfile) => {
      const name = prompt(`Fork "${p.name}" — enter a name for the fork:`);
      if (!name) return;
      await fetch(`/api/agent-profiles/${p.id}/fork`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      await refresh();
    };

    const handleRetire = async (p: AgentProfile) => {
      if (!confirm(`Retire "${p.name}"? It will be hidden from the battle picker.`)) return;
      await fetch(`/api/agent-profiles/${p.id}`, { method: 'DELETE' });
      await refresh();
    };

    // Filter
    const activeProfiles = profiles.filter(p => !p.retired && (filterProvider === 'all' || p.provider === filterProvider));
    const retiredProfiles = profiles.filter(p => p.retired);

    return (
      <div style={{ minHeight: '100vh', background: '#000408', paddingBottom: '4rem' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '1.5rem 1.5rem 0' }}>

          {/* Hero */}
          <div style={{ marginBottom: '2rem', paddingTop: '1rem' }}>
            <div style={{ ...KICKER_STYLE, color: '#00f0ff', marginBottom: '0.4rem' }}>◆ ARENA4AI | ARMORY</div>
            <h1 style={{ fontFamily: MONOSPACE_FONT, fontSize: '1.9rem', fontWeight: 900, margin: '0 0 0.4rem', background: 'linear-gradient(135deg, #c8eef8, #00f0ff, #0080ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Agent Armory
            </h1>
            <p style={{ fontSize: '0.72rem', color: '#4a8fa8', margin: 0, fontFamily: BODY_FONT }}>
              Build, fork, and track your AI agent roster.
            </p>
          </div>

          {/* Migration banner */}
          {migrationCount > 0 && !migrationDismissed && (
            <div style={{ background: 'rgba(255,215,0,0.07)', border: '1px solid rgba(255,215,0,0.2)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.68rem', color: '#ffd700', fontFamily: BODY_FONT, flex: 1 }}>
                Found {migrationCount} saved persona{migrationCount > 1 ? 's' : ''} in local storage. Import them to the Armory?
              </span>
              <button onClick={handleMigrate} style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.25rem 0.7rem', borderRadius: '4px', background: 'rgba(255,215,0,0.15)', color: '#ffd700', border: '1px solid rgba(255,215,0,0.4)', cursor: 'pointer', fontFamily: MONOSPACE_FONT }}>
                Import
              </button>
              <button onClick={handleDismiss} style={{ fontSize: '0.65rem', color: '#3d7d94', background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONOSPACE_FONT }}>
                Dismiss
              </button>
            </div>
          )}

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            {/* Filter pills */}
            {(['all', 'claude', 'codex', 'gemini'] as const).map(p => (
              <button key={p} onClick={() => setFilterProvider(p)} style={{
                fontSize: '0.65rem', fontWeight: 700, padding: '0.3rem 0.75rem', borderRadius: '5px', cursor: 'pointer',
                fontFamily: MONOSPACE_FONT, letterSpacing: '0.5px',
                border: filterProvider === p ? '1px solid rgba(0,240,255,0.5)' : '1px solid #0a2235',
                background: filterProvider === p ? 'rgba(0,240,255,0.1)' : 'transparent',
                color: filterProvider === p ? '#00f0ff' : '#4a8fa8',
              }}>
                {p === 'all' ? 'All' : p}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button onClick={openCreate} style={{ fontSize: '0.68rem', fontWeight: 800, padding: '0.35rem 0.9rem', borderRadius: '5px', background: 'rgba(255,102,0,0.15)', color: '#ff6600', border: '1px solid rgba(255,102,0,0.4)', cursor: 'pointer', fontFamily: MONOSPACE_FONT }}>
              + New Agent
            </button>
          </div>

          {/* Create/Edit form panel */}
          {showCreateForm && (
            <div style={{ background: 'rgba(0,8,20,0.9)', border: '1px solid rgba(0,240,255,0.2)', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <div style={{ fontFamily: MONOSPACE_FONT, fontSize: '0.8rem', fontWeight: 800, color: '#c8eef8', marginBottom: '1rem' }}>
                {editingProfile ? 'Edit Agent' : 'New Agent'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {/* Name */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#4a8fa8', fontFamily: MONOSPACE_FONT, marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Name</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="The Architect" style={{ width: '100%', background: '#000c18', border: '1px solid #0a2235', borderRadius: '5px', padding: '0.45rem 0.6rem', color: '#c8eef8', fontSize: '0.72rem', fontFamily: BODY_FONT, boxSizing: 'border-box' }} />
                </div>
                {/* Provider */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#4a8fa8', fontFamily: MONOSPACE_FONT, marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Provider</label>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    {(['claude', 'codex', 'gemini'] as Provider[]).map(p => (
                      <button key={p} type="button" onClick={() => setForm(f => ({ ...f, provider: p, modelVariant: MODEL_VARIANTS[p][0] }))} style={{ fontSize: '0.62rem', fontWeight: 700, padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontFamily: MONOSPACE_FONT, border: form.provider === p ? `1px solid ${getModelColor(p)}88` : '1px solid #0a2235', background: form.provider === p ? `${getModelColor(p)}15` : 'transparent', color: form.provider === p ? getModelColor(p) : '#4a8fa8' }}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Model Variant */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#4a8fa8', fontFamily: MONOSPACE_FONT, marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Model Variant</label>
                  <select value={form.modelVariant} onChange={e => setForm(f => ({ ...f, modelVariant: e.target.value }))} style={{ width: '100%', background: '#000c18', border: '1px solid #0a2235', borderRadius: '5px', padding: '0.45rem 0.6rem', color: '#c8eef8', fontSize: '0.72rem', fontFamily: BODY_FONT }}>
                    {MODEL_VARIANTS[form.provider].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                {/* Avatar */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#4a8fa8', fontFamily: MONOSPACE_FONT, marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Avatar</label>
                  <EmojiPicker selected={form.avatar} provider={form.provider} onChange={emoji => setForm(f => ({ ...f, avatar: emoji }))} />
                </div>
                {/* Description */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#4a8fa8', fontFamily: MONOSPACE_FONT, marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Description</label>
                  <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Short bio" style={{ width: '100%', background: '#000c18', border: '1px solid #0a2235', borderRadius: '5px', padding: '0.45rem 0.6rem', color: '#c8eef8', fontSize: '0.72rem', fontFamily: BODY_FONT, boxSizing: 'border-box' }} />
                </div>
                {/* Tags */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#4a8fa8', fontFamily: MONOSPACE_FONT, marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Tags (comma-separated)</label>
                  <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="fast, minimal, coding" style={{ width: '100%', background: '#000c18', border: '1px solid #0a2235', borderRadius: '5px', padding: '0.45rem 0.6rem', color: '#c8eef8', fontSize: '0.72rem', fontFamily: BODY_FONT, boxSizing: 'border-box' }} />
                </div>
              </div>
              {/* System Prompt */}
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, color: '#4a8fa8', fontFamily: MONOSPACE_FONT, marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '1px' }}>System Prompt</label>
                <textarea value={form.systemPrompt} onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))} rows={5} placeholder="You are..." style={{ width: '100%', background: '#000c18', border: '1px solid #0a2235', borderRadius: '5px', padding: '0.45rem 0.6rem', color: '#c8eef8', fontSize: '0.72rem', fontFamily: BODY_FONT, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button onClick={handleSave} disabled={saving || !form.name || !form.systemPrompt} style={{ fontSize: '0.68rem', fontWeight: 800, padding: '0.35rem 0.9rem', borderRadius: '5px', background: saving ? 'rgba(0,240,255,0.05)' : 'rgba(0,240,255,0.1)', color: '#00f0ff', border: '1px solid rgba(0,240,255,0.3)', cursor: saving ? 'default' : 'pointer', fontFamily: MONOSPACE_FONT }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={closeForm} style={{ fontSize: '0.68rem', padding: '0.35rem 0.9rem', borderRadius: '5px', background: 'transparent', color: '#3d7d94', border: '1px solid #0a2235', cursor: 'pointer', fontFamily: MONOSPACE_FONT }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Card gallery */}
          {loading ? (
            <div style={{ color: '#3d7d94', fontSize: '0.72rem', fontFamily: BODY_FONT }}>Loading agents…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem' }}>
              {activeProfiles.map(p => (
                <AgentCard key={p.id} profile={p} onEdit={openEdit} onFork={handleFork} onRetire={handleRetire} />
              ))}
              {activeProfiles.length === 0 && (
                <div style={{ gridColumn: '1/-1', color: '#3d7d94', fontSize: '0.72rem', fontFamily: BODY_FONT, padding: '2rem 0' }}>
                  No agents found. Create one above!
                </div>
              )}
            </div>
          )}

          {/* Retired section */}
          {retiredProfiles.length > 0 && (
            <div style={{ marginTop: '2rem' }}>
              <button onClick={() => setShowRetired(o => !o)} style={{ fontSize: '0.65rem', color: '#3d7d94', background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONOSPACE_FONT, letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                {showRetired ? '▼' : '▶'} Retired ({retiredProfiles.length})
              </button>
              {showRetired && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem', marginTop: '0.75rem', opacity: 0.5 }}>
                  {retiredProfiles.map(p => (
                    <AgentCard key={p.id} profile={p} onFork={handleFork} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json 2>&1
  ```

  Expected: No errors.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/web/app/agent-armory/page.tsx
  git commit -m "feat(ui): add /agent-armory page with card gallery, filters, and migration banner"
  ```

---

### Task 8: TopBar update, /personas redirect, and Step 3 Armory picker

**Files:**
- Modify: `packages/web/components/TopBar.tsx`
- Modify: `packages/web/app/personas/page.tsx`
- Modify: `packages/web/app/competitions/new/page.tsx`

**Context:** TopBar nav: change `{ href: '/personas', label: 'Personas' }` to `{ href: '/agent-armory', label: 'Armory' }`. Personas page: replace all content with a Next.js `redirect('/agent-armory')`. Step 3 Teams: add an "Armory" tab to the persona picker area that fetches non-retired profiles and shows mini-cards; retain the existing freeform input for backward compat.

- [ ] **Step 1: Update TopBar.tsx**

  Find `const NAV_LINKS = [` and replace the entire array with:
  ```ts
  const NAV_LINKS = [
    { href: '/briefs',          label: 'Briefs'       },
    { href: '/leaderboard',     label: 'Leaderboard'  },
    { href: '/analytics',       label: 'Analytics'    },
    { href: '/tournaments/new', label: 'Tournaments'  },
    { href: '/compare',         label: 'Compare'      },
    { href: '/agent-armory',    label: 'Armory'       },
  ];
  ```

- [ ] **Step 2: Replace personas/page.tsx with a redirect**

  Replace the entire content of `packages/web/app/personas/page.tsx` with:
  ```ts
  import { redirect, RedirectType } from 'next/navigation';

  export default function PersonasPage() {
    redirect('/agent-armory', RedirectType.permanent);
  }
  ```

  Note: `RedirectType.permanent` issues a 301 (Permanent Redirect). The default `redirect()` without it issues a 307 Temporary Redirect.

- [ ] **Step 3: Update Step 3 in competitions/new/page.tsx**

  Find the "Custom personas" section in Step 3 (where localStorage personas are loaded). Replace it with an Armory-aware section:

  a) Add state at top of component:
  ```tsx
  const [armoryProfiles, setArmoryProfiles] = useState<AgentProfile[]>([]);
  const [armoryLoaded, setArmoryLoaded] = useState(false);
  ```

  b) Add type import:
  ```tsx
  import type { AgentProfile } from '@arena/shared';
  ```

  c) Add a useEffect to load Armory profiles when Step 3 is reached:
  ```tsx
  useEffect(() => {
    if (expandedStep !== 3 || armoryLoaded) return;
    fetch('/api/agent-profiles?retired=false')
      .then(r => r.json())
      .then((data: AgentProfile[]) => { setArmoryProfiles(data); setArmoryLoaded(true); })
      .catch(() => setArmoryLoaded(true));
  }, [expandedStep, armoryLoaded]);
  ```

  d) In the persona picker area for each team (inside the Step 3 `expandedStep === 3` block), find and replace the localStorage custom persona block (lines ~1506–1517):

  **Replace this:**
  ```tsx
                          {/* Custom saved personas for this model */}
                          {savedPersonas.filter((sp) => sp.model === team.model).map((sp) => (
                            <button
                              key={sp.id} type="button"
                              className={`persona-chip ${team.persona === sp.name ? 'active' : ''}`}
                              onClick={() => setTeams((prev) => prev.map((t, idx) => idx === i ? { ...t, persona: sp.name } : t))}
                              title={sp.description || sp.name}
                              style={{ borderStyle: 'dashed' }}
                            >
                              {sp.name} *
                            </button>
                          ))}
  ```

  **With this** (Armory profiles for this provider, plus a link to the Armory):
  ```tsx
  {/* Armory profiles for this provider */}
  {armoryProfiles.filter(p => p.provider === team.model && p.createdBy !== 'system').map(p => (
    <button
      key={p.id}
      type="button"
      onClick={() => setTeams((prev) => prev.map((t, idx) => idx === i ? { ...t, persona: p.name } : t))}
      style={{
        fontSize: '0.62rem',
        fontWeight: team.persona === p.name ? 800 : 600,
        padding: '0.25rem 0.55rem',
        borderRadius: '4px',
        border: team.persona === p.name ? '1px solid rgba(0,240,255,0.5)' : '1px dashed rgba(0,240,255,0.2)',
        background: team.persona === p.name ? 'rgba(0,240,255,0.08)' : 'transparent',
        color: team.persona === p.name ? '#00f0ff' : '#3d7d94',
        cursor: 'pointer',
        fontFamily: MONOSPACE_FONT,
      }}
    >
      {p.avatar ?? '🤖'} {p.name}
    </button>
  ))}
  {/* Go to Armory link */}
  <a href="/agent-armory" target="_blank" style={{ fontSize: '0.58rem', color: '#3d7d94', fontFamily: BODY_FONT, textDecoration: 'none' }}>
    + Go to Armory
  </a>
  ```

- [ ] **Step 4: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json 2>&1
  ```

  Expected: No errors.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/web/components/TopBar.tsx \
          packages/web/app/personas/page.tsx \
          packages/web/app/competitions/new/page.tsx
  git commit -m "feat(nav): update TopBar to Armory, redirect /personas, wire Armory picker in Step 3"
  ```

---

### Task 9: Integration check

**Files:** None (read-only verification)

- [ ] **Step 1: Run full orchestrator test suite**

  ```bash
  DATABASE_URL=postgresql://localhost/arena npm run test --workspace=packages/orchestrator 2>&1 | tail -10
  ```

  Expected: All tests pass (168+ total — 159 baseline + 9 new from Task 2 + 1 from Task 3).

- [ ] **Step 2: Typecheck all packages**

  ```bash
  npm run typecheck --workspace=packages/orchestrator 2>&1 && \
  npx tsc --noEmit -p packages/web/tsconfig.json 2>&1 && \
  npx tsc --noEmit -p packages/shared/tsconfig.json 2>&1
  echo "All typechecks passed"
  ```

  Expected: "All typechecks passed" with no errors.

- [ ] **Step 3: Smoke test the Armory**

  Start the stack:
  ```bash
  # Terminal 1
  DATABASE_URL=postgresql://localhost/arena npx tsx packages/orchestrator/src/cli.ts serve --port 3000
  # Terminal 2
  cd packages/web && npm run dev
  ```

  Navigate to `http://localhost:3001/agent-armory`:
  - Verify 9 system persona cards appear (architect, speedrunner, etc.)
  - Verify system cards have SYSTEM badge, no Edit/Retire buttons
  - Click "+ New Agent" → fill form → save → card appears in gallery
  - Click Fork on a system card → new fork card appears with ⑂ badge
  - Click Retire on custom card → card moves to Retired section
  - Navigate to `/personas` → verify redirect to `/agent-armory`
  - Navigate to `/competitions/new` → Step 3 → verify Armory profiles appear

- [ ] **Step 4: Smoke test seed data**

  ```bash
  curl http://localhost:3001/api/agent-profiles | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d)} profiles, system: {sum(1 for p in d if p[\"createdBy\"]==\"system\")}')"
  ```

  Expected: `9 profiles, system: 9` (or more if you added extras). This hits the Next.js proxy route to verify end-to-end routing.

- [ ] **Step 5: Final commit**

  ```bash
  git add -p  # stage any incidental fixes
  git commit -m "test(sprint3): integration verified — all tests pass, armory functional"
  ```

---

> Sprint 3 complete. Use `superpowers:finishing-a-development-branch` to merge or create a PR.
