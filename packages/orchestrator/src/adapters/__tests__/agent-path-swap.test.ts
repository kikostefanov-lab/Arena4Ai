/**
 * The race the path-safety fix exists for: the agent is still running while
 * the watcher scans, so it can swap a regular file for a symlink (or a FIFO)
 * AFTER the directory listing said "regular file" and BEFORE the read. A
 * stat()/open() that follows the path then reads outside the workdir, or
 * blocks forever. Here the swap is made deterministic by doing it inside the
 * directory listing call, so the walker sees the stale "regular file" entry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hooks = vi.hoisted(() => ({ afterList: null as null | (() => void) }));

function runSwapOnce(): void {
  const swap = hooks.afterList;
  hooks.afterList = null;
  swap?.();
}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: ((...args: Parameters<typeof actual.readdirSync>) => {
      const entries = actual.readdirSync(...args);
      runSwapOnce();
      return entries;
    }) as typeof actual.readdirSync,
  };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: (async (...args: Parameters<typeof actual.readdir>) => {
      const entries = await actual.readdir(...args);
      runSwapOnce();
      return entries;
    }) as typeof actual.readdir,
  };
});

import { BaseAdapter } from '../base-adapter.js';
import { WorkdirWatcher } from '../workdir-watcher.js';

class TestAdapter extends BaseAdapter {
  async startExecution(): Promise<void> {}
}

const posix = process.platform !== 'win32';

let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'arena-swap-'));
  root = join(base, 'workdir');
  mkdirSync(root);
  outside = join(base, 'operator-secret.txt');
  writeFileSync(outside, 'OPERATOR SECRET');
  writeFileSync(join(root, 'report.md'), '# real work');
  writeFileSync(join(root, 'swap.md'), 'innocent');
  // Listed as a regular file, then replaced by a link out of the workdir.
  hooks.afterList = () => {
    unlinkSync(join(root, 'swap.md'));
    symlinkSync(outside, join(root, 'swap.md'));
  };
});
afterEach(() => {
  hooks.afterList = null;
  rmSync(base, { recursive: true, force: true });
});

describe.skipIf(!posix)('a file swapped for a symlink after the listing', () => {
  it('is not collected', async () => {
    const d = await new TestAdapter('team-a', root, 'comp-1').collectDeliverables();
    expect(d.files.map((f) => f.path)).toEqual(['report.md']);
    expect(JSON.stringify(d)).not.toContain('OPERATOR SECRET');
  }, 2_000);

  it('is not emitted by the watcher', () => {
    const seen: string[] = [];
    const w = new WorkdirWatcher({ root, now: () => 0, onFile: (f) => seen.push(f.path) });
    w.scanOnce();
    w.finalFlush();
    expect(seen).toEqual(['report.md']);
  }, 2_000);
});
