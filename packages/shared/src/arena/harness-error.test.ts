import { describe, it, expect } from 'vitest';
import { isHarnessError, toFrameEvent } from './index.js';
import { EventType } from '../constants/event-types.js';
import type { ArenaEvent } from '../types/event.js';

const T0 = Date.parse('2026-11-19T14:18:49.218Z');
const err = (payload: unknown): ArenaEvent => ({
  eventId: 'e1', competitionId: 'c', teamId: 'team-a', type: EventType.ERROR,
  timestamp: new Date(T0 + 420_000).toISOString(), payload, metadata: {},
});

describe('isHarnessError', () => {
  it('flags errors raised by a harness stage', () => {
    for (const stage of ['judging', 'preflight', 'sandbox', 'presentation', 'synthesis', 'collect']) {
      expect(isHarnessError({ stage, error: 'x' })).toBe(true);
    }
  });

  it("keeps the agent's own errors", () => {
    expect(isHarnessError({ stage: 'agent', error: 'Claude exited with code 1' })).toBe(false);
    expect(isHarnessError({ error: 'no stage at all' })).toBe(false);
  });

  it('is safe on missing or malformed payloads', () => {
    expect(isHarnessError(undefined)).toBe(false);
    expect(isHarnessError(null)).toBe(false);
    expect(isHarnessError('judging')).toBe(false);
    expect(isHarnessError({ stage: 42 })).toBe(false);
  });

  it('agrees with how the arena classifies the event', () => {
    // The 7adcd4df shape: a recovered judge rate-limit filed under team-a.
    const judging = err({ stage: 'judging', recovered: true, provider: 'gemini', message: 'rate limited' });
    expect(isHarnessError(judging.payload)).toBe(true);
    expect(toFrameEvent(judging, T0).kind).toBe('other');

    const crash = err({ stage: 'agent', error: 'Claude exited with code 1' });
    expect(isHarnessError(crash.payload)).toBe(false);
    expect(toFrameEvent(crash, T0).kind).toBe('error');
  });
});
