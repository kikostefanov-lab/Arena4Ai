import { describe, it, expect } from 'vitest';
import { EventType, type ArenaEvent } from '@arena/shared';
import { CodexJsonNormalizer } from '../codex-json-normalizer.js';
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

describe('codexArgs', () => {
  it('returns the exact argument list', () => {
    expect(codexArgs('p', undefined, {})).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write',
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
