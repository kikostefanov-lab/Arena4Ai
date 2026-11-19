/**
 * Manual check that competitor isolation works on the INSTALLED CLIs.
 * Runs a one-line prompt per provider in a temp dir with the adapters' real
 * isolation args and asserts nothing of the operator's setup is loaded.
 * Costs three trivial model calls. Prints counts only, never tool names.
 *
 *   npx tsx packages/orchestrator/src/dev/isolation-smoke.ts [claude|codex|gemini ...]
 *
 * Env: ISO_CLAUDE_MODEL (default haiku), ISO_CODEX_MODEL (default: CLI default),
 * ISO_GEMINI_MODEL (default gemini-3.1-flash-lite).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeEnv } from '../utils/claude-env.js';
import { claudeIsolationArgs, codexIsolationArgs, geminiIsolationArgs } from '../adapters/isolation.js';
import { codexArgs } from '../adapters/codex/codex-adapter.js';

const BUILTIN_AGENTS = new Set(['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'claude-code-guide', 'claude']);
const PROMPT = 'reply OK';

function run(bin: string, args: string[], input?: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'arena-iso-'));
  const env: NodeJS.ProcessEnv = { ...claudeEnv(), GEMINI_CLI_TRUST_WORKSPACE: 'true' };
  // The operator's own session may inject plugins through this variable; a real run from a shell would not.
  delete env['CLAUDE_CODE_PLUGIN_DIRS'];
  const r = spawnSync(bin, args, { cwd, env, input: input ?? '', encoding: 'utf8', timeout: 180_000 });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

const jsonLines = (s: string): Array<Record<string, any>> =>
  s.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

function claude(): string[] {
  const model = process.env['ISO_CLAUDE_MODEL'] ?? 'haiku';
  const r = run('claude', ['--print', '-', '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions', ...claudeIsolationArgs(), '--model', model], PROMPT);
  const lines = jsonLines(r.stdout);
  const init = lines.find((l) => l.type === 'system' && l.subtype === 'init');
  const result = lines.find((l) => l.type === 'result');
  const tools: string[] = init?.tools ?? [];
  const agents: string[] = init?.agents ?? [];
  const mcpTools = tools.filter((t) => t.startsWith('mcp__')).length;
  const foreign = agents.filter((a) => !BUILTIN_AGENTS.has(a)).length;
  const hooks = lines.filter((l) => l.subtype === 'hook_started').length;
  console.log(`claude: tools ${tools.length} (mcp__ ${mcpTools}), agents ${agents.length} (non-built-in ${foreign}), hooks ${hooks}, is_error ${result?.is_error}`);
  const p: string[] = [];
  if (!init) p.push('no init line');
  if (mcpTools) p.push('mcp tools present');
  if (foreign) p.push('non-built-in agents present');
  if (hooks) p.push('hooks ran');
  if (!result || result.is_error !== false) p.push('no successful result');
  return p;
}

function codex(): string[] {
  const model = process.env['ISO_CODEX_MODEL'];
  const r = run('codex', codexArgs(PROMPT, model));
  const types = jsonLines(r.stdout).map((l) => l.type);
  const mcpLines = r.stderr.split('\n').filter((l) => /rmcp|mcp/i.test(l)).length;
  console.log(`codex: exit ${r.status}, turn.completed ${types.includes('turn.completed')}, stderr mcp lines ${mcpLines}`);
  const p: string[] = [];
  if (mcpLines) p.push('MCP startup/auth lines on stderr');
  if (!types.includes('turn.completed')) p.push('no turn.completed');
  return p;
}

function gemini(): string[] {
  const model = process.env['ISO_GEMINI_MODEL'] ?? 'gemini-3.1-flash-lite';
  const r = run('gemini', ['-p', PROMPT, '--yolo', '-o', 'stream-json', ...geminiIsolationArgs(), '--model', model]);
  const result = jsonLines(r.stdout).find((l) => l.type === 'result');
  const loadLines = (r.stdout + r.stderr).split('\n').filter((l) => /extension|mcp/i.test(l)).length;
  console.log(`gemini: exit ${r.status}, result status ${result?.status}, extension/mcp lines ${loadLines}`);
  const p: string[] = [];
  if (loadLines) p.push('extension/MCP load messages');
  if (result?.status !== 'success') p.push('no success result');
  return p;
}

const all = { claude, codex, gemini };
const want = process.argv.slice(2).filter((a): a is keyof typeof all => a in all);
let failed = false;
for (const name of want.length ? want : (Object.keys(all) as Array<keyof typeof all>)) {
  const problems = all[name]();
  if (problems.length) { failed = true; console.log(`  FAIL ${name}: ${problems.join('; ')}`); } else console.log(`  ok ${name}`);
}
process.exit(failed ? 1 : 0);
