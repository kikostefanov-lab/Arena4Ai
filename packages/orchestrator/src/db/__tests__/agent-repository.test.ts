import { describe, it, expect, vi } from 'vitest';

const hasDb = !!process.env.DATABASE_URL;
if (!hasDb) {
  vi.mock('../client.js', () => ({ db: {} }));
}

import { AgentRepository } from '../agent-repository.js';
import { db } from '../client.js';

const describeWithDb = hasDb ? describe : describe.skip;

const repo = new AgentRepository(db);

describeWithDb('AgentRepository', () => {
  it('lists agents with nested persona', async () => {
    const result = await repo.list({ retired: false });
    expect(Array.isArray(result.agents)).toBe(true);
    expect(result.agents.length).toBeGreaterThan(0);
    const first = result.agents[0];
    expect(first).toHaveProperty('persona');
    if (first.persona) {
      expect(first.persona).toHaveProperty('systemPrompt');
    }
  });

  it('gets agent by id with persona', async () => {
    const list = await repo.list({ retired: false });
    if (!list.agents.length) return;
    const agent = await repo.get(list.agents[0].id);
    expect(agent).not.toBeNull();
    expect(agent?.provider).toBeDefined();
  });

  it('finds agent by provider and persona name', async () => {
    const found = await repo.getByProviderAndPersonaName('claude', 'architect');
    expect(found).not.toBeNull();
    expect(found?.provider).toBe('claude');
    expect(found?.persona?.name).toBe('architect');
  });

  it('increments stats correctly', async () => {
    const list = await repo.list({ retired: false });
    if (!list.agents.length) return;
    const id = list.agents[0].id;
    const before = await repo.get(id);
    await repo.incrementStats(id, { won: true, score: 0.8 });
    const after = await repo.get(id);
    expect(after!.statsWins).toBe((before?.statsWins ?? 0) + 1);
    expect(after!.statsTotal).toBe((before?.statsTotal ?? 0) + 1);
    // Restore stats to avoid polluting other tests
    await repo.incrementStats(id, { won: false, score: 0.0 });
    await db.update((await import('../schema.js')).agents)
      .set({ statsWins: before!.statsWins, statsTotal: before!.statsTotal, statsLosses: before!.statsLosses })
      .where((await import('drizzle-orm')).eq((await import('../schema.js')).agents.id, id));
  });
});
