import { describe, it, expect } from 'vitest';
import { normalizeLine } from './claude-normalizer.js';
import { EventType } from '@arena/shared';

const BASE = { competitionId: 'comp-1', teamId: 'team-a' };

/** Helper: wrap a content block in the real stream-json assistant envelope. */
function assistantMsg(content: unknown[]) {
  return JSON.stringify({
    type: 'assistant',
    message: { content },
  });
}

describe('normalizeLine()', () => {
  // ── stream-json format (real Claude Code output) ──────────────────────

  it('maps an assistant tool_use block to TOOL_CALL', () => {
    const raw = assistantMsg([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]);
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.TOOL_CALL);
    expect((event.payload as { tool: string }).tool).toBe('Bash');
  });

  it('maps an assistant Write tool_use to FILE_CREATE', () => {
    const raw = assistantMsg([{ type: 'tool_use', name: 'Write', input: { file_path: '/tmp/foo.ts', content: '...' } }]);
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.FILE_CREATE);
    expect((event.payload as { text: string }).text).toBe('/tmp/foo.ts');
  });

  // AA-064: an Edit is a MODIFY. This test previously asserted FILE_CREATE, which
  // is why the UI's edit badge counted zero for four months.
  it('maps an assistant Edit tool_use to FILE_MODIFY, with a tool-derived operation', () => {
    const raw = assistantMsg([{ type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/bar.py' } }]);
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.FILE_MODIFY);
    const p = event.payload as Record<string, unknown>;
    expect(p.op).toBe('modify');
    expect(p.opSource).toBe('tool');
    expect(p.path).toBe('/tmp/bar.py');
    expect(p.tool).toBe('Edit');
    expect(p.text).toBe('/tmp/bar.py');   // backwards compatibility
  });

  it('maps an assistant Write tool_use to FILE_CREATE', () => {
    const raw = assistantMsg([{ type: 'tool_use', name: 'Write', input: { file_path: '/tmp/new.py' } }]);
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.FILE_CREATE);
    const p = event.payload as Record<string, unknown>;
    expect(p.op).toBe('create');
    expect(p.opSource).toBe('tool');
    expect(p.path).toBe('/tmp/new.py');
  });

  it('maps an assistant text block to REASONING', () => {
    const raw = assistantMsg([{ type: 'text', text: 'I will now analyse the problem.' }]);
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.REASONING);
  });

  it('maps an assistant text block with file path to FILE_CREATE', () => {
    const raw = assistantMsg([{ type: 'text', text: 'Created file /workspace/solution.ts' }]);
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.FILE_CREATE);
  });

  it('maps an assistant thinking block to REASONING', () => {
    const raw = assistantMsg([{ type: 'thinking', thinking: 'Let me consider the options...' }]);
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.REASONING);
    expect((event.payload as { text: string }).text).toBe('Let me consider the options...');
  });

  it('uses the last content block from an assistant message', () => {
    const raw = assistantMsg([
      { type: 'text', text: 'earlier text' },
      { type: 'tool_use', name: 'Grep', input: { pattern: 'foo' } },
    ]);
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.TOOL_CALL);
    expect((event.payload as { tool: string }).tool).toBe('Grep');
  });

  // ── Legacy format (backward compatibility) ────────────────────────────

  it('maps a legacy tool_use line to TOOL_CALL', () => {
    const raw = JSON.stringify({ type: 'tool_use', name: 'bash', input: { command: 'ls' } });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.TOOL_CALL);
  });

  it('maps a legacy text line to REASONING', () => {
    const raw = JSON.stringify({ type: 'text', text: 'Hello' });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.REASONING);
  });

  it('maps an error line to ERROR', () => {
    const raw = JSON.stringify({ type: 'error', error: { message: 'rate limit hit' } });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.ERROR);
  });

  // ── Suppressed types ──────────────────────────────────────────────────

  it('maps system events to REASONING (suppressed noise)', () => {
    const raw = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.REASONING);
  });

  it('maps user events to REASONING', () => {
    const raw = JSON.stringify({ type: 'user', message: { role: 'user', content: [] } });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.REASONING);
  });

  // ── General ───────────────────────────────────────────────────────────

  it('returns an event with a valid ISO timestamp', () => {
    const raw = assistantMsg([{ type: 'text', text: 'Thinking…' }]);
    const event = normalizeLine(raw, BASE);
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  it('returns an event with the supplied competitionId and teamId', () => {
    const raw = assistantMsg([{ type: 'text', text: 'Hello' }]);
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
