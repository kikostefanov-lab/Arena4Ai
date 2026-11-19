import { describe, it, expect } from 'vitest';
import { normalizeLine } from '../gemini-normalizer.js';
import { EventType } from '@arena/shared';
import { loadFixture } from '../../__fixtures__/load.js';

const BASE = { competitionId: 'comp-2', teamId: 'team-c' };

// ── Squad events: invoke_agent is a sub-agent, not a tool call ───────────────
describe('gemini invoke_agent squad events', () => {
  const lines = loadFixture('gemini-invoke-agent');
  const events = lines.map((line) => normalizeLine(line, BASE));
  const spawns = events.filter((e) => e.type === EventType.SUB_AGENT_SPAWN);
  const dones = events.filter((e) => e.type === EventType.SUB_AGENT_DONE);

  it('turns each invoke_agent tool_use into a SUB_AGENT_SPAWN', () => {
    expect(spawns).toHaveLength(2);
    const [first, second] = spawns.map((e) => e.payload as Record<string, unknown>);
    expect(first).toEqual({
      agentId: 'invoke_agent__call_12019812510393406164',
      label: 'Write a file…',
      description: 'Write a file named a.txt containing exactly the text \'a\'.',
      kind: 'generalist',
      depth: 1,
    });
    expect(second.agentId).toBe('invoke_agent__call_12019812510393406087');
    expect(second.kind).toBe('generalist');
  });

  it('turns each invoke_agent tool_result into a SUB_AGENT_DONE completed', () => {
    expect(dones).toHaveLength(2);
    expect(dones.map((e) => e.payload)).toEqual([
      { agentId: 'invoke_agent__call_12019812510393406164', status: 'completed' },
      { agentId: 'invoke_agent__call_12019812510393406087', status: 'completed' },
    ]);
  });

  it('keeps update_topic as a TOOL_CALL', () => {
    const topic = events.find(
      (e) => e.type === EventType.TOOL_CALL && (e.payload as { tool?: string }).tool === 'update_topic',
    );
    expect(topic).toBeDefined();
  });

  it('maps a failed invoke_agent result to SUB_AGENT_DONE failed', () => {
    const raw = JSON.stringify({
      type: 'tool_result', tool_id: 'invoke_agent__call_9', status: 'error', error: { message: 'boom' },
    });
    const ev = normalizeLine(raw, BASE);
    expect(ev.type).toBe(EventType.SUB_AGENT_DONE);
    expect(ev.payload).toEqual({ agentId: 'invoke_agent__call_9', status: 'failed' });
  });
});

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

  // AA-037: these two previously asserted `{type:'tool_use', name, input}` and
  // `{type:'function_call', …}`. Neither is a shape gemini emits — `function_call`
  // is not even in JsonStreamEventType (init|message|tool_use|tool_result|error|
  // result), and tool events carry `tool_name`/`parameters`. They pinned an
  // imagined contract, so they are rewritten against the real one, verified in
  // gemini-cli 0.38.2.
  it('maps a stream-json tool_use line to TOOL_CALL', () => {
    const raw = JSON.stringify({
      type: 'tool_use', tool_name: 'run_shell_command', tool_id: 't1',
      parameters: { command: 'npm test' },
    });
    const event = normalizeLine(raw, BASE);
    expect(event.type).toBe(EventType.TOOL_CALL);
    expect((event.payload as { tool: string }).tool).toBe('run_shell_command');
  });

  it('maps a non-file stream-json tool_use to TOOL_CALL with its parameters', () => {
    const raw = JSON.stringify({
      type: 'tool_use', tool_name: 'read_file', tool_id: 't2',
      parameters: { file_path: 'main.ts' },
    });
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

// ── AA-037: structured stream-json file telemetry ────────────────────────────
describe('gemini stream-json file events', () => {
  const toolUse = (tool_name: string, parameters: Record<string, unknown>) =>
    normalizeLine(JSON.stringify({ type: 'tool_use', tool_name, tool_id: 'x', parameters }), BASE);

  it('write_file is a CREATE, tool-derived', () => {
    const ev = toolUse('write_file', { file_path: '/var/f/arena-team-c-Q/main.py', content: 'x' });
    expect(ev.type).toBe(EventType.FILE_CREATE);
    const p = ev.payload as Record<string, unknown>;
    expect(p.op).toBe('create');
    expect(p.opSource).toBe('tool');          // no longer parsed from prose
    expect(p.path).toBe('main.py');           // workdir-relative, like the others
    expect(p.tool).toBe('write_file');
    expect(p.input).toBeDefined();
  });

  it('replace is a MODIFY — the edit-count signal', () => {
    const ev = toolUse('replace', { file_path: '/var/f/arena-team-c-Q/main.py', old_string: 'a', new_string: 'b' });
    expect(ev.type).toBe(EventType.FILE_MODIFY);
    const p = ev.payload as Record<string, unknown>;
    expect(p.op).toBe('modify');
    expect(p.opSource).toBe('tool');
  });

  it('replace with an EMPTY old_string is a create, not a modify', () => {
    // gemini-cli 0.38.2: isNewFile = params.old_string === "" && !fileExists.
    // Reading the parameter beats mapping the tool name alone.
    const ev = toolUse('replace', { file_path: 'fresh.py', old_string: '', new_string: 'x' });
    expect(ev.type).toBe(EventType.FILE_CREATE);
    expect((ev.payload as Record<string, unknown>).op).toBe('create');
  });

  it('routes the other stream-json event types', () => {
    expect(normalizeLine(JSON.stringify({ type: 'error', severity: 'fatal', message: 'boom' }), BASE).type)
      .toBe(EventType.ERROR);
    expect(normalizeLine(JSON.stringify({ type: 'tool_result', tool_id: 'x', status: 'error', error: { message: 'no' } }), BASE).type)
      .toBe(EventType.ERROR);
    expect(normalizeLine(JSON.stringify({ type: 'message', role: 'assistant', content: 'thinking' }), BASE).type)
      .toBe(EventType.REASONING);
    expect(normalizeLine(JSON.stringify({ type: 'init', session_id: 's', model: 'm' }), BASE).type)
      .toBe(EventType.REASONING);
  });

  it('falls back to prose for a non-stream-json line (older gemini CLI)', () => {
    // Selected by content, not configuration: anything that is not a stream-json
    // event still parses, and is tagged 'verb' so it is not mistaken for a fact.
    const ev = normalizeLine('Modified legacy.py with the fix', BASE);
    expect(ev.type).toBe(EventType.FILE_MODIFY);
    expect((ev.payload as Record<string, unknown>).opSource).toBe('verb');
  });
});

describe('gemini malformed stream lines', () => {
  it('a non-string tool_id or file path does not throw', () => {
    expect(() => normalizeLine('{"type":"tool_result","tool_id":42,"status":"success","output":"ok"}', BASE)).not.toThrow();
    const ev = normalizeLine('{"type":"tool_use","tool_name":"write_file","tool_id":7,"parameters":{"file_path":9}}', BASE);
    expect(ev.type).toBe(EventType.FILE_CREATE);
  });
});
