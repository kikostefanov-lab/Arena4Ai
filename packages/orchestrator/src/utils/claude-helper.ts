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

import { codexIsolationArgs, geminiIsolationArgs, isInjectingEnvVar } from '../adapters/isolation.js';
import { isOperatorHandleEnvVar } from './claude-env.js';

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

/**
 * Codex features that hand the model a tool. Each is turned off for a helper,
 * so the judge reads the prompt and answers, nothing else. Names verified
 * against `codex features list` on codex-cli 0.169.0; an unknown name makes
 * codex refuse to start ("Unknown feature flag"), which the judge reports as
 * a cli-error, so a rename is loud rather than silently re-enabling a tool.
 *
 * unified_exec is not here: codex 0.169 keeps it on whatever the flag says.
 * It is the shell tool's back end, and with shell_tool off no shell is offered.
 */
export const CODEX_HELPER_DISABLED_FEATURES: readonly string[] = [
  'shell_tool', 'apps', 'plugins', 'browser_use', 'computer_use',
  'in_app_browser', 'view_image', 'multi_agent',
];

export interface ProviderHelperArgsOptions {
  /** Model id, or CLI_DEFAULT_MODEL: the caller resolves which (no flag then). */
  modelArgs: string[];
  /** Empty scratch directory the CLI runs in; it holds nothing to read. */
  workdir: string;
}

/**
 * `codex exec` as a tool-less helper. The prompt is appended by the caller.
 *
 *  --ignore-user-config     no MCP servers, plugins or hooks from config.toml (auth still works)
 *  --ignore-rules           no execpolicy .rules files
 *  --ephemeral              no session files written
 *  -s read-only             defence in depth: even a tool could not write
 *  -C <workdir>             an empty scratch directory, not the orchestrator's cwd
 *  web_search="disabled"    no web tool
 *  --disable <feature>      every other tool family (CODEX_HELPER_DISABLED_FEATURES)
 */
export function helperCodexArgs({ modelArgs, workdir }: ProviderHelperArgsOptions): string[] {
  return [
    'exec', '--skip-git-repo-check',
    ...codexIsolationArgs(),
    '--ignore-rules', '--ephemeral', '--color', 'never',
    '-s', 'read-only',
    '-C', workdir,
    '-c', 'web_search="disabled"',
    ...CODEX_HELPER_DISABLED_FEATURES.flatMap((f) => ['--disable', f]),
    ...modelArgs,
  ];
}

/**
 * Gemini admin-tier policy that denies every tool, built-in and MCP alike.
 * Admin is the highest tier, so no user, workspace or extension policy can
 * re-allow one; `--approval-mode plan` (the old judge setting) still allowed
 * read and search tools, and swapped in a planning system prompt.
 */
export const GEMINI_DENY_ALL_POLICY = `# Arena helper: no tools at all.
[[rule]]
toolName = "*"
decision = "deny"
priority = 999
denyMessage = "Arena helpers run without tools."

[[rule]]
toolName = "*"
mcpName = "*"
decision = "deny"
priority = 999
denyMessage = "Arena helpers run without tools."
`;

/**
 * `gemini` as a tool-less helper. The caller writes GEMINI_DENY_ALL_POLICY to
 * `policyPath` and spawns in `workdir` with GEMINI_CLI_TRUST_WORKSPACE=true
 * (gemini-cli 0.68 refuses an untrusted folder headless; the scratch directory
 * is Arena's own and empty).
 *
 *  -o json                  one JSON object: the answer in `response`, and the
 *                           model that actually ran in `stats.models`
 *  --admin-policy <file>    deny every tool (see GEMINI_DENY_ALL_POLICY)
 *  --extensions none / --allowed-mcp-server-names arena-none   no extensions, no MCP servers
 */
export function helperGeminiArgs(
  prompt: string,
  { modelArgs, policyPath }: { modelArgs: string[]; policyPath: string },
): string[] {
  return [
    '-p', prompt,
    '-o', 'json',
    '--admin-policy', policyPath,
    ...geminiIsolationArgs(),
    ...modelArgs,
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
 * Inside that namespace, variables that inject settings or MCP servers
 * (GEMINI_CLI_SYSTEM_SETTINGS_PATH...) and handles to the operator's machine
 * (GEMINI_CLI_IDE_*) are dropped too.
 */
export function helperEnv(
  provider: 'claude' | 'codex' | 'gemini',
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (provider === 'claude') return helperClaudeEnv(source);
  const out = filterEnv(source, OTHER_PROVIDER_PREFIXES[provider]);
  for (const key of Object.keys(out)) {
    if (isInjectingEnvVar(key) || isOperatorHandleEnvVar(key)) delete out[key];
  }
  return out;
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
