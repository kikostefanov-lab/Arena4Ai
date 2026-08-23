/**
 * Environment plumbing for spawned agent CLIs.
 *
 * Two very different situations live in this file:
 *
 *  - `claudeEnv()` — the *host* case. The orchestrator's own helper spawns
 *    (judge, presentations, synthesis, forge, commentary, brief generation)
 *    run as the operator, on the operator's machine, with the operator's
 *    full environment. There is no boundary to defend there; the only thing
 *    that has to go is CLAUDECODE, which makes a nested `claude` refuse to start.
 *
 *  - `sandboxEnv()` — the *container* case. Here the process on the other end
 *    is running model-written code, and every variable handed to it is a
 *    variable a hostile deliverable can read. This one is an ALLOWLIST.
 */

/**
 * Returns a copy of process.env with CLAUDECODE unset,
 * allowing nested `claude` CLI processes to spawn without conflict.
 *
 * Host-side use only. For a sandboxed agent, pipe the result through
 * `sandboxEnv()` — see the note above.
 */
export function claudeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['CLAUDECODE'];
  return env;
}

/** Providers we know how to build a sandbox environment for. */
export type SandboxProvider = 'claude' | 'codex' | 'gemini';

/**
 * Variables every CLI needs regardless of provider.
 *
 * Deliberately absent: PATH, HOME, USER, SHELL, TMPDIR. Those describe the
 * *host* filesystem. Forwarding the host PATH into the container is not just
 * a leak, it is a bug — Docker resolves the container's command against the
 * PATH it is given, so a host PATH means `claude` is looked for in
 * /opt/homebrew/bin inside an image that installed it under /usr/local/bin.
 * Letting the image's own values stand is both safer and more correct.
 */
const BASE_ALLOW: readonly string[] = [
  // locale / terminal — affects formatting only
  'TERM', 'LANG', 'LC_ALL', 'TZ', 'NO_COLOR',
  // egress through a corporate proxy; all three CLIs read these
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  // custom trust roots, for a TLS-inspecting proxy
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
];

/**
 * Per-provider namespaces.
 *
 * Prefixes rather than an exhaustive name list on purpose: each CLI reads
 * dozens to hundreds of variables inside its own namespace (`strings` on
 * claude 2.1.241 turns up 70+ ANTHROPIC_* alone), and any fixed list would
 * silently break somebody's Bedrock/Vertex/proxy setup on the next CLI
 * release. The namespaces below are owned by the vendor, so nothing of the
 * operator's leaks through them.
 */
const PROVIDER_PREFIXES: Record<SandboxProvider, readonly string[]> = {
  claude: ['ANTHROPIC_', 'CLAUDE_'],
  codex:  ['OPENAI_', 'CODEX_', 'AZURE_OPENAI_'],
  gemini: ['GEMINI_', 'GOOGLE_', 'GCLOUD_', 'CLOUDSDK_'],
};

/**
 * Names that are inside an allowed namespace but must still be dropped.
 *
 * Two kinds:
 *  1. Host paths. The container cannot see them, and forwarding a path that
 *     does not resolve makes a CLI fail hard instead of falling back to the
 *     API key it *was* given.
 *  2. Handles to the operator's own machine — loopback sockets, IDE ports,
 *     bearer tokens for a local bridge. Precisely what a sandbox exists to
 *     keep away from model-written code.
 */
const BLOCKED_EXACT: ReadonlySet<string> = new Set([
  // nested-session markers — a claude inside a claude refuses to start
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT',
  // host config paths
  'CLAUDE_CONFIG_DIR', 'ANTHROPIC_CONFIG_DIR', 'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'ANTHROPIC_UNIX_SOCKET',
  'CODEX_HOME',
  'GEMINI_CLI_HOME', 'GEMINI_SYSTEM_MD', 'GEMINI_PROJECT_DIR',
  'GEMINI_CLI_SYSTEM_SETTINGS_PATH', 'GEMINI_CLI_TRUSTED_FOLDERS_PATH',
  'GOOGLE_APPLICATION_CREDENTIALS',
  // "you are already inside a sandbox" flags — set by codex/gemini for their
  // own children. Forwarded, they make the CLI try to nest another sandbox
  // (gemini) or believe network is disabled (codex).
  'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'SEATBELT_PROFILE',
  'GEMINI_SANDBOX', 'GEMINI_SANDBOX_IMAGE', 'GEMINI_SANDBOX_PROXY_COMMAND',
  'SANDBOX', 'SANDBOX_ENV', 'SANDBOX_FLAGS', 'SANDBOX_MOUNTS', 'SANDBOX_PORTS',
]);

