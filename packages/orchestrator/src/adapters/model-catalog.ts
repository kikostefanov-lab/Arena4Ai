import { spawn } from 'node:child_process';
import { stripAnsi } from './normalizer-utils.js';
import { CLI_DEFAULT_MODEL, isCliDefaultModel } from '@arena/shared';
import {
  getProviderConfig, getModelRegistry, CLAUDE_MODEL_ALIASES, type ModelPreset, type ModelsResponse,
} from './model-registry.js';

/**
 * Live model catalog: the models each agent CLI says it can run right now.
 *
 * A hand-maintained id list goes stale every time a provider ships (Arena's
 * did, twice: `codex-standard` / `gemini-2-flash`, then `gpt-5.3-codex` /
 * `gemini-3-flash`, none of which the installed CLIs offered). So the CLIs are
 * the source of truth:
 *   - codex:  `codex debug models` prints its catalog as JSON
 *   - gemini: `gemini --list-models` lists what the signed-in account can use
 *   - claude: no list command, but `--model opus|sonnet|haiku|fable` always
 *             resolves to the latest model of that family
 * Both probes are local (no model call). Results are cached; when a probe fails
 * the static registry presets are used and nothing is rejected as unknown.
 */

export interface CatalogModel {
  id: string;
  label: string;
  /** False for models the CLI knows but hides from its own picker. */
  listed: boolean;
}

export interface ProviderCatalog {
  provider: string;
  /** 'cli' = read from the installed CLI; 'static' = registry fallback. */
  source: 'cli' | 'static';
  models: CatalogModel[];
  fetchedAt: string;
  /** Why the CLI could not be read, when source is 'static' for a listable provider. */
  error?: string;
}

/** Whether a model id can be used with a provider. */
export type ModelVerdict = 'known' | 'unknown' | 'unverifiable';

const CACHE_TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 20_000;
const MAX_PROBE_OUTPUT = 4 * 1024 * 1024;

const cache = new Map<string, { catalog: ProviderCatalog; expiresAt: number }>();

/** Test hook: forget cached catalogs. */
export function clearModelCatalogCache(): void {
  cache.clear();
}

