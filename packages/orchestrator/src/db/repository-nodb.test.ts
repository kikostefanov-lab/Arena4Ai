import { describe, it, expect, vi } from 'vitest';
import { CompetitionState } from '@arena/shared';

// Pure-logic tests with a recording fake Db: no Postgres required.
vi.mock('./client.js', () => ({ db: {} }));

import { CompetitionRepository } from './repository.js';
import { competitions, events, results, resultsHistory } from './schema.js';

describe('CompetitionRepository.updateState (no DB)', () => {
  function makeRepo() {
    const sets: Array<Record<string, unknown>> = [];
    const db = {
      update: () => ({
        set: (patch: Record<string, unknown>) => {
          sets.push(patch);
          return { where: async () => undefined };
        },
      }),
    };
    return { repo: new CompetitionRepository(db as never), sets };
  }

  it('stamps completedAt on COMPLETE', async () => {
    const { repo, sets } = makeRepo();
    await repo.updateState('c', CompetitionState.COMPLETE);
    expect(sets[0].completedAt).toBeInstanceOf(Date);
  });

  it('does not overwrite completedAt when the Forge finishes', async () => {
    const { repo, sets } = makeRepo();
    await repo.updateState('c', CompetitionState.FORGING);
    await repo.updateState('c', CompetitionState.FORGE_COMPLETE);
    expect(sets).toHaveLength(2);
    for (const patch of sets) expect(patch).not.toHaveProperty('completedAt');
    expect(sets[1].state).toBe('FORGE_COMPLETE');
  });
});

describe('CompetitionRepository.delete (no DB)', () => {
  it('removes results_history rows inside the same transaction, before the competition row', async () => {
    const deleted: unknown[] = [];
    const tx = {
      delete: (table: unknown) => {
        deleted.push(table);
        return {
          where: () => Object.assign(Promise.resolve([{ id: 'c' }]), { returning: async () => [{ id: 'c' }] }),
        };
      },
    };
    const db = { transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
    const repo = new CompetitionRepository(db as never);

    expect(await repo.delete('c')).toBe(true);
    expect(deleted).toContain(resultsHistory);
    const last = deleted.indexOf(competitions);
    expect(deleted.indexOf(resultsHistory)).toBeLessThan(last);
    expect(deleted.indexOf(events)).toBeLessThan(last);
    expect(deleted.indexOf(results)).toBeLessThan(last);
  });
});
