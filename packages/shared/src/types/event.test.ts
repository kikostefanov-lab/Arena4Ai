import { describe, it, expect } from 'vitest';
import { EventType } from '../constants/event-types.js';
import { PROVIDER_FILE_CAPABILITIES } from './event.js';
import type { ArenaEvent } from './event.js';
import { arenaEventSchema } from '../schemas/event.schema.js';

describe('ArenaEvent', () => {
  it('type-checks a valid event object', () => {
    const event: ArenaEvent<{ message: string }> = {
      eventId: 'evt_001',
      competitionId: 'comp_001',
      teamId: 'team-a',
      timestamp: new Date().toISOString(),
      type: EventType.TOOL_CALL,
      payload: { message: 'hello' },
      metadata: {},
    };
    expect(event.eventId).toBe('evt_001');
    expect(event.type).toBe(EventType.TOOL_CALL);
  });

  it('has a SUB_AGENT_DONE event type', () => {
    expect(EventType.SUB_AGENT_DONE).toBe('SUB_AGENT_DONE');
  });

  it('declares squad capabilities per provider', () => {
    expect(PROVIDER_FILE_CAPABILITIES.claude.subagentAttribution).toBe(true);
    expect(PROVIDER_FILE_CAPABILITIES.claude.subagentLifecycle).toBe('live');
    for (const p of ['codex', 'gemini'] as const) {
      expect(PROVIDER_FILE_CAPABILITIES[p].subagentAttribution).toBe(false);
      expect(PROVIDER_FILE_CAPABILITIES[p].subagentLifecycle).toBe('collected');
    }
  });

  it('accepts SUB_AGENT_DONE in the event schema', () => {
    const validEvent = {
      eventId: 'evt_001',
      competitionId: 'comp_001',
      teamId: 'team-a',
      timestamp: new Date().toISOString(),
      type: 'SUB_AGENT_DONE',
      payload: {},
      metadata: {},
    };
    expect(arenaEventSchema.safeParse(validEvent).success).toBe(true);
  });
});
