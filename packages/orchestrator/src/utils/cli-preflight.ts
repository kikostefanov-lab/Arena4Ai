import { spawn } from 'node:child_process';
import { isCliDefaultModel } from '@arena/shared';
import { getProviderConfig } from '../adapters/model-registry.js';
import { getProviderCatalog, judgeModel, describeAvailable, type ProviderCatalog } from '../adapters/model-catalog.js';

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

export interface TeamModelRequest {
  teamId: string;
  /** e.g. `codex:standard`, used in the message. */
  label: string;
  provider: string;
  /** Resolved variant; undefined / CLI_DEFAULT_MODEL = the CLI's own default. */
  modelVariant?: string;
}

export interface UnavailableModel extends TeamModelRequest {
  bin: string;
  /** Ids the CLI does offer (may be truncated). */
  available: string;
}

/**
 * Check every team's model against the models its CLI says it offers. Only
 * a definite 'unknown' is reported: when the list could not be read, or for a
 * full Claude id (Claude has no list command), the run goes ahead and any
 * failure is reported by the adapter when the agent exits.
 */
export async function findUnavailableModels(
  teams: TeamModelRequest[],
  overrides: Record<string, string | undefined> = {},
  getCatalog: (provider: string, bin: string) => Promise<ProviderCatalog> =
    (provider, bin) => getProviderCatalog(provider, { bin }),
): Promise<UnavailableModel[]> {
  const catalogs = new Map<string, Promise<ProviderCatalog>>();
  const out: UnavailableModel[] = [];
  for (const team of teams) {
    // The CLI's own default is always runnable; don't spawn a probe for it.
    if (isCliDefaultModel(team.modelVariant)) continue;
    const bin = providerBin(team.provider, overrides);
    if (!catalogs.has(team.provider)) catalogs.set(team.provider, getCatalog(team.provider, bin));
    const catalog = await catalogs.get(team.provider)!;
    if (judgeModel(catalog, team.modelVariant) !== 'unknown') continue;
    out.push({ ...team, bin, available: describeAvailable(catalog) });
  }
  return out;
}

/** Human-readable, actionable message naming each team, its model and the alternatives. */
export function formatUnavailableModelError(bad: UnavailableModel[]): string {
  const lines = bad.map((m) =>
    `  • ${m.label}: model "${m.modelVariant}" is not offered by the installed ${m.bin} CLI. Available: ${m.available}.`);
  return [
    `Cannot start competition: ${bad.length === 1 ? 'a team asks for a model' : 'teams ask for models'} the agent CLI does not offer.`,
    ...lines,
    'Pick a listed model for that agent in the Armory, or set it to "CLI default" so it follows whatever the CLI ships.',
  ].join('\n');
}
