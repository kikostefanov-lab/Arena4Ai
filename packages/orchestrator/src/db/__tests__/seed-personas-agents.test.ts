import { describe, it, expect } from 'vitest';
import { SEEDED_AGENTS } from '../seed-personas-agents.js';
import { getProviderConfig, getDefaultModel } from '../../adapters/model-registry.js';

describe('seeded system agents', () => {
  it('every agent carries a model id the registry actually knows', () => {
    for (const agent of SEEDED_AGENTS) {
      const config = getProviderConfig(agent.provider);
      expect(config, `unknown provider ${agent.provider}`).toBeDefined();
      const known = config!.presets.map(p => p.id);
      expect(known, `${agent.id} → "${agent.modelVariant}"`).toContain(agent.modelVariant);
    }
  });

  it('seeds each provider at its registry default (so `codex:standard` runs a real model)', () => {
    const codex = SEEDED_AGENTS.find(a => a.id === 'agent-codex-standard')!;
    const gemini = SEEDED_AGENTS.find(a => a.id === 'agent-gemini-standard')!;
    expect(codex.modelVariant).toBe(getDefaultModel('codex'));
    expect(gemini.modelVariant).toBe(getDefaultModel('gemini'));
  });

  it('never seeds a provider-name-shaped placeholder instead of a model id', () => {
    for (const agent of SEEDED_AGENTS) {
      expect(agent.modelVariant, agent.id).not.toBe(`${agent.provider}-standard`);
    }
  });
});
