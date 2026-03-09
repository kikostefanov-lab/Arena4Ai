import { describe, it, expect } from 'vitest';
import { normalizeLine } from '../codex-normalizer.js';
import { EventType } from '@arena/shared';

const BASE = { competitionId: 'comp-1', teamId: 'team-b' };

describe('codex normalizeLine()', () => {
  it('maps a plain-text file creation line to FILE_CREATE', () => {
    const event = normalizeLine('Created file /workspace/solution.ts', BASE);
    expect(event.type).toBe(EventType.FILE_CREATE);
  });

  it('maps a "wrote" file line to FILE_CREATE', () => {
    const event = normalizeLine('Wrote index.js with the implementation', BASE);
    expect(event.type).toBe(EventType.FILE_CREATE);
  });

  it('maps a plain reasoning line to REASONING', () => {
    const event = normalizeLine('I will now analyse the problem and write a solution.', BASE);
    expect(event.type).toBe(EventType.REASONING);
  });

  it('maps a line starting with "Error:" to ERROR', () => {
    const event = normalizeLine('Error: command not found', BASE);
    expect(event.type).toBe(EventType.ERROR);
  });

  it('maps a line starting with "error " (case-insensitive) to ERROR', () => {
    const event = normalizeLine('error rate limit exceeded', BASE);
    expect(event.type).toBe(EventType.ERROR);
  });

  it('maps a JSON error line to ERROR', () => {
    const raw = JSON.stringify({ type: 'error', error: { message: 'quota exceeded' } });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.ERROR);
  });

  it('maps a JSON tool_use line to TOOL_CALL', () => {
    const raw = JSON.stringify({ type: 'tool_use', tool: 'bash', input: { command: 'ls' } });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.TOOL_CALL);
    expect((event.payload as { tool: string }).tool).toBe('bash');
  });

  it('maps a JSON text line without a file path to REASONING', () => {
    const raw = JSON.stringify({ text: 'Thinking about the problem.' });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.REASONING);
  });

  it('maps a JSON text line with a file path to FILE_CREATE', () => {
    const raw = JSON.stringify({ text: 'Writing app.ts to the workspace.' });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.FILE_CREATE);
  });

  it('strips ANSI escape codes before classifying', () => {
    const event = normalizeLine('\x1b[32mCreated file output.js\x1b[0m', BASE);
    expect(event.type).toBe(EventType.FILE_CREATE);
  });

  it('returns an event with a valid ISO timestamp', () => {
    const event = normalizeLine('Some output line.', BASE);
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  it('returns an event with the supplied competitionId and teamId', () => {
    const event = normalizeLine('Hello world', BASE);
    expect(event.competitionId).toBe('comp-1');
    expect(event.teamId).toBe('team-b');
  });

  it('returns an event with a non-empty eventId', () => {
    const event = normalizeLine('Hello world', BASE);
    expect(event.eventId).toBeTruthy();
  });
});
