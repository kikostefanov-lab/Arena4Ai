import { describe, it, expect } from 'vitest';
import { isCliAvailable, findMissingClis, formatMissingCliError, providerBin } from '../cli-preflight.js';

describe('cli preflight', () => {
  it('detects a binary that does not exist', async () => {
    expect(await isCliAvailable('arena-definitely-not-a-real-binary')).toBe(false);
  });

  it('detects a binary that does exist', async () => {
    expect(await isCliAvailable('node')).toBe(true);
  });

  it('resolves a provider binary from the registry, honouring overrides', () => {
    expect(providerBin('gemini')).toBe('gemini');
    expect(providerBin('gemini', { gemini: '/opt/custom/gemini' })).toBe('/opt/custom/gemini');
  });

  it('reports the missing provider with an actionable hint', async () => {
    const missing = await findMissingClis(['gemini'], { gemini: 'arena-definitely-not-a-real-binary' });
    expect(missing).toHaveLength(1);
    expect(missing[0]!.provider).toBe('gemini');
    expect(missing[0]!.bin).toBe('arena-definitely-not-a-real-binary');
    expect(missing[0]!.hint).toMatch(/gemini-cli/);
  });

  it('probes each provider once even when several teams share it', async () => {
    const missing = await findMissingClis(['gemini', 'gemini', 'gemini'], {
      gemini: 'arena-definitely-not-a-real-binary',
    });
    expect(missing).toHaveLength(1);
  });

  it('formats an error that names the binary and how to get it', () => {
    const msg = formatMissingCliError([{ provider: 'codex', bin: 'codex', hint: 'npm i -g @openai/codex' }]);
    expect(msg).toContain('codex');
    expect(msg).toContain('not found on PATH');
    expect(msg).toContain('npm i -g @openai/codex');
  });
});
