/**
 * Shared spawn recipe for every HELPER stage that shells out to `claude`
 * (judge, presentations, synthesis, forge, commentary, brief intake/generation,
 * persona generation).
 *
 * Helpers only need text in and text/JSON out, but their prompts embed
 * agent-written files, so a prompt injection in a deliverable must not be able
 * to do anything. Competitor agents are launched elsewhere (src/adapters) and
 * keep their broad permissions on purpose; do not use this for them.
 *
 * Any new stage that spawns `claude` as a helper must build its args with
 * `helperClaudeArgs()` and its env with `helperClaudeEnv()`.
 */

export interface HelperArgsOptions {
  /** Pinned model id (resolveStageModel() / resolveJudgeModel()). */
  model: string;
}

/**
 * CLI arguments for a tool-less, non-interactive helper. Prompt goes on stdin.
 *
 *  --tools ""                 no built-in tools at all (no Bash, Write, Read, WebFetch...)
 *  --permission-mode dontAsk  anything that would still prompt is denied, never approved
 *  --strict-mcp-config        with no --mcp-config: load no MCP servers
 *  --disable-slash-commands   no skills / commands
 *
 * Deliberately NOT passed: --dangerously-skip-permissions.
 */
export function helperClaudeArgs({ model }: HelperArgsOptions): string[] {
  return [
    '--print', '-',
    '--output-format', 'text',
    '--model', model,
    '--tools', '',
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--disable-slash-commands',
  ];
}

/** Exact names the CLI needs to start and find its login. */
const ALLOW_EXACT: ReadonlySet<string> = new Set([
  // process basics / where the login lives (keychain or ~/.claude)
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME',
  // Windows equivalents
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec', 'PATHEXT',
  // locale / terminal
  'TERM', 'LANG', 'TZ', 'NO_COLOR',
  // corporate proxy + custom trust roots
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
]);

/** Vendor namespaces: ANTHROPIC_API_KEY / AUTH_TOKEN / BASE_URL, CLAUDE_CONFIG_DIR, CLAUDE_CODE_OAUTH_TOKEN, ... */
const ALLOW_PREFIXES: readonly string[] = ['ANTHROPIC_', 'CLAUDE_', 'LC_'];

/** Inside an allowed namespace but must still be dropped. */
const BLOCK_EXACT: ReadonlySet<string> = new Set([
  // a nested claude refuses to start under these
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT',
  // CLAUDE_BIN is read by the orchestrator, not by the CLI
  'CLAUDE_BIN',
]);

const BLOCK_PREFIXES: readonly string[] = [
  'ARENA_', 'CLAUDE_BG_', 'CLAUDE_BRIDGE_', 'CLAUDE_CODE_IDE_',
];

function truthy(v: string | undefined): boolean {
  const s = (v ?? '').trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false';
}

/**
 * Allowlisted environment for a helper `claude` process. Everything else in the
 * operator's shell (DATABASE_URL, ARENA_API_KEY, other providers' keys, cloud
 * credentials, SSH agent sockets, GitHub tokens...) stays out of reach.
 * AWS_* / GOOGLE_* / CLOUD_ML_REGION travel only when the operator has turned
 * on Bedrock / Vertex, since Claude Code then authenticates with them.
 */
export function helperClaudeEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const prefixes = [...ALLOW_PREFIXES];
  if (truthy(source['CLAUDE_CODE_USE_BEDROCK'])) prefixes.push('AWS_');
  if (truthy(source['CLAUDE_CODE_USE_VERTEX'])) prefixes.push('GOOGLE_', 'CLOUD_ML_REGION');
  return filterEnv(source, prefixes);
}

/** Vendor namespaces for the non-claude judge CLIs (same families the sandbox forwards). */
const OTHER_PROVIDER_PREFIXES: Record<'codex' | 'gemini', readonly string[]> = {
  codex: ['OPENAI_', 'CODEX_', 'AZURE_OPENAI_', 'LC_'],
  gemini: ['GEMINI_', 'GOOGLE_', 'GCLOUD_', 'CLOUDSDK_', 'LC_'],
};

/**
 * Allowlisted environment for ANY helper CLI, by provider. The judge can run on
 * codex or gemini as well as claude, and those read untrusted deliverables too:
 * each gets the process basics plus its own vendor's namespace and nothing else.
 */
export function helperEnv(
  provider: 'claude' | 'codex' | 'gemini',
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (provider === 'claude') return helperClaudeEnv(source);
  return filterEnv(source, OTHER_PROVIDER_PREFIXES[provider]);
}

function filterEnv(source: NodeJS.ProcessEnv, prefixes: readonly string[]): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (BLOCK_EXACT.has(key) || BLOCK_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (ALLOW_EXACT.has(key) || prefixes.some((p) => key.startsWith(p))) out[key] = value;
  }
  return out;
}
