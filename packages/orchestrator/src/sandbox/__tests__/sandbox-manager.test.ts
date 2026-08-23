import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: null; stderr: null };
  child.stdout = null;
  child.stderr = null;
  return child;
}

/** Load a fresh SandboxManager so module-level env reads are re-evaluated. */
async function freshManager() {
  vi.resetModules();
  const { SandboxManager } = await import('../sandbox-manager.js');
  return new SandboxManager();
}

/** Pull the `docker run` argv out of the last spawn call. */
function lastDockerArgs(): string[] {
  const call = spawnMock.mock.calls.at(-1);
  expect(call?.[0]).toBe('docker');
  return call![1] as string[];
}

/** Collect the -e KEY=VALUE pairs from a docker argv. */
function envPairs(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '-e') {
      const eq = args[i + 1]!.indexOf('=');
      out[args[i + 1]!.slice(0, eq)] = args[i + 1]!.slice(eq + 1);
    }
  }
  return out;
}

describe('SandboxManager.spawnInContainer', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeChild());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to bridge networking, not host', async () => {
    const mgr = await freshManager();
    mgr.spawnInContainer('team-a', '/tmp/wd', 'claude', ['--print'], {});
    const args = lastDockerArgs();
    expect(args).toContain('--network');
    expect(args[args.indexOf('--network') + 1]).toBe('bridge');
    expect(args).not.toContain('host');
  });

  it('honours ARENA_SANDBOX_NETWORK for the local-model escape hatch', async () => {
    vi.stubEnv('ARENA_SANDBOX_NETWORK', 'host');
    const mgr = await freshManager();
    mgr.spawnInContainer('team-a', '/tmp/wd', 'claude', [], {});
    const args = lastDockerArgs();
    expect(args[args.indexOf('--network') + 1]).toBe('host');
  });

  it('does not hand the operator\'s secrets to the container', async () => {
    const mgr = await freshManager();
    mgr.spawnInContainer('team-a', '/tmp/wd', 'claude', [], {
      DATABASE_URL: 'postgresql://localhost/arena',
      ARENA_API_KEY: 'sk-arena-secret',
      GITHUB_TOKEN: 'ghp_x',
      ANTHROPIC_API_KEY: 'sk-ant',
    });
    const env = envPairs(lastDockerArgs());
    expect(env['DATABASE_URL']).toBeUndefined();
    expect(env['ARENA_API_KEY']).toBeUndefined();
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    expect(env['ANTHROPIC_API_KEY']).toBe('sk-ant');
  });

  it('scopes credentials to the CLI actually being run', async () => {
    const mgr = await freshManager();
    const source = { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' };

    mgr.spawnInContainer('team-a', '/tmp/wd', 'codex', ['exec'], source);
    const codexEnv = envPairs(lastDockerArgs());
    expect(codexEnv['OPENAI_API_KEY']).toBe('o');
    expect(codexEnv['ANTHROPIC_API_KEY']).toBeUndefined();

    mgr.spawnInContainer('team-b', '/tmp/wd', 'gemini', ['-p'], source);
    const geminiEnv = envPairs(lastDockerArgs());
    expect(geminiEnv['GEMINI_API_KEY']).toBe('g');
    expect(geminiEnv['OPENAI_API_KEY']).toBeUndefined();
  });

  it('still mounts the workdir and applies the resource caps', async () => {
    const mgr = await freshManager();
    mgr.spawnInContainer('team-a', '/tmp/wd', 'claude', ['--print'], {});
    const args = lastDockerArgs();
    expect(args).toContain('--rm');
    expect(args.join(' ')).toContain('/tmp/wd:/workspace');
    expect(args[args.indexOf('--memory') + 1]).toBe('2g');
    expect(args[args.indexOf('--cpus') + 1]).toBe('1');
  });

  it('passes the command and its args through unchanged, after the image', async () => {
    const mgr = await freshManager();
    mgr.spawnInContainer('team-a', '/tmp/wd', 'claude', ['--print', '-', '--verbose'], {});
    const args = lastDockerArgs();
    expect(args.slice(-4)).toEqual(['claude', '--print', '-', '--verbose']);
  });
});
