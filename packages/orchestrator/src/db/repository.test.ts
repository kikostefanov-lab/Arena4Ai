import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { CompetitionFormat, CompetitionState } from '@arena/shared';
import type { ForgeArtifact } from '@arena/shared';

// These tests require a real Postgres connection.
// Run with: DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena npx vitest run src/db/repository.test.ts

const hasDb = !!process.env.DATABASE_URL;

// When DATABASE_URL is absent, mock client.ts to prevent the module-level throw.
if (!hasDb) {
  vi.mock('./client.js', () => ({ db: {} }));
}

import { CompetitionRepository, normalizeArtifact } from './repository.js';
import { db } from './client.js';
import { competitions, events, results } from './schema.js';
import { eq } from 'drizzle-orm';

const repo = new CompetitionRepository(db as never);

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
  if (!hasDb) return;
  competitionId = `test-${Date.now()}`;
  await repo.create(competitionId, testBrief as never, testTeams);
});

afterAll(async () => {
  if (!hasDb) return;
  await (db as never as { delete: Function }).delete(results).where(eq(results.competitionId, competitionId)).catch(() => {});
  await (db as never as { delete: Function }).delete(events).where(eq(events.competitionId, competitionId)).catch(() => {});
  await (db as never as { delete: Function }).delete(competitions).where(eq(competitions.id, competitionId)).catch(() => {});
});

describe.skipIf(!hasDb)('CompetitionRepository', () => {
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
    const result = await repo.getResult(competitionId);
    expect(result).not.toBeNull();
    expect(result?.winnerId).toBe('team-a');
  });

  it('lists competitions', async () => {
    const list = await repo.list(10);
    expect(list.some((c) => c.id === competitionId)).toBe(true);
  });

  it('getEvents with offset skips that many events', async () => {
    const all = await repo.getEvents(competitionId);
    const afterFirst = await repo.getEvents(competitionId, 1);
    expect(afterFirst).toHaveLength(all.length - 1);
  });
});

describe('normalizeArtifact (backward compat)', () => {
  it('sets outputFormat to markdown and filename to {type}.md for legacy records', () => {
    const legacy = {
      type: 'roadmap',
      title: 'Roadmap',
      content: '# Roadmap',
      generatedAt: '2024-01-01T00:00:00.000Z',
    } as unknown as ForgeArtifact;

    const normalized = normalizeArtifact(legacy);
    expect(normalized.outputFormat).toBe('markdown');
    expect(normalized.filename).toBe('roadmap.md');
  });

  it('does not overwrite existing outputFormat and filename', () => {
    const artifact: ForgeArtifact = {
      type: 'sql_schema',
      title: 'Schema',
      content: 'CREATE TABLE ...',
      generatedAt: '2024-01-01T00:00:00.000Z',
      outputFormat: 'sql',
      filename: 'schema.sql',
    };

    const normalized = normalizeArtifact(artifact);
    expect(normalized.outputFormat).toBe('sql');
    expect(normalized.filename).toBe('schema.sql');
  });
});