/**
 * Namespaces that never cross the boundary, even when they sit under an
 * allowed prefix. `ARENA_` is listed for the record — DATABASE_URL and
 * ARENA_API_KEY are already outside every allowed prefix, but stating it
 * here means widening a prefix later cannot quietly re-expose them.
 */
const BLOCKED_PREFIXES: readonly string[] = [
  'ARENA_',
  'CLAUDE_BG_',       // rendezvous socket + socket-token paths on the host
  'CLAUDE_BRIDGE_',   // base URL + OAuth token for a host-local bridge
  'CLAUDE_CODE_IDE_',
  'GEMINI_CLI_IDE_',  // IDE server port + auth token, on loopback
];

/** Never forwarded, full stop. Redundant with the rules above, kept explicit. */
const NEVER_FORWARD: readonly string[] = ['DATABASE_URL', 'ARENA_API_KEY'];

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false';
}

/**
 * Extra namespaces unlocked only by an explicit opt-in already present in the
 * operator's environment.
 *
 * Claude Code on Bedrock authenticates with the ambient AWS credentials, so
 * AWS_* genuinely has to travel — but only when the operator has actually
 * turned Bedrock on. Same shape for Vertex.
 */
function conditionalPrefixes(provider: SandboxProvider, source: NodeJS.ProcessEnv): string[] {
  if (provider !== 'claude') return [];
  const extra: string[] = [];
  if (isTruthy(source['CLAUDE_CODE_USE_BEDROCK'])) extra.push('AWS_');
  if (isTruthy(source['CLAUDE_CODE_USE_VERTEX'])) extra.push('GOOGLE_', 'CLOUD_ML_REGION');
  return extra;
}

/**
 * Map the binary about to be executed onto a provider.
 * Returns null for anything unrecognised — the caller then forwards the base
 * set only, which is the fail-closed direction.
 */
export function resolveSandboxProvider(command: string): SandboxProvider | null {
  const base = (command.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  if (!base) return null;
  const providers: SandboxProvider[] = ['claude', 'codex', 'gemini'];
  // Exact first, then a substring pass so CLAUDE_BIN=/usr/local/bin/claude-wrapper
  // (or gemini-cli, codex-rs, …) still resolves rather than silently failing closed.
  return providers.find((p) => base === p) ?? providers.find((p) => base.includes(p)) ?? null;
}

/**
 * Build the environment handed to a sandboxed agent CLI.
 *
 * Allowlist, not denylist: a variable is forwarded only if it is in the base
 * set or inside the chosen provider's own namespace, and is not blocked.
 * Everything else — the operator's DATABASE_URL, ARENA_API_KEY, cloud
 * credentials for providers not in play, SSH agent sockets, whatever else
 * happens to be exported in the shell that launched the orchestrator — stays
 * on the host.
 */
export function sandboxEnv(
  provider: SandboxProvider | null,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowedPrefixes = provider
    ? [...PROVIDER_PREFIXES[provider], ...conditionalPrefixes(provider, source)]
    : [];
  const baseAllow = new Set(BASE_ALLOW);
  const never = new Set(NEVER_FORWARD);

  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (never.has(key)) continue;
    if (BLOCKED_EXACT.has(key)) continue;
    if (BLOCKED_PREFIXES.some((p) => key.startsWith(p))) continue;

    const allowed = baseAllow.has(key) || allowedPrefixes.some((p) => key.startsWith(p));
    if (allowed) out[key] = value;
  }
  return out;
}
