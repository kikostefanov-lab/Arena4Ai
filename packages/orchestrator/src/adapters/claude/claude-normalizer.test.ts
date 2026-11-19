import { describe, it, expect } from 'vitest';
import { ClaudeNormalizer, normalizeLine } from './claude-normalizer.js';
import { loadFixture } from '../__fixtures__/load.js';
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


describe('ClaudeNormalizer squad events', () => {
  const run = (name: string) => {
    const n = new ClaudeNormalizer(BASE);
    return loadFixture(name).flatMap((l) => n.addLine(l));
  };
  const ofType = (evs: ReturnType<typeof run>, t: EventType) => evs.filter((e) => e.type === t);

  it('claude-parallel: two spawns, two completed dones, files attributed', () => {
    const evs = run('claude-parallel');
    const spawns = ofType(evs, EventType.SUB_AGENT_SPAWN);
    const dones = ofType(evs, EventType.SUB_AGENT_DONE);
    expect(spawns).toHaveLength(2);
    expect(dones).toHaveLength(2);
    const ids = spawns.map((e) => (e.payload as { agentId: string }).agentId);
    expect(new Set(ids).size).toBe(2);
    expect(dones.map((e) => (e.payload as { status: string }).status)).toEqual(['completed', 'completed']);
    expect(spawns[0].payload).toMatchObject({ kind: 'general-purpose', background: false, depth: 1 });
    expect(dones.every((e) => (e.payload as { model?: string }).model === 'claude-haiku-5-5')).toBe(true);
    const files = ofType(evs, EventType.FILE_CREATE);
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) expect(ids).toContain(f.metadata.agentId);
    const lead = evs.filter((e) => e.metadata.agentId === undefined);
    expect(lead.some((e) => e.type === EventType.FILE_CREATE)).toBe(false);
  });

  it('merges task_notification into an earlier task_updated DONE (usage-first order)', () => {
    const n = new ClaudeNormalizer(BASE);
    const started = { type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: 'u1', description: 'd', task_type: 'local_agent' };
    const note = { type: 'system', subtype: 'task_notification', task_id: 't1', status: 'completed', summary: 'ok', usage: { total_tokens: 5, tool_uses: 2, duration_ms: 9 } };
    n.addLine(JSON.stringify(started));
    const first = n.addLine(JSON.stringify(note));
    expect(first).toHaveLength(1);
    expect(first[0].payload).toMatchObject({ agentId: 't1', status: 'completed', summary: 'ok', usage: { tokens: 5, toolUses: 2, durationMs: 9 } });
    const upd = n.addLine(JSON.stringify({ type: 'system', subtype: 'task_updated', task_id: 't1', patch: { status: 'completed' } }));
    expect(upd.filter((e) => e.type === EventType.SUB_AGENT_DONE)).toHaveLength(0);
  });

  it('ignores DONE for an unknown task id', () => {
    const n = new ClaudeNormalizer(BASE);
    const evs = n.addLine(JSON.stringify({ type: 'system', subtype: 'task_updated', task_id: 'nope', patch: { status: 'completed' } }));
    expect(evs.some((e) => e.type === EventType.SUB_AGENT_DONE)).toBe(false);
  });

  it('claude-background-bash: local_bash tasks make no spawn/done and result lines do not throw', () => {
    const evs = run('claude-background-bash');
    const ids = [...ofType(evs, EventType.SUB_AGENT_SPAWN), ...ofType(evs, EventType.SUB_AGENT_DONE)].map(
      (e) => (e.payload as { agentId: string }).agentId,
    );
    // only the local_agent member (spawn + done); the nested local_bash task is ignored
    expect(ids).toEqual(['afd0784724d161c13', 'afd0784724d161c13']);
    expect(ids).not.toContain('bbv53n6u2');
  });

  it('claude-concurrency-refused: one spawn, refused call stays a TOOL_CALL', () => {
    const evs = run('claude-concurrency-refused');
    expect(ofType(evs, EventType.SUB_AGENT_SPAWN)).toHaveLength(1);
    expect(ofType(evs, EventType.TOOL_CALL).some((e) => (e.payload as { tool: string }).tool === 'Agent')).toBe(true);
  });
});
