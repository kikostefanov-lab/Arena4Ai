/**
 * A workdir is written by untrusted model code. A FIFO, a device or a symlink
 * planted there (or swapped in for a regular file between the directory
 * listing and the read) must never block the event loop or let collection read
 * outside the workdir. POSIX only: Windows has no mkfifo and no O_NOFOLLOW.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseAdapter } from '../base-adapter.js';
import { WorkdirWatcher } from '../workdir-watcher.js';
import { readRegularFile, readRegularFileSync } from '../safe-read.js';

class TestAdapter extends BaseAdapter {
  async startExecution(): Promise<void> {}
}

const posix = process.platform !== 'win32';
const FAST = 2_000;

let base: string;
let root: string;
let outside: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'arena-paths-'));
  root = join(base, 'workdir');
  mkdirSync(root);
  outside = join(base, 'operator-secret.txt');
  writeFileSync(outside, 'OPERATOR SECRET');
});
afterEach(() => { rmSync(base, { recursive: true, force: true }); });

/** The traps an agent can plant, plus one honest file. */
function plant(): void {
  writeFileSync(join(root, 'report.md'), '# real work');
  execFileSync('mkfifo', [join(root, 'pipe.md')]);
  symlinkSync(outside, join(root, 'leak.md'));
  symlinkSync('/dev/zero', join(root, 'zero.md'));
  symlinkSync(base, join(root, 'up')); // a directory link out of the workdir
}

describe.skipIf(!posix)('safe reads', () => {
  it('reads a regular file', async () => {
    writeFileSync(join(root, 'a.md'), 'hello');
    expect((await readRegularFile(join(root, 'a.md'), 1024))?.data.toString()).toBe('hello');
    expect(readRegularFileSync(join(root, 'a.md'), 1024)?.data.toString()).toBe('hello');
    expect(readRegularFileSync(join(root, 'a.md'), 1024, 2)?.data.toString()).toBe('he');
  });

  it('returns null for a FIFO without blocking', async () => {
    execFileSync('mkfifo', [join(root, 'p')]);
    expect(await readRegularFile(join(root, 'p'), 1024)).toBeNull();
    expect(readRegularFileSync(join(root, 'p'), 1024)).toBeNull();
  }, FAST);

  it('does not follow a symlink, to a file outside the workdir or to a device', async () => {
    symlinkSync(outside, join(root, 'leak'));
    symlinkSync('/dev/zero', join(root, 'zero'));
    for (const name of ['leak', 'zero']) {
      expect(await readRegularFile(join(root, name), 1024)).toBeNull();
      expect(readRegularFileSync(join(root, name), 1024)).toBeNull();
    }
  }, FAST);

  it('refuses a file over the cap, checked on the opened file', async () => {
    writeFileSync(join(root, 'big'), 'x'.repeat(100));
    expect(await readRegularFile(join(root, 'big'), 99)).toBeNull();
    expect(readRegularFileSync(join(root, 'big'), 99)).toBeNull();
  });
});

describe.skipIf(!posix)('collection of a trapped workdir', () => {
  it('collects the regular file only, without blocking or reading outside', async () => {
    plant();
    const a = new TestAdapter('team-a', root, 'comp-1');
    const d = await a.collectDeliverables(['report.md']);
    expect(d.files.map((f) => f.path)).toEqual(['report.md']);
    expect(d.files[0]!.content).toBe('# real work');
    expect(JSON.stringify(d)).not.toContain('OPERATOR SECRET');
  }, FAST);
});

describe.skipIf(!posix)('the workdir watcher on a trapped workdir', () => {
  it('emits the regular file only, without blocking', () => {
    plant();
    const seen: string[] = [];
    const w = new WorkdirWatcher({ root, now: () => 0, onFile: (f) => seen.push(f.path) });
    w.scanOnce();
    w.finalFlush();
    expect(seen).toEqual(['report.md']);
  }, FAST);
});
