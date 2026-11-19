import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventType } from '@arena/shared';
import type { ArenaEvent } from '@arena/shared';
import { BaseAdapter } from '../base-adapter.js';
import { WorkdirWatcher, MAX_SCAN_FILES, MAX_SCAN_ENTRIES, MAX_SCAN_DEPTH } from '../workdir-watcher.js';
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

  it('start() emits on its own timer, and stop() ends it', () => {
    vi.useFakeTimers();
    try {
      const run = (stopIt: boolean) => {
        const seen: Array<{ path: string; op: string }> = [];
        const w = new WorkdirWatcher({ root, now: () => Date.now(), onFile: (f) => seen.push(f) });
        w.start();
        if (stopIt) w.stop();
        // Polls every 2 s (the spec value): first sighting at 2 s, out after the 5 s hold.
        vi.advanceTimersByTime(8000);
        w.stop();
        return seen;
      };
      writeFileSync(join(root, 'a.md'), 'x');
      expect(run(false)).toEqual([{ path: 'a.md', op: 'create' }]);
      expect(run(true)).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('polls every 2000 ms by default', () => {
    vi.useFakeTimers();
    try {
      const w = new WorkdirWatcher({ root, onFile: () => {} });
      const scan = vi.spyOn(w, 'scanOnce');
      w.start();
      vi.advanceTimersByTime(1999);
      expect(scan).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(scan).toHaveBeenCalledTimes(1);
      w.stop();
    } finally { vi.useRealTimers(); }
  });

  it('skips binary files, as collection does', () => {
    const { w, seen, at } = make();
    writeFileSync(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    writeFileSync(join(root, 'ok.md'), 'text');
    at.t = 0; w.scanOnce();
    at.t = 5000; w.flushDue();
    expect(seen).toEqual([{ path: 'ok.md', op: 'create' }]);
  });

  it('caps one scan at MAX_SCAN_FILES and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (let i = 0; i < MAX_SCAN_FILES + 3; i++) writeFileSync(join(root, `f${i}.txt`), 'x');
      const { w, seen, at } = make();
      at.t = 0; w.scanOnce(); w.scanOnce();
      at.t = 5000; w.flushDue();
      expect(seen).toHaveLength(MAX_SCAN_FILES);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });

  it('counts empty folders against the scan budget, so a folder flood cannot stall a scan', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A flood of empty folders holds no files, so the file cap alone never trips.
      for (let i = 0; i < MAX_SCAN_ENTRIES + 50; i++) mkdirSync(join(root, `d${i}`));
      const { w } = make();
      w.scanOnce(); w.scanOnce();
      // The entry budget, not the file cap, stopped the walk, and said so once.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('entries');
    } finally { warn.mockRestore(); }
  });

  it('stops descending past MAX_SCAN_DEPTH', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let dir = root;
      for (let i = 0; i < MAX_SCAN_DEPTH + 5; i++) { dir = join(dir, 'n'); mkdirSync(dir); }
      writeFileSync(join(dir, 'too-deep.md'), 'x');
      writeFileSync(join(root, 'top.md'), 'x');
      const { w, seen, at } = make();
      at.t = 0; w.scanOnce();
      at.t = 5000; w.flushDue();
      expect(seen.map((s) => s.path)).toEqual(['top.md']);
      expect(String(warn.mock.calls[0]![0])).toContain('deeper');
    } finally { warn.mockRestore(); }
  });

  it('finalFlush emits pending observations at once, and the stream still wins', () => {
    const { w, seen, at } = make();
    writeFileSync(join(root, 'early.md'), 'x');
    at.t = 0; w.scanOnce();
    writeFileSync(join(root, 'late.md'), 'x');
    writeFileSync(join(root, 'streamed.md'), 'x');
    at.t = 1000; w.noteStreamPath('streamed.md');
    at.t = 1500; w.finalFlush();
    expect(seen).toEqual([{ path: 'early.md', op: 'create' }, { path: 'late.md', op: 'create' }]);
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

  it('shutdown flushes files from the final seconds before collection, squad-tagged', async () => {
    const a = new TestAdapter('t1', root, 'c1');
    const evs: ArenaEvent[] = [];
    a.on('arenaEvent', (e: ArenaEvent) => evs.push(e));
    a.watch();
    a.emit2(spawn('helper'));
    writeFileSync(join(root, 'last-second.md'), 'x'); // never seen by a timed scan
    await a.shutdown();
    const kinds = evs.map((e) => e.type);
    const file = evs.find((e) => e.type === EventType.FILE_CREATE);
    expect(file?.payload).toMatchObject({ opSource: 'watch', path: 'last-second.md' });
    expect(file?.metadata.squad).toBe(true);
    // The file lands before the squad is closed for the deadline.
    expect(kinds.indexOf(EventType.FILE_CREATE)).toBeLessThan(kinds.indexOf(EventType.SUB_AGENT_DONE));
  });

  it('startWorkdirWatch is a no-op once shutdown has begun', async () => {
    const a = new TestAdapter('t1', root, 'c1');
    await a.shutdown();
    a.watch();
    expect(a.getWatcher()).toBeNull();
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
