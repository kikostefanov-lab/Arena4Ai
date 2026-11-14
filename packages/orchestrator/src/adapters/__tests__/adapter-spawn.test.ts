/**
 * The Codex and Gemini adapters used to build a `/bin/sh -c "..."` command
 * string with the (user-supplied) model variant interpolated into it. These
 * tests pin the argv-array spawn that replaced it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompetitionFormat } from '@arena/shared';
import type { Brief } from '@arena/shared';

const { spawnCalls } = vi.hoisted(() => ({
  spawnCalls: [] as Array<{
    command: string;
    args: string[];
    options?: { detached?: boolean; env?: NodeJS.ProcessEnv };
    child: import('node:events').EventEmitter & { stderr: import('node:stream').PassThrough; stdout: import('node:stream').PassThrough };
  }>,
}));

vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');

  class FakeChild extends EventEmitter {
    stdout = new PassThrough();
    stderr = new PassThrough();
    kill = vi.fn();
  }
  return {
    spawn: (command: string, args: string[], options?: { detached?: boolean; env?: NodeJS.ProcessEnv }) => {
      const child = new FakeChild();
      spawnCalls.push({ command, args, options, child });
      return child;
    },
  };
});

import { CodexAdapter } from '../codex/codex-adapter.js';
import { GeminiAdapter } from '../gemini/gemini-adapter.js';
import { isSafeModelVariant, safeModelVariant } from '../model-variant.js';
import { ClaudeAdapter, claudeStreamError } from '../claude/claude-adapter.js';
import { summarizeAgentError } from '../base-adapter.js';
import { CLI_DEFAULT_MODEL, EventType, type ArenaEvent } from '@arena/shared';

const BRIEF: Brief = {
  id: 'spawn-1',
  title: 'Spawn test',
  problem: 'Do a thing',
  constraints: [],
  deliverables: ['out.md'],
  rubric: { criteria: [{ id: 'c', description: 'd', weight: 1, maxScore: 10 }] },
  format: CompetitionFormat.SPRINT,
  timeLimitMs: 60_000,
};

const INJECTION = 'gpt-5"; touch /tmp/arena-pwned; #';

describe('CodexAdapter spawn', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
  });

  it('spawns the binary directly — never through a shell', async () => {
    const adapter = new CodexAdapter('team-a', { workdir: '/tmp', competitionId: 'c1' });
    await adapter.injectBrief(BRIEF, 'pragmatist');
    await adapter.startExecution();

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('codex');
    expect(spawnCalls[0].command).not.toBe('/bin/sh');
    expect(spawnCalls[0].args).not.toContain('-c');
  });

  it('passes a model variant as its own argv entry', async () => {
    const adapter = new CodexAdapter('team-a', {
      workdir: '/tmp',
      competitionId: 'c1',
      modelVariant: 'o3',
    });
    await adapter.injectBrief(BRIEF, 'pragmatist');
    await adapter.startExecution();

    const { args } = spawnCalls[0];
    expect(args[args.indexOf('-m') + 1]).toBe('o3');
  });

  it('drops a model variant carrying shell metacharacters', async () => {
    const adapter = new CodexAdapter('team-a', {
      workdir: '/tmp',
      competitionId: 'c1',
      modelVariant: INJECTION,
    });
    await adapter.injectBrief(BRIEF, 'pragmatist');
    await adapter.startExecution();

    const { command, args } = spawnCalls[0];
    expect(args).not.toContain('-m');
    expect([command, ...args].join(' ')).not.toContain('touch /tmp/arena-pwned');
  });
});

describe('agent process groups', () => {
  it.skipIf(process.platform === 'win32')('spawns Codex and Gemini detached so shutdown() can signal the whole group', async () => {
    spawnCalls.length = 0;
    for (const A of [CodexAdapter, GeminiAdapter]) {
      const a = new A('t', { workdir: '/tmp', competitionId: 'c' } as never);
      await a.injectBrief(BRIEF, 'p');
      await a.startExecution();
    }
    expect(spawnCalls.map((c) => c.options?.detached)).toEqual([true, true]);
  });
});

describe('GeminiAdapter spawn', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
  });

  it('spawns the binary directly — never through a shell', async () => {
    const adapter = new GeminiAdapter('team-b', { workdir: '/tmp', competitionId: 'c1' });
    await adapter.injectBrief(BRIEF, 'pragmatist');
    await adapter.startExecution();

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('gemini');
    expect(spawnCalls[0].command).not.toBe('/bin/sh');
    expect(spawnCalls[0].args).not.toContain('-c');
    expect(spawnCalls[0].args).toContain('--yolo');
  });

  it('passes a model variant as its own argv entry', async () => {
    const adapter = new GeminiAdapter('team-b', {
      workdir: '/tmp',
      competitionId: 'c1',
      modelVariant: 'gemini-2.5-pro',
    });
    await adapter.injectBrief(BRIEF, 'pragmatist');
    await adapter.startExecution();

    const { args } = spawnCalls[0];
    expect(args[args.indexOf('--model') + 1]).toBe('gemini-2.5-pro');
  });

  it('drops a model variant carrying shell metacharacters', async () => {
    const adapter = new GeminiAdapter('team-b', {
      workdir: '/tmp',
      competitionId: 'c1',
      modelVariant: INJECTION,
    });
    await adapter.injectBrief(BRIEF, 'pragmatist');
    await adapter.startExecution();

    const { command, args } = spawnCalls[0];
    expect(args).not.toContain('--model');
    expect([command, ...args].join(' ')).not.toContain('touch /tmp/arena-pwned');
  });
});

describe('model variant validation', () => {
  it('accepts real model ids', () => {
    for (const id of ['o3', 'o4-mini', 'claude-opus-4-6', 'gemini-2.5-flash', 'openrouter/some_model:v1']) {
      expect(isSafeModelVariant(id)).toBe(true);
    }
  });

  it('rejects anything a shell would treat as more than one word', () => {
    for (const id of [INJECTION, 'a b', '$(id)', '`id`', 'x;y', 'a|b', '-m', '']) {
      expect(isSafeModelVariant(id)).toBe(false);
    }
  });

  it('safeModelVariant passes undefined through', () => {
    expect(safeModelVariant(undefined)).toBeUndefined();
  });
});

describe('CLI default model', () => {
  beforeEach(() => { spawnCalls.length = 0; });

  it('passes no model flag for CLI_DEFAULT_MODEL, or for no variant at all', async () => {
    for (const modelVariant of [CLI_DEFAULT_MODEL, undefined]) {
      for (const A of [CodexAdapter, GeminiAdapter, ClaudeAdapter]) {
        const a = new A('t', { workdir: '/tmp', competitionId: 'c', modelVariant } as never);
        await a.injectBrief(BRIEF, 'p');
        await a.startExecution();
      }
    }
    for (const call of spawnCalls) {
      expect(call.args, call.command).not.toContain('-m');
      expect(call.args, call.command).not.toContain('--model');
    }
  });

  it('safeModelVariant maps the CLI default to no variant', () => {
    expect(safeModelVariant(CLI_DEFAULT_MODEL)).toBeUndefined();
  });
});

describe('agent crash reporting', () => {
  beforeEach(() => { spawnCalls.length = 0; });

  async function startCodex() {
    const adapter = new CodexAdapter('team-b', { workdir: '/tmp', competitionId: 'c1', modelVariant: 'gpt-x' });
    const events: ArenaEvent[] = [];
    adapter.on('arenaEvent', (e: ArenaEvent) => events.push(e));
    await adapter.injectBrief(BRIEF, 'p');
    await adapter.startExecution();
    return { adapter, events, child: spawnCalls[0]!.child };
  }

  const tick = () => new Promise((r) => setTimeout(r, 10));

  it('records a non-zero exit with the CLI\'s own message and emits an ERROR event', async () => {
    const { adapter, events, child } = await startCodex();
    // Real codex output for a model the account cannot use: the error lands
    // while the normalizer is still skipping the prompt echo.
    child.stderr.write('user\n');
    child.stderr.write('ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed\n');
    child.stderr.write('ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-x\' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}\n');
    await tick();
    child.emit('close', 1);
    await adapter.done;

    expect(adapter.failure?.exitCode).toBe(1);
    expect(adapter.failure?.message).toBe(
      "Codex exited with code 1: The 'gpt-x' model is not supported when using Codex with a ChatGPT account.",
    );
    const err = events.find((e) => e.type === EventType.ERROR);
    expect(err?.payload).toMatchObject({ stage: 'agent', exitCode: 1, error: adapter.failure!.message });
  });

  it('does not treat an exit caused by shutdown() as a crash', async () => {
    const { adapter, child } = await startCodex();
    await adapter.shutdown();
    child.emit('close', 143);
    await adapter.done;
    expect(adapter.failure).toBeNull();
  });

  it('a clean exit is not a failure', async () => {
    const { adapter, child } = await startCodex();
    child.emit('close', 0);
    await adapter.done;
    expect(adapter.failure).toBeNull();
  });

  it('falls back to a generic message when stderr says nothing useful', async () => {
    const { adapter, child } = await startCodex();
    child.emit('close', 2);
    await adapter.done;
    expect(adapter.failure?.message).toBe('Codex exited with code 2 before producing a result');
  });
});

describe('summarizeAgentError', () => {
  it('prefers an ERROR: line over looser error noise', () => {
    expect(summarizeAgentError(['Error: noise', 'ERROR: plain failure', 'trailing'])).toBe('plain failure');
  });
  it('reads plain Error: lines (gemini / claude)', () => {
    expect(summarizeAgentError(['starting', 'Error: Requested entity was not found.'])).toBe('Requested entity was not found.');
  });
  it('falls back to the last line when nothing is labelled as an error', () => {
    expect(summarizeAgentError(['starting', 'Gemini CLI is not running in a trusted directory.'])).toBe(
      'Gemini CLI is not running in a trusted directory.',
    );
    expect(summarizeAgentError([])).toBeUndefined();
  });
});

describe('claudeStreamError', () => {
  it('extracts an is_error result', () => {
    expect(claudeStreamError(JSON.stringify({ type: 'result', is_error: true, result: 'model not found' }))).toBe('model not found');
  });
  it('extracts an error event', () => {
    expect(claudeStreamError(JSON.stringify({ type: 'error', error: { message: 'overloaded' } }))).toBe('overloaded');
  });
  it('ignores normal lines and non-JSON', () => {
    expect(claudeStreamError(JSON.stringify({ type: 'result', is_error: false, result: 'ok' }))).toBeUndefined();
    expect(claudeStreamError('not json')).toBeUndefined();
  });
});

describe('gemini trusted-folder requirement (gemini-cli >= 0.68)', () => {
  beforeEach(() => { spawnCalls.length = 0; });

  it('trusts the agent workdir so headless gemini does not exit 55', async () => {
    const a = new GeminiAdapter('t', { workdir: '/tmp', competitionId: 'c' });
    await a.injectBrief(BRIEF, 'p');
    await a.startExecution();
    expect(spawnCalls[0]!.options?.env?.GEMINI_CLI_TRUST_WORKSPACE).toBe('true');
  });

  it('reports the coloured "not trusted" error in plain text', async () => {
    const a = new GeminiAdapter('t', { workdir: '/tmp', competitionId: 'c' });
    await a.injectBrief(BRIEF, 'p');
    await a.startExecution();
    const child = spawnCalls[0]!.child;
    child.stderr.write('YOLO mode is enabled. All tool calls will be automatically approved.\n');
    child.stderr.write('\u001b[31mGemini CLI is not running in a trusted directory. To proceed, either use `--skip-trust`\u001b[0m\n');
    await new Promise((r) => setTimeout(r, 10));
    child.emit('close', 55);
    await a.done;
    expect(a.failure?.message).toBe(
      'Gemini exited with code 55: Gemini CLI is not running in a trusted directory. To proceed, either use `--skip-trust`',
    );
  });
});
