/**
 * The Codex and Gemini adapters used to build a `/bin/sh -c "..."` command
 * string with the (user-supplied) model variant interpolated into it. These
 * tests pin the argv-array spawn that replaced it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompetitionFormat } from '@arena/shared';
import type { Brief } from '@arena/shared';

const { spawnCalls } = vi.hoisted(() => ({
  spawnCalls: [] as Array<{ command: string; args: string[] }>,
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
    spawn: (command: string, args: string[]) => {
      spawnCalls.push({ command, args });
      return new FakeChild();
    },
  };
});

import { CodexAdapter } from '../codex/codex-adapter.js';
import { GeminiAdapter } from '../gemini/gemini-adapter.js';
import { isSafeModelVariant, safeModelVariant } from '../model-variant.js';

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
