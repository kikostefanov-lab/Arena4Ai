/**
 * Server-side resolution of the dangerous half of RunOptions.
 *
 * NOTHING in here may come from an HTTP request body.
 *
 * The orchestrator is meant to be self-hosted: it listens on a port on someone's
 * machine, and that port may end up reachable by more than its owner. Two knobs
 * make that fatal if a caller controls them:
 *
 *   1. the *binary to spawn* (`claudeBin` & friends) — naming it is arbitrary
 *      code execution as the server user;
 *   2. `skipSandbox` — turning the Docker isolation off puts the agent CLI
 *      straight onto the host filesystem with the host's credentials.
 *
 * So both are resolved here, from the process environment only. The opt-out for
 * local dev still exists (`ARENA_SKIP_SANDBOX=true`), but it is a deliberate act
 * by whoever starts the server — not something a request can ask for.
 */

export interface ResolvedRunOptions {
  skipSandbox: boolean;
  claudeBin?: string;
  codexBin?: string;
  geminiBin?: string;
  logDir?: string;
}

function envFlag(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}

/** True only when the operator explicitly set ARENA_SKIP_SANDBOX=true. */
export function skipSandboxFromEnv(): boolean {
  return envFlag(process.env.ARENA_SKIP_SANDBOX);
}

/**
 * Build the execution-related RunOptions for an HTTP-triggered run.
 * Read fresh on every call so tests (and `.env` reloads) see the current values.
 */
export function resolveRunOptions(): ResolvedRunOptions {
  return {
    skipSandbox: skipSandboxFromEnv(),
    claudeBin: process.env.CLAUDE_BIN,
    codexBin: process.env.CODEX_BIN,
    geminiBin: process.env.GEMINI_BIN,
    logDir: process.env.ARENA_LOG_DIR,
  };
}

/**
 * Team ids end up in temp directory names and container names, so they must not
 * be able to escape a path segment or carry shell metacharacters.
 */
const TEAM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isSafeTeamId(id: string): boolean {
  return TEAM_ID_RE.test(id);
}
