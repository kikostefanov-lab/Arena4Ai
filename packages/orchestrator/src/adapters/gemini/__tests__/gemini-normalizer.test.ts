import { describe, it, expect } from 'vitest';
import { normalizeLine } from '../gemini-normalizer.js';
import { EventType } from '@arena/shared';

const BASE = { competitionId: 'comp-2', teamId: 'team-c' };

describe('gemini normalizeLine()', () => {
  it('maps a plain-text file creation line to FILE_CREATE', () => {
    const event = normalizeLine('Created file /workspace/solution.ts', BASE);
    expect(event.type).toBe(EventType.FILE_CREATE);
  });

  // AA-064: "Modified" is the only create-vs-modify signal gemini gives us, so it
  // must produce FILE_MODIFY. This previously asserted FILE_CREATE.
  it('maps a "modified" file line to FILE_MODIFY, with a verb-derived operation', () => {
    const event = normalizeLine('Modified main.py with the fix', BASE);
    expect(event.type).toBe(EventType.FILE_MODIFY);
    const p = event.payload as Record<string, unknown>;
    expect(p.op).toBe('modify');
    expect(p.opSource).toBe('verb');      // heuristic, and labelled as such
    expect(p.path).toBe('main.py');       // structured path, not just prose
    expect(p.tool).toBeUndefined();       // absent, never "unknown"
  });

  it('maps a "created" file line to FILE_CREATE', () => {
    const event = normalizeLine('Created solution.py for the task', BASE);
    expect(event.type).toBe(EventType.FILE_CREATE);
    expect((event.payload as Record<string, unknown>).op).toBe('create');
  });

  it('maps a plain reasoning line to REASONING', () => {
    const event = normalizeLine('I will now analyse the problem and write a solution.', BASE);
    expect(event.type).toBe(EventType.REASONING);
  });

  it('maps a line starting with "Error:" to ERROR', () => {
    const event = normalizeLine('Error: API key not found', BASE);
    expect(event.type).toBe(EventType.ERROR);
  });

  it('maps a line starting with "fatal " (case-insensitive) to ERROR', () => {
    const event = normalizeLine('fatal: out of memory', BASE);
    expect(event.type).toBe(EventType.ERROR);
  });

  it('maps a JSON error line to ERROR', () => {
    const raw = JSON.stringify({ type: 'error', error: { message: 'model overloaded' } });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.ERROR);
  });

  it('maps a JSON tool_use line to TOOL_CALL', () => {
    const raw = JSON.stringify({ type: 'tool_use', name: 'bash', input: { command: 'npm test' } });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.TOOL_CALL);
    expect((event.payload as { tool: string }).tool).toBe('bash');
  });

  it('maps a JSON function_call line to TOOL_CALL', () => {
    const raw = JSON.stringify({ type: 'function_call', name: 'read_file', input: { path: 'main.ts' } });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.TOOL_CALL);
    expect((event.payload as { tool: string }).tool).toBe('read_file');
  });

  it('maps a JSON text line without a file path to REASONING', () => {
    const raw = JSON.stringify({ text: 'Thinking about the problem.' });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.REASONING);
  });

  it('maps a JSON text line with a file path to FILE_CREATE', () => {
    const raw = JSON.stringify({ text: 'Writing solution.py to disk.' });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.FILE_CREATE);
  });

  it('handles JSON with a "content" field', () => {
    const raw = JSON.stringify({ content: 'Analysing the input data.' });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.REASONING);
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
    expect(event.competitionId).toBe('comp-2');
    expect(event.teamId).toBe('team-c');
  });

  it('returns an event with a non-empty eventId', () => {
    const event = normalizeLine('Hello world', BASE);
    expect(event.eventId).toBeTruthy();
  });
});
