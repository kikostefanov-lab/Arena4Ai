import { describe, it, expect } from 'vitest';
import { describeSquadEvent, squadSummary, deliveredList } from './squad-hud.js';
import { createWorld } from './world.js';
import type { SquadMember } from './world.js';

describe('describeSquadEvent', () => {
  it('words a spawn as label · model', () => {
    expect(describeSquadEvent('SUB_AGENT_SPAWN', { agentId: 'x1', label: 'research kegs', model: 'haiku', depth: 1 }))
      .toEqual({ icon: '🛰', label: 'SQUAD +', text: 'research kegs · haiku' });
  });

  it('leaves the model out when there is none, and falls back to the id', () => {
    expect(describeSquadEvent('SUB_AGENT_SPAWN', { agentId: 'x1', label: 'research kegs', depth: 1 })?.text).toBe('research kegs');
    expect(describeSquadEvent('SUB_AGENT_SPAWN', { agentId: 'x1', depth: 1 })?.text).toBe('x1');
  });

  it('marks a completed sub-agent with a tick and the rest with a cross', () => {
    expect(describeSquadEvent('SUB_AGENT_DONE', { agentId: 'x1', status: 'completed' })).toMatchObject({ icon: '✓', text: 'completed' });
    expect(describeSquadEvent('SUB_AGENT_DONE', { agentId: 'x1', status: 'failed', reason: 'rate limit' }))
      .toMatchObject({ icon: '✗', text: 'failed · rate limit' });
    expect(describeSquadEvent('SUB_AGENT_DONE', { agentId: 'x1', status: 'killed' })?.icon).toBe('✗');
    expect(describeSquadEvent('SUB_AGENT_DONE', { agentId: 'x1' })).toMatchObject({ icon: '✗', text: 'unknown' });
  });

  it('is null for other events and bad payloads', () => {
    expect(describeSquadEvent('TOOL_CALL', { tool: 'Bash' })).toBeNull();
    expect(describeSquadEvent('SUB_AGENT_SPAWN', null)).toBeNull();
    expect(describeSquadEvent('SUB_AGENT_DONE', 'x')).toBeNull();
  });
});

const member = (id: string, status: SquadMember['status'], model?: string): SquadMember => ({
  id, label: id, model, spawnedAt: 0, status, files: 0, tools: 0, lastActiveAt: 0, slot: 0,
});

describe('squadSummary', () => {
  it('counts running members as active and reads spawned/failed from the totals', () => {
    const world = createWorld([{ id: 'a', model: 'claude' }], []);
    const team = world.teams.get('a')!;
    team.squad.set('m1', member('m1', 'completed', 'haiku'));
    team.squad.set('m2', member('m2', 'running', 'sonnet'));
    team.squad.set('m3', member('m3', 'failed', 'haiku'));
    team.squadTotals = { spawned: 3, failed: 1, peak: 2 };
    expect(squadSummary(team)).toEqual({ active: 1, spawned: 3, failed: 1, models: ['haiku', 'sonnet'] });
  });

  it('is all zero for a team with no squad', () => {
    const world = createWorld([{ id: 'a', model: 'claude' }], []);
    expect(squadSummary(world.teams.get('a')!)).toEqual({ active: 0, spawned: 0, failed: 0, models: [] });
  });
});

describe('deliveredList', () => {
  it('lists the brief names in order with a done flag per team', () => {
    const world = createWorld([{ id: 'a', model: 'claude' }, { id: 'b', model: 'codex' }], [], {
      deliverables: ['decision.md with the verdict', 'research/kegs.md'],
    });
    world.teams.get('a')!.delivered.add('decision.md');
    expect(deliveredList(world, 'a')).toEqual([
      { name: 'decision.md', done: true },
      { name: 'research/kegs.md', done: false },
    ]);
    expect(deliveredList(world, 'b').every((d) => !d.done)).toBe(true);
    expect(deliveredList(world, 'nope')).toEqual([]);
  });
});