/** Run a CLI and capture its output. Rejects on spawn failure, timeout or non-zero exit. */
export function runProbe(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // NO_COLOR: a parent with FORCE_COLOR set (dev servers often are) makes
    // gemini bold every model id with ANSI codes.
    const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    delete env.FORCE_COLOR;
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '';
    let err = '';
    child.stdout!.on('data', (d: Buffer) => { if (out.length < MAX_PROBE_OUTPUT) out += d.toString(); });
    child.stderr!.on('data', (d: Buffer) => { if (err.length < MAX_PROBE_OUTPUT) err += d.toString(); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${bin} ${args.join(' ')} timed out`));
    }, PROBE_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(`${bin} ${args.join(' ')} exited with code ${code}: ${err.trim().split('\n').pop() ?? ''}`));
    });
  });
}

/** Parse `codex debug models` JSON. Listed models first, in the CLI's own priority order. */
export function parseCodexModels(stdout: string): CatalogModel[] {
  const data = JSON.parse(stdout) as { models?: Array<Record<string, unknown>> };
  const rows = Array.isArray(data.models) ? data.models : [];
  return rows
    .filter((m) => typeof m.slug === 'string' && m.slug)
    .map((m) => ({
      id: m.slug as string,
      label: typeof m.display_name === 'string' && m.display_name ? m.display_name : (m.slug as string),
      listed: m.visibility === 'list',
      priority: typeof m.priority === 'number' ? m.priority : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => Number(b.listed) - Number(a.listed) || a.priority - b.priority)
    .map(({ priority: _p, ...m }) => m);
}

/**
 * Parse `gemini --list-models`. Each model is a line at column 0 of the form
 * `<id> (<label>)`, followed by indented detail lines.
 */
export function parseGeminiModels(stdout: string): CatalogModel[] {
  const models: CatalogModel[] = [];
  for (const line of stripAnsi(stdout).split('\n')) {
    const m = /^([A-Za-z0-9][\w.:-]*) \((.+)\)\s*$/.exec(line);
    if (m) models.push({ id: m[1]!, label: m[1] === m[2] ? m[1]! : `${m[2]} (${m[1]})`, listed: true });
  }
  return models;
}

function staticCatalog(provider: string, error?: string): ProviderCatalog {
  const presets: ModelPreset[] = getProviderConfig(provider)?.presets ?? [];
  return {
    provider,
    source: 'static',
    models: presets
      .filter((p) => p.id !== CLI_DEFAULT_MODEL)
      .map((p) => ({ id: p.id, label: p.label, listed: true })),
    fetchedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
}

async function probe(provider: string, bin: string): Promise<ProviderCatalog> {
  try {
    let models: CatalogModel[] | null = null;
    if (provider === 'codex') {
      models = parseCodexModels((await runProbe(bin, ['debug', 'models'])).stdout);
    } else if (provider === 'gemini') {
      // gemini-cli 0.68 prints the list to stderr; read both streams.
      const { stdout, stderr } = await runProbe(bin, ['--list-models']);
      models = parseGeminiModels(`${stdout}\n${stderr}`);
    }
    if (!models) return staticCatalog(provider);
    if (models.length === 0) return staticCatalog(provider, `${bin} reported no models`);
    return { provider, source: 'cli', models, fetchedAt: new Date().toISOString() };
  } catch (err) {
    const message = (err as Error).message;
    console.warn(`[arena] could not read the ${provider} model list (${message}); using built-in presets`);
    return staticCatalog(provider, message);
  }
}

/** The models a provider's CLI offers, cached for a few minutes. */
export async function getProviderCatalog(
  provider: string,
  opts: { bin?: string; force?: boolean } = {},
): Promise<ProviderCatalog> {
  const bin = opts.bin || getProviderConfig(provider)?.bin || provider;
  const key = `${provider}\0${bin}`;
  const hit = cache.get(key);
  if (hit && !opts.force && hit.expiresAt > Date.now()) return hit.catalog;
  const catalog = await probe(provider, bin);
  const ttl = catalog.error ? FAILURE_TTL_MS : CACHE_TTL_MS;
  cache.set(key, { catalog, expiresAt: Date.now() + ttl });
  return catalog;
}

/**
 * Can `variant` be run by this provider?
 *   known        — the CLI offers it (or it is the CLI default / a Claude alias)
 *   unknown      — the CLI's own list does not contain it: it will fail
 *   unverifiable — no list to check against (probe failed, or a full Claude id)
 */
export function judgeModel(catalog: ProviderCatalog, variant: string | null | undefined): ModelVerdict {
  if (isCliDefaultModel(variant)) return 'known';
  const id = variant!;
  if (catalog.models.some((m) => m.id === id)) return 'known';
  if (catalog.provider === 'claude') {
    if ((CLAUDE_MODEL_ALIASES as readonly string[]).includes(id)) return 'known';
    // Claude has no list command, so a full id we don't know can't be ruled out.
    return id.startsWith('claude-') ? 'unverifiable' : 'unknown';
  }
  return catalog.source === 'cli' ? 'unknown' : 'unverifiable';
}

/** Presets for pickers: CLI default first, then what the CLI lists. */
export function catalogPresets(catalog: ProviderCatalog): ModelPreset[] {
  const bin = getProviderConfig(catalog.provider)?.bin ?? catalog.provider;
  const seen = new Set<string>();
  const presets: ModelPreset[] = [
    { id: CLI_DEFAULT_MODEL, label: `CLI default (${bin}'s own choice)`, default: true },
  ];
  seen.add(CLI_DEFAULT_MODEL);
  if (catalog.provider === 'claude') {
    for (const alias of CLAUDE_MODEL_ALIASES) {
      presets.push({ id: alias, label: `Latest ${alias[0]!.toUpperCase()}${alias.slice(1)} (alias)` });
      seen.add(alias);
    }
  }
  for (const m of catalog.models) {
    if (!m.listed || seen.has(m.id)) continue;
    presets.push({ id: m.id, label: m.label });
    seen.add(m.id);
  }
  return presets;
}

/** Short list of ids for error messages. */
export function describeAvailable(catalog: ProviderCatalog, max = 8): string {
  const ids = catalog.models.filter((m) => m.listed).map((m) => m.id);
  if (ids.length === 0) return 'none listed';
  return ids.length > max ? `${ids.slice(0, max).join(', ')}, …` : ids.join(', ');
}

/** `GET /models`: every provider with presets read from its installed CLI. */
export async function getLiveModelRegistry(
  bins: Record<string, string | undefined> = {},
): Promise<ModelsResponse> {
  const { providers } = getModelRegistry();
  return {
    providers: await Promise.all(
      providers.map(async (p) => {
        const catalog = await getProviderCatalog(p.id, { bin: bins[p.id] });
        return {
          ...p,
          presets: catalogPresets(catalog),
          catalog: {
            source: catalog.source,
            fetchedAt: catalog.fetchedAt,
            ...(catalog.error ? { error: catalog.error } : {}),
          },
        };
      }),
    ),
  };
}
