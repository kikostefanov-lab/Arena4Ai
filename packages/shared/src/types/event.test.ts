import { describe, it, expect } from 'vitest';
import { EventType } from '../constants/event-types.js';
import type { ArenaEvent } from './event.js';

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
});
