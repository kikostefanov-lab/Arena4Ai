import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI_DEFAULT_MODEL } from '@arena/shared';
import {
  parseCodexModels,
  parseGeminiModels,
  getProviderCatalog,
  clearModelCatalogCache,
  judgeModel,
  catalogPresets,
  describeAvailable,
  type ProviderCatalog,
} from '../model-catalog.js';
import { findUnavailableModels, formatUnavailableModelError } from '../../utils/cli-preflight.js';
import { repairStaleSystemAgents } from '../../db/seed-personas-agents.js';

// Shapes captured from codex-cli 0.164 (`codex debug models`) and gemini-cli
// 0.68 (`gemini --list-models`).
const CODEX_JSON = JSON.stringify({
  models: [
    { slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', visibility: 'list', priority: 5 },
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', priority: 1 },
    { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', priority: 6 },
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list', priority: 2 },
  ],
});

const GEMINI_TEXT = `Available Gemini Models:

auto (Auto)
  Description:   Let Gemini CLI decide the best model for the task: gemini-2.5-pro, gemini-3.5-flash
  Context limit: 1,048,576 input tokens / 8,192 output tokens

gemini-2.5-pro (gemini-2.5-pro)
  Context limit: 1,048,576 input tokens / 8,192 output tokens

gemini-3.5-flash (gemini-3.5-flash)
  Context limit: 1,048,576 input tokens / 8,192 output tokens
`;

const cliCatalog = (provider: string, models: ProviderCatalog['models']): ProviderCatalog =>
  ({ provider, source: 'cli', models, fetchedAt: '2026-11-14T00:00:00Z' });

describe('parseCodexModels', () => {
  it('lists visible models first, in the CLI\'s priority order, keeping hidden ones for validation', () => {
    const models = parseCodexModels(CODEX_JSON);
    expect(models.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-reserve']);
    expect(models.find((m) => m.id === 'gpt-reserve')?.listed).toBe(false);
    expect(models[0]!.label).toBe('GPT-6.1-Sol');
  });
});

describe('parseGeminiModels', () => {
  it('reads every `<id> (<label>)` line and ignores the detail lines', () => {
    const models = parseGeminiModels(GEMINI_TEXT);
    expect(models.map((m) => m.id)).toEqual(['auto', 'gemini-2.5-pro', 'gemini-3.5-flash']);
    expect(models[0]!.label).toBe('Auto (auto)');
    expect(models[1]!.label).toBe('gemini-2.5-pro');
  });
});

it('parseGeminiModels ignores ANSI styling (FORCE_COLOR in the parent env)', () => {
  const styled = '\u001b[1mAvailable Gemini Models:\u001b[22m\n\n\u001b[1mauto\u001b[22m (Auto)\n\u001b[1mgemini-2.5-pro\u001b[22m (gemini-2.5-pro)\n';
  expect(parseGeminiModels(styled).map((m) => m.id)).toEqual(['auto', 'gemini-2.5-pro']);
});

describe('judgeModel', () => {
  const codex = cliCatalog('codex', parseCodexModels(CODEX_JSON));

  it('always accepts the CLI default', () => {
    expect(judgeModel(codex, CLI_DEFAULT_MODEL)).toBe('known');
    expect(judgeModel(codex, undefined)).toBe('known');
  });

  it('accepts listed and hidden models the CLI knows', () => {
    expect(judgeModel(codex, 'gpt-6.1-sol')).toBe('known');
    expect(judgeModel(codex, 'gpt-reserve')).toBe('known');
  });

  it('rejects an id the CLI does not offer (the codex-standard failure)', () => {
    expect(judgeModel(codex, 'codex-standard')).toBe('unknown');
    expect(judgeModel(codex, 'gpt-5.3-codex')).toBe('unknown');
  });

  it('cannot rule anything out when the CLI list was unavailable', () => {
    expect(judgeModel({ ...codex, source: 'static', models: [] }, 'gpt-anything')).toBe('unverifiable');
  });

  it('treats Claude aliases as known and unknown full claude ids as unverifiable', () => {
    const claude: ProviderCatalog = { provider: 'claude', source: 'static', models: [], fetchedAt: '' };
    expect(judgeModel(claude, 'opus')).toBe('known');
    expect(judgeModel(claude, 'claude-sonnet-4-6')).toBe('unverifiable');
    expect(judgeModel(claude, 'gpt-6-sol')).toBe('unknown');
  });
});

describe('catalogPresets', () => {
  it('puts the CLI default first as the default, then the listed models', () => {
    const presets = catalogPresets(cliCatalog('codex', parseCodexModels(CODEX_JSON)));
    expect(presets[0]).toMatchObject({ id: CLI_DEFAULT_MODEL, default: true });
    expect(presets.map((p) => p.id)).toEqual([CLI_DEFAULT_MODEL, 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol']);
    expect(presets.filter((p) => p.default)).toHaveLength(1);
  });

  it('offers the Claude "latest" aliases', () => {
    const ids = catalogPresets({ provider: 'claude', source: 'static', models: [], fetchedAt: '' }).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([CLI_DEFAULT_MODEL, 'opus', 'sonnet', 'haiku']));
  });

  it('describeAvailable lists only visible models', () => {
    expect(describeAvailable(cliCatalog('codex', parseCodexModels(CODEX_JSON)))).toBe('gpt-6.1-sol, gpt-6-astra, gpt-6-sol');
  });
});

describe('findUnavailableModels', () => {
  const catalogs: Record<string, ProviderCatalog> = {
    codex: cliCatalog('codex', parseCodexModels(CODEX_JSON)),
    gemini: cliCatalog('gemini', parseGeminiModels(GEMINI_TEXT)),
  };
  const probed: string[] = [];
  const getCatalog = async (p: string) => { probed.push(p); return catalogs[p]!; };

  it('names each team whose model the CLI does not offer', async () => {
    const bad = await findUnavailableModels([
      { teamId: 'team-a', label: 'claude:architect', provider: 'claude', modelVariant: CLI_DEFAULT_MODEL },
      { teamId: 'team-b', label: 'codex:standard', provider: 'codex', modelVariant: 'codex-standard' },
      { teamId: 'team-c', label: 'gemini:standard', provider: 'gemini', modelVariant: 'gemini-3.5-flash' },
    ], {}, getCatalog);
    expect(bad.map((b) => b.teamId)).toEqual(['team-b']);
    const message = formatUnavailableModelError(bad);
    expect(message).toContain('codex:standard: model "codex-standard" is not offered by the installed codex CLI');
    expect(message).toContain('Available: gpt-6.1-sol');
  });

  it('never probes a CLI for a team on the CLI default', async () => {
    probed.length = 0;
    await findUnavailableModels([
      { teamId: 'a', label: 'codex:x', provider: 'codex', modelVariant: CLI_DEFAULT_MODEL },
      { teamId: 'b', label: 'gemini:x', provider: 'gemini' },
    ], {}, getCatalog);
    expect(probed).toEqual([]);
  });
});

describe('repairStaleSystemAgents', () => {
  const agent = (id: string, provider: string, modelVariant: string, createdBy = 'system') =>
    ({ id, provider, modelVariant, createdBy }) as never;

  it('moves system agents off ids the CLI does not list, and leaves user agents alone', async () => {
    const updates: Array<[string, string | undefined]> = [];
    const repo = {
      list: async () => ({
        agents: [
          agent('agent-codex-standard', 'codex', 'codex-standard'),
          agent('agent-gemini-standard', 'gemini', 'gemini-2-flash'),
          agent('agent-claude-architect', 'claude', 'claude-sonnet-4-6'),
          agent('agent-claude-pioneer', 'claude', 'opus'),
          agent('agent-codex-ok', 'codex', 'gpt-6-sol'),
          agent('agent-codex-default', 'codex', CLI_DEFAULT_MODEL),
          agent('user-codex', 'codex', 'codex-standard', 'user'),
        ],
      }),
      update: async (id: string, input: { modelVariant?: string }) => { updates.push([id, input.modelVariant]); return null; },
    };
    const catalogs: Record<string, ProviderCatalog> = {
      codex: cliCatalog('codex', parseCodexModels(CODEX_JSON)),
      gemini: cliCatalog('gemini', parseGeminiModels(GEMINI_TEXT)),
      claude: { provider: 'claude', source: 'static', models: [{ id: 'claude-opus-5', label: 'Opus 5', listed: true }], fetchedAt: '' },
    };
    const repaired = await repairStaleSystemAgents(repo as never, async (p) => catalogs[p]!);

    expect(updates).toEqual([
      ['agent-codex-standard', CLI_DEFAULT_MODEL],
      ['agent-gemini-standard', CLI_DEFAULT_MODEL],
      ['agent-claude-architect', CLI_DEFAULT_MODEL],
    ]);
    expect(repaired.map((r) => r.from)).toEqual(['codex-standard', 'gemini-2-flash', 'claude-sonnet-4-6']);
  });
});

describe.skipIf(process.platform === 'win32')('getProviderCatalog (real spawn)', () => {
  beforeEach(() => clearModelCatalogCache());

  async function fakeBin(script: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'arena-catalog-'));
    const bin = join(dir, 'fake-cli');
    await writeFile(bin, `#!/bin/sh\n${script}\n`);
    await chmod(bin, 0o755);
    return bin;
  }

  it('reads a gemini list printed to STDERR (gemini-cli 0.68 does this)', async () => {
    const bin = await fakeBin(`printf 'Available Gemini Models:\\n\\nauto (Auto)\\n  Context limit: 1\\n\\ngemini-3.5-flash (gemini-3.5-flash)\\n' >&2`);
    const catalog = await getProviderCatalog('gemini', { bin });
    expect(catalog.source).toBe('cli');
    expect(catalog.models.map((m) => m.id)).toEqual(['auto', 'gemini-3.5-flash']);
  });

  it('reads the codex JSON catalog from stdout', async () => {
    const bin = await fakeBin(`cat <<'JSON'\n${CODEX_JSON}\nJSON`);
    const catalog = await getProviderCatalog('codex', { bin });
    expect(catalog.source).toBe('cli');
    expect(catalog.models[0]!.id).toBe('gpt-6.1-sol');
  });

  it('falls back to static presets, with the reason, when the CLI fails', async () => {
    const bin = await fakeBin('echo "not logged in" >&2; exit 3');
    const catalog = await getProviderCatalog('codex', { bin });
    expect(catalog.source).toBe('static');
    expect(catalog.error).toMatch(/exited with code 3: not logged in/);
  });
});
