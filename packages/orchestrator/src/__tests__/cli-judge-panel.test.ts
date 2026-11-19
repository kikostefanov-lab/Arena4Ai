/**
 * `arena run --judge-panel` must reach the runner as `judgePanel: true`.
 * The flag's registration is checked against the real CLI's help output; the
 * flag-to-RunOptions mapping against the function cli.ts uses.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runOptionsFromCli } from '../cli-run-options.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const cli = resolve(here, '../cli.ts');
const tsx = resolve(here, '../../../../node_modules/.bin/tsx');

const base = { logDir: '/tmp/arena-logs', claudeBin: 'claude', print: true };

describe('arena run --judge-panel', () => {
  it('is a registered flag of `run`', () => {
    const help = execFileSync(tsx, [cli, 'run', '--help'], { encoding: 'utf8' });
    expect(help).toContain('--judge-panel');
  }, 20_000);

  it('turns the panel on only when given', () => {
    expect(runOptionsFromCli({ ...base, judgePanel: true }).judgePanel).toBe(true);
    expect(runOptionsFromCli(base).judgePanel).toBe(false);
  });

  it('keeps the other flags as before', () => {
    expect(runOptionsFromCli({ ...base, adversarialJudge: true, commentary: true, skipSandbox: true })).toEqual({
      logDir: '/tmp/arena-logs', claudeBin: 'claude', printResults: true,
      skipSandbox: true, commentary: true, adversarialJudge: true, judgePanel: false,
    });
  });
});
