import { describe, it, expect } from 'vitest';
import { describeSquadEvent } from './squad-hud.js';

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
