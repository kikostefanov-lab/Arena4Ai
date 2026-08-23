import { spawn } from 'node:child_process';
import { getProviderConfig } from '../adapters/model-registry.js';

/**
 * Provider CLI availability checks.
 *
 * Arena drives whatever agent CLIs the operator already has installed. A
 * self-hoster will typically have one or two of the three — so "binary not on
 * PATH" is the single most likely first-run failure, and it has to read as
 * "install/log in to X", never as a crash or a zero-scored match.
 */

export interface MissingCli {
  provider: string;
  bin: string;
  hint: string;
}

/** Resolve the binary a provider runs, honouring an explicit --*-bin override. */
export function providerBin(provider: string, overrides: Record<string, string | undefined> = {}): string {
  return overrides[provider] || getProviderConfig(provider)?.bin || provider;
}

/** True when `bin` can be spawned (i.e. it exists on PATH / at that path). */
export async function isCliAvailable(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));   // ENOENT / EACCES
    child.on('close', () => resolve(true));    // non-zero exit still proves it exists
    setTimeout(() => { child.kill(); resolve(true); }, 10_000).unref?.();
  });
}

/**
 * Check every provider a competition needs, returning the ones that are missing.
 * Each provider is probed once even when several teams share it.
 */
export async function findMissingClis(
  providers: string[],
  overrides: Record<string, string | undefined> = {},
): Promise<MissingCli[]> {
  const unique = [...new Set(providers)];
  const results = await Promise.all(
    unique.map(async (provider) => {
      const bin = providerBin(provider, overrides);
      if (await isCliAvailable(bin)) return null;
      return {
        provider,
        bin,
        hint: getProviderConfig(provider)?.installHint ?? `install the "${bin}" CLI and make sure it is on PATH`,
      };
    }),
  );
  return results.filter((r): r is MissingCli => r !== null);
}

/** Human-readable, actionable message naming each missing binary. */
export function formatMissingCliError(missing: MissingCli[]): string {
  const lines = missing.map(m => `  • ${m.provider}: "${m.bin}" not found on PATH — ${m.hint}`);
  return [
    `Cannot start competition: ${missing.length === 1 ? 'a required agent CLI is' : 'required agent CLIs are'} not installed.`,
    ...lines,
    'Arena drives the agent CLIs you already have installed — either install the above, or pick teams that use a provider you do have.',
  ].join('\n');
}
