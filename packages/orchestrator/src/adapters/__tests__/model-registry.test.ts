import { describe, it, expect, afterEach } from 'vitest';
import { CLI_DEFAULT_MODEL } from '@arena/shared';
import {
  getModelRegistry,
  getDefaultModel,
  getProviderConfig,
  requireDefaultModel,
  resolveJudgeModel,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_ADVERSARIAL_JUDGE_MODEL,
} from '../model-registry.js';

/**
 * Ids that were shipped and are NOT real model ids on the currently supported
 * CLIs (codex-cli 0.144.x, gemini-cli 0.38.x) or the Anthropic API. Any of these
 * reaching a user means a runtime failure on their first competition.
 */
const RETIRED_OR_BOGUS_IDS = [
  'codex-standard',
  'gemini-2-flash',
  'o4-mini',
  'o3',
  'codex-mini',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

describe('model registry', () => {
  const providers = getModelRegistry().providers;

  it('registers claude, codex and gemini', () => {
    expect(providers.map(p => p.id).sort()).toEqual(['claude', 'codex', 'gemini']);
  });

  it('ships no retired or bogus model ids', () => {
    const ids = providers.flatMap(p => p.presets.map(m => m.id));
    for (const bad of RETIRED_OR_BOGUS_IDS) {
      expect(ids, `retired id "${bad}" is still in the registry`).not.toContain(bad);
    }
  });

  it('has exactly one default per provider', () => {
    for (const p of providers) {
      expect(p.presets.filter(m => m.default), `provider ${p.id}`).toHaveLength(1);
    }
  });

  it('never date-suffixes an Anthropic model id', () => {
    const claude = getProviderConfig('claude')!;
    for (const preset of claude.presets) {
      expect(preset.id, preset.id).not.toMatch(/-\d{8}$/);
    }
  });

  it('defaults every provider to the CLI default, the one id that cannot go stale', () => {
    for (const p of ['claude', 'codex', 'gemini']) {
      expect(getDefaultModel(p), p).toBe(CLI_DEFAULT_MODEL);
    }
  });

  it('keeps no hardcoded codex or gemini ids (their lists come from the CLI)', () => {
    for (const p of ['codex', 'gemini']) {
      expect(getProviderConfig(p)!.presets.map(m => m.id), p).toEqual([CLI_DEFAULT_MODEL]);
    }
  });

  it('pins the Claude judges to full model ids, not aliases or the CLI default', () => {
    for (const id of [DEFAULT_JUDGE_MODEL, DEFAULT_ADVERSARIAL_JUDGE_MODEL]) {
      expect(id).toMatch(/^claude-/);
    }
  });

  it('carries a binary name and install hint per provider (needed for preflight)', () => {
    for (const p of providers) {
      expect(p.bin, p.id).toBeTruthy();
      expect(p.installHint, p.id).toBeTruthy();
    }
  });

  it('requireDefaultModel throws for an unknown provider', () => {
    expect(() => requireDefaultModel('nope')).toThrow(/No default model/);
  });
});

describe('resolveJudgeModel', () => {
  afterEach(() => {
    delete process.env['ARENA_JUDGE_MODEL'];
    delete process.env['ARENA_ADVERSARIAL_JUDGE_MODEL'];
  });

  it('pins the standard judge to an explicit model', () => {
    expect(resolveJudgeModel('ai-claude')).toBe(DEFAULT_JUDGE_MODEL);
  });

  it('runs the adversarial judge on a DIFFERENT model than the standard judge', () => {
    expect(resolveJudgeModel('ai-adversarial')).not.toBe(resolveJudgeModel('ai-claude'));
    expect(resolveJudgeModel('ai-adversarial')).toBe(DEFAULT_ADVERSARIAL_JUDGE_MODEL);
  });

  it('runs codex and gemini judges on their CLI default unless overridden', () => {
    expect(resolveJudgeModel('ai-claude', 'codex')).toBe(CLI_DEFAULT_MODEL);
    expect(resolveJudgeModel('ai-claude', 'gemini')).toBe(CLI_DEFAULT_MODEL);
  });

  it('honours env overrides for reproducing an old score', () => {
    process.env['ARENA_JUDGE_MODEL'] = 'claude-opus-4-8';
    expect(resolveJudgeModel('ai-claude')).toBe('claude-opus-4-8');
  });
});
