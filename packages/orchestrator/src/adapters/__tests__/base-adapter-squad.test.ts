import { describe, it, expect } from 'vitest';
import { CompetitionFormat, EventType } from '@arena/shared';
import type { ArenaEvent, Brief } from '@arena/shared';
import { BaseAdapter } from '../base-adapter.js';
import { squadLimits } from '../squad-limits.js';
import { squadLabel, makeEvent } from '../normalizer-utils.js';

class TestAdapter extends BaseAdapter {
  async startExecution(): Promise<void> {}
  getPrompt() { return this.promptText; }
  emit2(e: ArenaEvent) { this.emitArenaEvent(e); }
  exit(code: number | null) { this.settleExit(code, 'test', () => {}); }
}

const BRIEF: Brief = {
  id: 'b', title: 'T', problem: 'P', constraints: [], deliverables: ['a.md'],
  rubric: { criteria: [{ id: 'c', description: 'd', weight: 1, maxScore: 10 }] },
  format: CompetitionFormat.SPRINT, timeLimitMs: 5 * 60_000,
};

const ctx = { competitionId: 'c1', teamId: 't1' };
const spawn = (agentId: string) =>
  makeEvent(EventType.SUB_AGENT_SPAWN, { agentId, label: agentId, description: agentId, depth: 1 }, ctx);
const done = (agentId: string) =>
  makeEvent(EventType.SUB_AGENT_DONE, { agentId, status: 'completed' }, ctx);

function collect(a: TestAdapter): ArenaEvent[] {
  const events: ArenaEvent[] = [];
  a.on('arenaEvent', (e: ArenaEvent) => events.push(e));
  return events;
}
const dones = (evs: ArenaEvent[]) => evs.filter((e) => e.type === EventType.SUB_AGENT_DONE);

describe('BaseAdapter squad bookkeeping', () => {
  it('closes open members as unknown when the lead exits on its own', () => {
    const a = new TestAdapter('t1', '/tmp', 'c1');
    const evs = collect(a);
    a.emit2(spawn('a')); a.emit2(spawn('b')); a.emit2(done('a'));
    a.exit(0);
    const d = dones(evs);
    expect(d).toHaveLength(2);
    expect(d[1]!.payload).toMatchObject({ agentId: 'b', status: 'unknown', reason: 'lead exited without reporting' });
  });

  it('closes open members as killed on shutdown, once, even with no process', async () => {
    const a = new TestAdapter('t1', '/tmp', 'c1');
    const evs = collect(a);
    a.emit2(spawn('a'));
    await a.shutdown();
    await a.shutdown();
    const d = dones(evs);
    expect(d).toHaveLength(1);
    expect(d[0]!.payload).toMatchObject({ agentId: 'a', status: 'killed', reason: 'deadline' });
    expect(a.openSubAgentCount).toBe(0);
  });

  it('does not close on exit after shutdown (stopping)', async () => {
    const a = new TestAdapter('t1', '/tmp', 'c1');
    const evs = collect(a);
    a.emit2(spawn('a'));
    await a.shutdown();
    a.exit(1);
    expect(dones(evs)).toHaveLength(1);
  });

  it('never emits two DONE events for one agent', () => {
    const a = new TestAdapter('t1', '/tmp', 'c1');
    const evs = collect(a);
    a.emit2(spawn('a'));
    a.exit(0);
    a.emit2(done('a'));
    expect(dones(evs)).toHaveLength(1);
  });

  it('ignores duplicate spawns', () => {
    const a = new TestAdapter('t1', '/tmp', 'c1');
    const evs = collect(a);
    a.emit2(spawn('a')); a.emit2(spawn('a'));
    expect(evs.filter((e) => e.type === EventType.SUB_AGENT_SPAWN)).toHaveLength(1);
    expect(a.openSubAgentCount).toBe(1);
  });
});

describe('squadLimits', () => {
  it('reads env and falls back', () => {
    expect(squadLimits({ ARENA_SQUAD_MAX_CONCURRENT: '3' }).maxConcurrent).toBe(3);
    expect(squadLimits({ ARENA_SQUAD_MAX_CONCURRENT: '0' }).maxConcurrent).toBe(6);
    expect(squadLimits({ ARENA_SQUAD_MAX_CONCURRENT: 'x' }).maxConcurrent).toBe(6);
    expect(squadLimits({}).maxDepth).toBe(1);
    expect(squadLimits({ ARENA_SQUAD_MAX_DEPTH: '2' }).maxDepth).toBe(2);
  });
});

describe('squadLabel', () => {
  it('shortens long descriptions', () => {
    const l = squadLabel('Write pricing-tiers.md and security-architecture.md');
    expect(l.length).toBeLessThanOrEqual(18);
    expect(l.endsWith('…')).toBe(true);
  });
  it('keeps short text and defaults when empty', () => {
    expect(squadLabel('Fix bug')).toBe('Fix bug');
    expect(squadLabel('  ')).toBe('sub-agent');
  });
});

describe('[SQUAD] prompt', () => {
  it('injects a [SQUAD] block that tells the lead to delegate', async () => {
    const a = new TestAdapter('t1', '/tmp', 'c1');
    await a.injectBrief(BRIEF, 'p');
    const p = a.getPrompt();
    for (const s of ['[SQUAD]', 'Delegate', 'skeleton', 'up to 6 at a time']) expect(p).toContain(s);
    expect(p.indexOf('[SQUAD]')).toBeGreaterThan(p.indexOf('[COMPETITION RULES]'));
    expect(p.indexOf('[SQUAD]')).toBeLessThan(p.indexOf('[BRIEF:'));
  });
});
