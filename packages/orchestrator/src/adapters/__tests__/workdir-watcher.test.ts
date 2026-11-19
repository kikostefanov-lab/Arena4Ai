import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventType } from '@arena/shared';
import type { ArenaEvent } from '@arena/shared';
import { BaseAdapter } from '../base-adapter.js';
import { WorkdirWatcher } from '../workdir-watcher.js';
import { makeEvent, makeFileEvent } from '../normalizer-utils.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'arena-watch-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function make(): { w: WorkdirWatcher; seen: Array<{ path: string; op: string }>; at: { t: number } } {
  const seen: Array<{ path: string; op: string }> = [];
  const at = { t: 0 };
  const w = new WorkdirWatcher({ root, now: () => at.t, onFile: (f) => seen.push(f) });
  return { w, seen, at };
}

describe('WorkdirWatcher', () => {
  it('emits a create after the hold window', () => {
    const { w, seen, at } = make();
    writeFileSync(join(root, 'a.md'), 'x');
    at.t = 0; w.scanOnce();
    at.t = 4999; w.flushDue();
    expect(seen).toEqual([]);
    at.t = 5000; w.flushDue();
    expect(seen).toEqual([{ path: 'a.md', op: 'create' }]);
    at.t = 9000; w.flushDue();
    expect(seen).toHaveLength(1);
  });

  it('the stream wins inside the window', () => {
    const { w, seen, at } = make();
    writeFileSync(join(root, 'a.md'), 'x');
    at.t = 0; w.scanOnce();
    at.t = 3000; w.noteStreamPath('a.md');
    at.t = 6000; w.flushDue();
    expect(seen).toEqual([]);
  });

  it('the stream wins when it reported just before', () => {
    const { w, seen, at } = make();
    at.t = 0; w.noteStreamPath('a.md');
    writeFileSync(join(root, 'a.md'), 'x');
    at.t = 2000; w.scanOnce();
    at.t = 8000; w.flushDue();
    expect(seen).toEqual([]);
  });

  it('reports a later change as modify', () => {
    const { w, seen, at } = make();
    writeFileSync(join(root, 'a.md'), 'x');
    at.t = 0; w.scanOnce();
    at.t = 5000; w.flushDue();
    writeFileSync(join(root, 'a.md'), 'xyz');
    at.t = 6000; w.scanOnce();
    at.t = 11000; w.flushDue();
    expect(seen).toEqual([{ path: 'a.md', op: 'create' }, { path: 'a.md', op: 'modify' }]);
  });

  it('treats a stream-reported first sighting as the create', () => {
    const { w, seen, at } = make();
    at.t = 0; w.noteStreamPath('a.md');
    writeFileSync(join(root, 'a.md'), 'x');
    at.t = 20000; w.scanOnce();
    at.t = 30000; w.flushDue();
    expect(seen).toEqual([{ path: 'a.md', op: 'modify' }]);
  });

  it('skips node_modules, .git, dot-dirs and oversized files; reports nested paths relative', () => {
    const { w, seen, at } = make();
    for (const d of ['node_modules/x', '.git', '.hidden']) mkdirSync(join(root, d), { recursive: true });
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'node_modules/x/i.js'), 'x');
    writeFileSync(join(root, '.git/HEAD'), 'x');
    writeFileSync(join(root, '.hidden/f'), 'x');
    writeFileSync(join(root, 'big.txt'), Buffer.alloc(500 * 1024 + 1));
    writeFileSync(join(root, 'src/ok.ts'), 'x');
    at.t = 0; w.scanOnce();
    at.t = 5000; w.flushDue();
    expect(seen).toEqual([{ path: 'src/ok.ts', op: 'create' }]);
  });

  it('stop() ends the interval', () => {
    vi.useFakeTimers();
    try {
      const { w, seen } = make();
      writeFileSync(join(root, 'a.md'), 'x');
      w.start();
      w.stop();
      vi.advanceTimersByTime(20_000);
      expect(seen).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});

class TestAdapter extends BaseAdapter {
  async startExecution(): Promise<void> {}
  emit2(e: ArenaEvent) { this.emitArenaEvent(e); }
  watch() { this.startWorkdirWatch(); }
  file(f: { path: string; op: 'create' | 'modify' }) { this.onWatchedFile(f); }
  getWatcher() { return (this as unknown as { watcher: WorkdirWatcher | null }).watcher; }
}
const ctx = { competitionId: 'c1', teamId: 't1' };
const spawn = (agentId: string) =>
  makeEvent(EventType.SUB_AGENT_SPAWN, { agentId, label: agentId, description: agentId, depth: 1 }, ctx);
const done = (agentId: string) =>
  makeEvent(EventType.SUB_AGENT_DONE, { agentId, status: 'completed' }, ctx);

describe('BaseAdapter workdir watch', () => {
  it('marks watch files as squad while a sub-agent is open', () => {
    const a = new TestAdapter('t1', root, 'c1');
    const evs: ArenaEvent[] = [];
    a.on('arenaEvent', (e: ArenaEvent) => evs.push(e));
    a.watch();
    const w = a.getWatcher()!;
    a.emit2(spawn('a'));
    a.file({ path: 'a.md', op: 'create' });
    a.emit2(done('a'));
    a.file({ path: 'b.md', op: 'create' });
    const files = evs.filter((e) => e.type === EventType.FILE_CREATE);
    expect(files).toHaveLength(2);
    expect(files[0]!.payload).toMatchObject({ opSource: 'watch', path: 'a.md' });
    expect(files[0]!.metadata.squad).toBe(true);
    expect(files[1]!.metadata.squad).toBeUndefined();
    w.stop();
  });

  it('feeds stream file paths to the watcher', () => {
    const a = new TestAdapter('t1', root, 'c1');
    a.watch();
    const spy = vi.spyOn(a.getWatcher()!, 'noteStreamPath');
    a.emit2(makeFileEvent({ op: 'create', opSource: 'tool', path: 'x.md', text: 'x.md' }, ctx));
    expect(spy).toHaveBeenCalledWith('x.md');
    a.getWatcher()!.stop();
  });

  it('shutdown stops the watcher before collection', async () => {
    const a = new TestAdapter('t1', root, 'c1');
    a.watch();
    const spy = vi.spyOn(a.getWatcher()!, 'stop');
    await a.shutdown();
    expect(spy).toHaveBeenCalled();
  });

  it('is sealed after shutdown: a late SPAWN is dropped', async () => {
    const a = new TestAdapter('t1', root, 'c1');
    const evs: ArenaEvent[] = [];
    a.on('arenaEvent', (e: ArenaEvent) => evs.push(e));
    await a.shutdown();
    a.emit2(spawn('late'));
    expect(evs.filter((e) => e.type === EventType.SUB_AGENT_SPAWN)).toHaveLength(0);
    expect(a.openSubAgentCount).toBe(0);
  });
});
