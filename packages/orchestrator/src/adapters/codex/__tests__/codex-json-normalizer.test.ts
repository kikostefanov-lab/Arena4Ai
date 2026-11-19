import { describe, it, expect } from 'vitest';
import { EventType, type ArenaEvent } from '@arena/shared';
import { CodexJsonNormalizer, codexSubAgentStatus } from '../codex-json-normalizer.js';
import { codexArgs } from '../codex-adapter.js';
import { loadFixture } from '../../__fixtures__/load.js';

const BASE = { competitionId: 'c', teamId: 't' };

function run(fixture: string): ArenaEvent[] {
  const n = new CodexJsonNormalizer(BASE);
  return loadFixture(fixture).flatMap((l) => n.addLine(l));
}
const ofType = (evs: ArenaEvent[], t: EventType) => evs.filter((e) => e.type === t);
const p = (e: ArenaEvent) => e.payload as Record<string, unknown>;

describe('CodexJsonNormalizer', () => {
  it('codex-work: one file event per change, relative paths, marker source', () => {
    const evs = run('codex-work');
    const files = evs.filter((e) => e.type === EventType.FILE_CREATE || e.type === EventType.FILE_MODIFY);
    expect(files.map((e) => [e.type, p(e).path, p(e).opSource])).toEqual([
      [EventType.FILE_CREATE, 'hello.py', 'marker'],
      [EventType.FILE_MODIFY, 'hello.py', 'marker'],
      [EventType.FILE_CREATE, 'notes.txt', 'marker'],
    ]);
  });

  it('codex-work: commands are TOOL_CALLs, failures carry exitCode 1; started lines are silent', () => {
    const evs = run('codex-work');
    const tools = ofType(evs, EventType.TOOL_CALL);
    expect(tools).toHaveLength(2);
    expect(p(tools[0])).toMatchObject({ tool: 'exec', exitCode: 0, status: 'completed' });
    expect(p(tools[1])).toMatchObject({ tool: 'exec', exitCode: 1, status: 'failed' });
    expect(p(tools[1]).input).toEqual({ command: "/bin/zsh -lc 'ls /nonexistent'" });
    const n = new CodexJsonNormalizer(BASE);
    for (const l of loadFixture('codex-work').filter((x) => x.includes('item.started'))) {
      expect(n.addLine(l)).toEqual([]);
    }
    expect(ofType(evs, EventType.REASONING).length).toBeGreaterThan(0);
  });

  it('codex-v1-spawn-wait: 2 SPAWN and 2 DONE completed with matching ids', () => {
    const evs = run('codex-v1-spawn-wait');
    const spawns = ofType(evs, EventType.SUB_AGENT_SPAWN);
    const dones = ofType(evs, EventType.SUB_AGENT_DONE);
    expect(spawns).toHaveLength(2);
    expect(dones).toHaveLength(2);
    expect(p(spawns[0]).depth).toBe(1);
    expect(typeof p(spawns[0]).label).toBe('string');
    expect(dones.map((e) => p(e).status)).toEqual(['completed', 'completed']);
    expect(new Set(dones.map((e) => p(e).agentId))).toEqual(new Set(spawns.map((e) => p(e).agentId)));
  });

  it('codex-cap-close: failed spawns yield no SPAWN; close_agent closes', () => {
    const evs = run('codex-cap-close');
    expect(ofType(evs, EventType.SUB_AGENT_SPAWN)).toHaveLength(3);
    expect(ofType(evs, EventType.SUB_AGENT_DONE)).toHaveLength(3);
    const refusals = ofType(evs, EventType.REASONING).filter((e) => String(p(e).text).includes('concurrency cap'));
    expect(refusals.length).toBeGreaterThan(0);
  });

  it('codex-web-search: TOOL_CALL web_search with the query', () => {
    const tools = ofType(run('codex-web-search'), EventType.TOOL_CALL);
    expect(tools).toHaveLength(1);
    expect(p(tools[0]).tool).toBe('web_search');
    expect(p(tools[0]).input).toEqual({ query: 'Delaware bid solicitation GSS26612 janitorial title' });
  });

  it('an unidentified wait is flagged when no children are known', () => {
    const n = new CodexJsonNormalizer(BASE);
    const evs = n.addLine(JSON.stringify({
      type: 'item.completed',
      item: { id: 'i', type: 'collab_tool_call', tool: 'wait', receiver_thread_ids: [], agents_states: {}, status: 'completed' },
    }));
    expect(evs).toHaveLength(1);
    expect(p(evs[0])).toMatchObject({ squadUnidentified: true });
  });

  it('ignores thread/turn lines, unknown items and non-JSON', () => {
    const n = new CodexJsonNormalizer(BASE);
    expect(n.addLine('{"type":"thread.started","thread_id":"x"}')).toEqual([]);
    expect(n.addLine('{"type":"turn.completed"}')).toEqual([]);
    expect(n.addLine('{"type":"item.completed","item":{"type":"mystery"}}')).toEqual([]);
    expect(n.addLine('not json')).toEqual([]);
  });

  it('error items become ERROR events', () => {
    const n = new CodexJsonNormalizer(BASE);
    const evs = n.addLine('{"type":"item.completed","item":{"id":"e","type":"error","message":"boom"}}');
    expect(evs[0].type).toBe(EventType.ERROR);
  });
});

