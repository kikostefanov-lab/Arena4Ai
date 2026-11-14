/**
 * BaseAdapter.shutdown() must leave no agent process behind, and cleanupWorkdir()
 * must remove the host workdir even in sandbox mode. These tests use real local
 * processes (a POSIX `sh` script) — no agent CLI, Docker or database is needed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaseAdapter } from '../base-adapter.js';
import type { SandboxManager } from '../../sandbox/sandbox-manager.js';

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

/** Spawns `sh -c <script>` the way the real adapters spawn their CLI. */
class ScriptAdapter extends BaseAdapter {
  constructor(workdir: string, private readonly script: string, sandbox?: SandboxManager) {
    super('team-a', workdir, 'comp-1', sandbox);
  }
  async startExecution(): Promise<void> {
    this.executionDone = new Promise<void>((resolve) => {
      const child = spawn('sh', ['-c', this.script], {
        cwd: this.workdir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
      this.process = child;
      child.on('close', () => { this.process = null; resolve(); });
      child.on('error', () => { this.process = null; resolve(); });
    });
  }
  get pid(): number | undefined { return this.process?.pid; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForFile(path: string, ms = 3000): Promise<string> {
  const start = Date.now();
  for (;;) {
    try {
      const text = (await readFile(path, 'utf-8')).trim();
      if (text) return text;
    } catch { /* not yet */ }
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${path}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'arena-shutdown-test-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

posixOnly('BaseAdapter.shutdown', () => {
  it('kills an agent that ignores SIGTERM, and its child, before resolving', async () => {
    const dir = await tmp();
    // Ignores SIGTERM (the ignore is inherited by the sleeping grandchild too).
    const script = `trap '' TERM; sleep 60 & echo $! > gc.pid; echo $$ > self.pid; wait`;
    const adapter = new ScriptAdapter(dir, script);
    adapter.shutdownGraceMs = 100;
    await adapter.startExecution();
    const grandchild = Number(await waitForFile(join(dir, 'gc.pid')));
    const self = Number(await waitForFile(join(dir, 'self.pid')));
    expect(alive(self)).toBe(true);
    expect(alive(grandchild)).toBe(true);

    await adapter.shutdown();

    expect(alive(self)).toBe(false);
    expect(alive(grandchild)).toBe(false);
  });

  it('returns promptly, without waiting out the grace period, when SIGTERM is honoured', async () => {
    const dir = await tmp();
    const adapter = new ScriptAdapter(dir, `echo $$ > self.pid; sleep 60 & wait`);
    adapter.shutdownGraceMs = 5_000;
    await adapter.startExecution();
    const self = Number(await waitForFile(join(dir, 'self.pid')));

    const t0 = Date.now();
    await adapter.shutdown();

    expect(alive(self)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('is a no-op when nothing is running, and safe to call twice', async () => {
    const adapter = new ScriptAdapter(await tmp(), 'true');
    await adapter.shutdown();
    await adapter.startExecution();
    await adapter.done;
    await adapter.shutdown();
    await adapter.shutdown();
  });
});

describe('BaseAdapter.cleanupWorkdir', () => {
  it('removes the host workdir in sandbox mode too (the bind-mounted directory)', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'out.txt'), 'x');
    const sandbox = { killContainer: async () => {} } as unknown as SandboxManager;
    const adapter = new ScriptAdapter(dir, 'true', sandbox);

    await adapter.cleanupWorkdir();

    await expect(stat(dir)).rejects.toThrow();
  });

  it('removes the workdir without a sandbox', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'out.txt'), 'x');
    await new ScriptAdapter(dir, 'true').cleanupWorkdir();
    await expect(stat(dir)).rejects.toThrow();
  });
});
