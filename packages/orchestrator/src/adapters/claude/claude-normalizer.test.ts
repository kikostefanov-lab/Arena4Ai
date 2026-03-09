import { describe, it, expect } from 'vitest';
import { normalizeLine } from './claude-normalizer.js';
import { EventType } from '@arena/shared';

const BASE = { competitionId: 'comp-1', teamId: 'team-a' };

describe('normalizeLine()', () => {
  it('maps a tool_use line to TOOL_CALL', () => {
    const raw = JSON.stringify({ type: 'tool_use', name: 'bash', input: { command: 'ls' } });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.TOOL_CALL);
    expect((event.payload as { tool: string }).tool).toBe('bash');
  });

  it('maps a text line containing a file path to FILE_CREATE', () => {
    const raw = JSON.stringify({ type: 'text', text: 'Created file /workspace/solution.ts' });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.FILE_CREATE);
  });

  it('maps a text line without a file path to REASONING', () => {
    const raw = JSON.stringify({ type: 'text', text: 'I will now analyse the problem.' });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.REASONING);
  });

  it('maps an error line to ERROR', () => {
    const raw = JSON.stringify({ type: 'error', error: { message: 'rate limit hit' } });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.ERROR);
  });

  it('returns an event with a valid ISO timestamp', () => {
    const raw = JSON.stringify({ type: 'text', text: 'Thinking…' });
    const event = normalizeLine(raw, BASE);
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  it('returns an event with the supplied competitionId and teamId', () => {
    const raw = JSON.stringify({ type: 'text', text: 'Hello' });
    const event = normalizeLine(raw, BASE);
    expect(event.competitionId).toBe('comp-1');
    expect(event.teamId).toBe('team-a');
  });

  it('falls back to REASONING for unknown message types', () => {
    const raw = JSON.stringify({ type: 'ping', data: {} });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.REASONING);
  });

  it('handles malformed JSON gracefully by returning an ERROR event', () => {
    const event = normalizeLine('not-json{{', BASE);
    expect(event.type).toBe(EventType.ERROR);
  });
});