describe('CodexJsonNormalizer failures and edge cases', () => {
  const line = (o: unknown) => JSON.stringify(o);

  it('a top-level error line becomes an ERROR event with the message', () => {
    const n = new CodexJsonNormalizer(BASE);
    const evs = n.addLine(line({ type: 'error', message: 'stream disconnected: model not found' }));
    expect(evs).toHaveLength(1);
    expect(evs[0].type).toBe(EventType.ERROR);
    expect(p(evs[0]).error).toBe('stream disconnected: model not found');
  });

  it('turn.failed becomes an ERROR event reading error.message', () => {
    const n = new CodexJsonNormalizer(BASE);
    const evs = n.addLine(line({ type: 'turn.failed', error: { message: 'usage limit reached' } }));
    expect(evs.map((e) => e.type)).toEqual([EventType.ERROR]);
    expect(p(evs[0]).error).toBe('usage limit reached');
  });

  it('error items accept message or error.message', () => {
    const n = new CodexJsonNormalizer(BASE);
    const a = n.addLine(line({ type: 'item.completed', item: { type: 'error', message: 'boom' } }));
    const b = n.addLine(line({ type: 'item.completed', item: { type: 'error', error: { message: 'bang' } } }));
    expect(p(a[0]).error).toBe('boom');
    expect(p(b[0]).error).toBe('bang');
  });

  it('maps codex sub-agent states: only error-like states fail', () => {
    expect(codexSubAgentStatus('completed')).toBe('completed');
    for (const s of ['errored', 'failed', 'error']) expect(codexSubAgentStatus(s)).toBe('failed');
    for (const s of ['shutdown', 'interrupted', 'closed', 'cancelled', 'canceled']) expect(codexSubAgentStatus(s)).toBe('killed');
    for (const s of ['not_found', '', 'mystery']) expect(codexSubAgentStatus(s)).toBe('unknown');
  });

  const spawn = (id: string) => line({
    type: 'item.completed',
    item: { type: 'collab_tool_call', tool: 'spawn_agent', receiver_thread_ids: [id], prompt: 'write a.txt', status: 'completed' },
  });

  it('a wait reporting shutdown is killed, not failed', () => {
    const n = new CodexJsonNormalizer(BASE);
    n.addLine(spawn('k1'));
    const evs = n.addLine(line({
      type: 'item.completed',
      item: { type: 'collab_tool_call', tool: 'wait', receiver_thread_ids: ['k1'], agents_states: { k1: { status: 'shutdown' } }, status: 'completed' },
    }));
    expect(evs.map((e) => [e.type, p(e).status])).toEqual([[EventType.SUB_AGENT_DONE, 'killed']]);
  });

  it('a lead closing a still-running helper shows it killed, not failed', () => {
    const n = new CodexJsonNormalizer(BASE);
    n.addLine(spawn('r1'));
    n.addLine(spawn('r2'));
    const evs = n.addLine(line({
      type: 'item.completed',
      item: {
        type: 'collab_tool_call', tool: 'close_agent', receiver_thread_ids: ['r1', 'r2'],
        agents_states: { r1: { status: 'running' } }, status: 'completed',
      },
    }));
    expect(evs.map((e) => [p(e).agentId, p(e).status])).toEqual([['r1', 'killed'], ['r2', 'killed']]);
  });

  it('file_change: a delete emits nothing and a null change is skipped, not thrown', () => {
    const n = new CodexJsonNormalizer(BASE);
    const evs = n.addLine(line({
      type: 'item.completed',
      item: { type: 'file_change', changes: [null, { path: '/tmp/arena-t-x/gone.txt', kind: 'delete' }, { path: '/tmp/arena-t-x/new.txt', kind: 'add' }] },
    }));
    expect(evs.map((e) => [e.type, p(e).path])).toEqual([[EventType.FILE_CREATE, 'new.txt']]);
  });
});

describe('codexArgs', () => {
  it('returns the exact argument list', () => {
    expect(codexArgs('p', undefined, {})).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write',
      '--ignore-user-config',
      '-c', 'features.multi_agent_v2=false',
      '-c', 'sandbox_workspace_write.network_access=true',
      '-c', 'web_search=live',
      '-c', 'agents.max_concurrent_threads_per_session=6',
      'p',
    ]);
  });

  it('honours the squad cap and puts -m before the prompt', () => {
    const args = codexArgs('p', 'm1', { ARENA_SQUAD_MAX_CONCURRENT: '2' });
    expect(args).toContain('agents.max_concurrent_threads_per_session=2');
    expect(args.slice(-3)).toEqual(['-m', 'm1', 'p']);
  });
});
