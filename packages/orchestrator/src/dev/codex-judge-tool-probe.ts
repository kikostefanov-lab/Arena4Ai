/**
 * Probe: is the codex JUDGE offered, or does it use, any tool?
 *
 *   npx tsx packages/orchestrator/src/dev/codex-judge-tool-probe.ts [--render-only]
 *
 * 1. Render: `codex debug prompt-input` with the judge's feature flags, web
 *    search setting and tool-less model catalog prints the tools the model is
 *    offered. It cannot take --ignore-user-config, so it runs with an empty
 *    CODEX_HOME, which is what --ignore-user-config amounts to (no config.toml).
 *    No model call.
 * 2. Run (one small model call): `codex exec --json` with the judge's exact
 *    argv and env (helperCodexArgs / helperEnv('codex')), in an empty scratch
 *    dir, on a prompt asking it to use any tool to list the directory. Prints
 *    only event and item types, and the final answer.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CODEX_HELPER_DISABLED_FEATURES, helperCodexArgs, helperEnv, toolLessCodexCatalog,
} from '../utils/claude-helper.js';

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { err += c.toString(); });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/** Tool names in a `codex debug prompt-input` rendering. */
function offeredTools(rendered: string): string[] {
  const names: string[] = [];
  const walk = (tools: unknown[], prefix: string) => {
    for (const t of tools as Array<{ name?: string; type?: string; tools?: unknown[] }>) {
      const n = t.name ?? t.type ?? '?';
      if (Array.isArray(t.tools) && t.tools.length > 0) walk(t.tools, `${prefix}${n}.`);
      else names.push(prefix + n);
    }
  };
  for (const item of JSON.parse(rendered) as Array<{ type?: string; tools?: unknown[] }>) {
    if (item.type === 'additional_tools' && Array.isArray(item.tools)) walk(item.tools, '');
  }
  const deferred = /Deferred tool namespaces:([^"]{0,600})/.exec(rendered)?.[1] ?? '';
  return [...names, ...[...deferred.matchAll(/- ([a-z_0-9]+):/g)].map((m) => `deferred:${m[1]}`)];
}

const env = helperEnv('codex');
const scratch = await mkdtemp(join(tmpdir(), 'arena-probe-'));
const workdir = join(scratch, 'work');
const catalogPath = join(scratch, 'catalog.json');
await mkdir(workdir);
await writeFile(join(workdir, 'marker-file.txt'), 'x');

try {
  const models = await run('codex', ['debug', 'models'], workdir, env);
  await writeFile(catalogPath, toolLessCodexCatalog(models.out), 'utf8');
  const patched = JSON.parse(await readFile(catalogPath, 'utf8')) as { models: Array<Record<string, unknown>> };
  console.log('catalog models:', patched.models.length, 'tool_mode values:', [...new Set(patched.models.map((m) => m['tool_mode']))]);

  // 1. Render the offered tools, judge flags + catalog, no user config.
  const emptyHome = join(scratch, 'codex-home');
  await mkdir(emptyHome);
  const renderArgs = [
    'debug', 'prompt-input',
    '-c', 'web_search="disabled"',
    '-c', `model_catalog_json=${JSON.stringify(catalogPath)}`,
    ...CODEX_HELPER_DISABLED_FEATURES.flatMap((f) => ['--disable', f]),
    'hi',
  ];
  const rendered = await run('codex', renderArgs, workdir, { ...env, CODEX_HOME: emptyHome });
  console.log('render exit:', rendered.code);
  console.log('offered tools:', rendered.code === 0 ? offeredTools(rendered.out) : rendered.err.slice(0, 300));

  if (!process.argv.includes('--render-only')) {
    // 2. A real judge-configured run that asks for a tool.
    const prompt = 'Use any tool you have to list the files in the current directory, '
      + 'then answer with the single word DONE. If you have no tool, answer NO_TOOLS.';
    const args = [...helperCodexArgs({ modelArgs: [], workdir, catalogPath }), prompt];
    const res = await run('codex', args, workdir, env);
    const types = new Map<string, number>();
    let answer = '';
    for (const line of res.out.split('\n')) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const ev = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
        const key = ev.item?.type ? `${ev.type}:${ev.item.type}` : String(ev.type);
        types.set(key, (types.get(key) ?? 0) + 1);
        if (ev.item?.type === 'agent_message' && ev.item.text) answer = ev.item.text;
      } catch { /* not JSON */ }
    }
    console.log('exec exit:', res.code);
    console.log('event/item types:', Object.fromEntries(types));
    console.log('final answer:', answer.slice(0, 200));
    console.log('marker file listed:', answer.includes('marker-file'));
    console.log('model named on stderr:', /^model:\s*(\S+)/m.exec(res.err)?.[1] ?? '(none)');
    const firstEvent = res.out.split('\n').find((l) => l.trim().startsWith('{'));
    console.log('first event keys:', firstEvent ? Object.keys(JSON.parse(firstEvent) as object) : []);
    if (res.code !== 0) console.log('stderr tail:', res.err.trim().split('\n').slice(-3).join(' | ').slice(0, 300));
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
