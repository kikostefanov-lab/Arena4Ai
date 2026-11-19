/**
 * Competitors must not load the operator's MCP servers, plugins, hooks or
 * custom agents. Each adapter's spawned argv carries its isolation args, ahead
 * of the model flag; helper stages are unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompetitionFormat } from '@arena/shared';
import type { Brief } from '@arena/shared';

const { spawnCalls } = vi.hoisted(() => ({ spawnCalls: [] as Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> }));

vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  class FakeChild extends EventEmitter {
    stdout = new PassThrough();
    stderr = new PassThrough();
    stdin = new PassThrough();
    kill = vi.fn();
  }
  return {
    spawn: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      spawnCalls.push({ command, args, env: options?.env });
      return new FakeChild();
    },
  };
});

import { ClaudeAdapter } from '../claude/claude-adapter.js';
import { CodexAdapter } from '../codex/codex-adapter.js';
import { GeminiAdapter } from '../gemini/gemini-adapter.js';
import { claudeIsolationArgs, codexIsolationArgs, geminiIsolationArgs } from '../isolation.js';
import { helperClaudeArgs } from '../../utils/claude-helper.js';

const BRIEF: Brief = {
  id: 'iso-1',
  title: 'Isolation',
  problem: 'Do a thing',
  constraints: [],
  deliverables: ['out.md'],
  rubric: { criteria: [{ id: 'c', description: 'd', weight: 1, maxScore: 10 }] },
  format: CompetitionFormat.SPRINT,
  timeLimitMs: 60_000,
};

/** True when `sub` appears in `args` as one contiguous run. */
function containsRun(args: string[], sub: string[]): boolean {
  return args.some((_, i) => sub.every((s, j) => args[i + j] === s));
}

describe('competitor isolation', () => {
  beforeEach(() => { spawnCalls.length = 0; });

  const cases = [
    ['claude', ClaudeAdapter, claudeIsolationArgs, '--model'],
    ['codex', CodexAdapter, codexIsolationArgs, '-m'],
    ['gemini', GeminiAdapter, geminiIsolationArgs, '--model'],
  ] as const;

  for (const [name, Adapter, isolationArgs, modelFlag] of cases) {
    it(`${name} spawns with its isolation args, before the model flag`, async () => {
      const a = new Adapter('t', { workdir: '/tmp', competitionId: 'c', modelVariant: 'some-model' } as never);
      await a.injectBrief(BRIEF, 'p');
      await a.startExecution();
      const { args } = spawnCalls[0]!;
      const iso = isolationArgs();
      expect(iso.length).toBeGreaterThan(0);
      expect(containsRun(args, iso)).toBe(true);
      expect(args.indexOf(iso[0]!)).toBeLessThan(args.indexOf(modelFlag));
    });
  }
});

describe('competitor environment', () => {
  beforeEach(() => { spawnCalls.length = 0; });

  const INJECTORS = [
    'CLAUDE_CODE_PLUGIN_DIRS', 'CLAUDE_CODE_PLUGIN_SEED_DIR', 'CLAUDE_CODE_PLUGIN_CACHE_DIR',
    'CLAUDE_CODE_MANAGED_SETTINGS_PATH', 'CLAUDE_CODE_MCP_SERVER_URL',
    'GEMINI_CLI_SYSTEM_SETTINGS_PATH', 'GEMINI_CLI_SYSTEM_DEFAULTS_PATH',
  ];

  for (const [name, Adapter] of [['claude', ClaudeAdapter], ['codex', CodexAdapter], ['gemini', GeminiAdapter]] as const) {
    it(`${name} does not inherit variables that inject plugins, MCP or settings`, async () => {
      for (const k of INJECTORS) process.env[k] = '/somewhere';
      process.env['CLAUDE_CONFIG_DIR'] = '/auth-dir';
      try {
        const a = new Adapter('t', { workdir: '/tmp', competitionId: 'c' } as never);
        await a.injectBrief(BRIEF, 'p');
        await a.startExecution();
        const env = spawnCalls[0]!.env!;
        for (const k of INJECTORS) expect(env[k], k).toBeUndefined();
        expect(env['CLAUDE_CONFIG_DIR']).toBe('/auth-dir'); // auth is kept
      } finally {
        for (const k of [...INJECTORS, 'CLAUDE_CONFIG_DIR']) delete process.env[k];
      }
    });
  }

  it('claude keeps the squad cap variables', async () => {
    process.env['CLAUDE_CODE_PLUGIN_DIRS'] = '/x';
    try {
      const a = new ClaudeAdapter('t', { workdir: '/tmp', competitionId: 'c' });
      await a.injectBrief(BRIEF, 'p');
      await a.startExecution();
      expect(spawnCalls[0]!.env).toMatchObject({
        CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '6',
        CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1',
      });
    } finally {
      delete process.env['CLAUDE_CODE_PLUGIN_DIRS'];
    }
  });
});

describe('helper stages', () => {
  it('helperClaudeArgs() is unchanged', () => {
    expect(helperClaudeArgs({ model: 'm' })).toEqual([
      '--print', '-',
      '--output-format', 'text',
      '--model', 'm',
      '--tools', '',
      '--permission-mode', 'dontAsk',
      '--strict-mcp-config',
      '--disable-slash-commands',
    ]);
  });
});
