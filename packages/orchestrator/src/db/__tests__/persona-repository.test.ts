import { describe, it, expect, afterEach } from 'vitest';
import { PersonaRepository } from '../persona-repository.js';
import { db } from '../client.js';
import { personas } from '../schema.js';
import { like } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const repo = new PersonaRepository(db);

async function cleanup(prefix: string) {
  await db.delete(personas).where(like(personas.id, `${prefix}%`));
}

describeWithDb('PersonaRepository', () => {
  afterEach(() => cleanup('test-persona-'));

  it('creates and retrieves a persona', async () => {
    const p = await repo.create({
      id: 'test-persona-1',
      name: 'test-create-persona',
      systemPrompt: 'test prompt',
      createdBy: 'test',
    });
    expect(p.id).toBe('test-persona-1');
    const fetched = await repo.get('test-persona-1');
    expect(fetched?.name).toBe('test-create-persona');
    expect(fetched?.agentCount).toBe(0);
  });

  it('lists personas with agent count', async () => {
    const list = await repo.list({ retired: false });
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(typeof list[0].agentCount).toBe('number');
  });

  it('updates a persona description', async () => {
    await repo.create({ id: 'test-persona-2', name: 'test-update-persona', systemPrompt: 'old', createdBy: 'test' });
    const updated = await repo.update('test-persona-2', { description: 'new desc' });
    expect(updated?.description).toBe('new desc');
  });

  it('retires a persona with no active agents', async () => {
    await repo.create({ id: 'test-persona-3', name: 'test-retire-persona', systemPrompt: 'x', createdBy: 'test' });
    const result = await repo.retire('test-persona-3');
    expect(result.retired).toBe(true);
  });

  it('returns notFound when retiring non-existent persona', async () => {
    const result = await repo.retire('non-existent-id');
    expect(result.notFound).toBe(true);
  });

  it('filters by search prefix', async () => {
    await repo.create({ id: 'test-persona-4', name: 'ztest-search-unique', systemPrompt: 'x', createdBy: 'test' });
    const results = await repo.list({ retired: false, search: 'ztest-search' });
    expect(results.some(p => p.id === 'test-persona-4')).toBe(true);
  });
});
