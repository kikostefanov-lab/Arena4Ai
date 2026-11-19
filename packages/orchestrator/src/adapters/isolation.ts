/**
 * Competitor isolation: a competitor agent sees only its CLI's built-in tools
 * and built-in sub-agent types. Not the operator's MCP servers (mail, drive,
 * home automation, ERP...), plugins, hooks or custom agents. The login and the
 * file / shell / web permissions inside the workdir are untouched.
 *
 * These are appended by each adapter before its model flag. Helper stages are
 * not affected (they use helperClaudeArgs()).
 *
 * Verified 2026-11-18 on claude 2.1.325, codex-cli 0.169.0, gemini-cli 0.68.0
 * with `npx tsx packages/orchestrator/src/dev/isolation-smoke.ts`:
 *
 * Claude
 *   `--strict-mcp-config --setting-sources project`  KEPT. Without them the init
 *     line showed 212 tools (180 mcp__), 32 agents, 8 hooks; with them 28 tools
 *     (0 mcp__), built-in agents only, 0 hooks, and the login still works
 *     (is_error false). User-scope settings are what carry plugins, hooks and
 *     custom agents, so dropping the `user` source removes them; the login is
 *     in the keychain, not in a setting source.
 *   `--strict-mcp-config` alone: 0 mcp__ tools, but plugin agents and hooks stay.
 *   `--bare`: NOT used; it skips keychain reads, so it hides the OAuth login.
 *   `--disable-slash-commands`: not needed for isolation (skills are not tools
 *     of the operator's accounts); left off to keep built-in skills.
 *
 * Codex
 *   `--ignore-user-config`  KEPT. Skips $CODEX_HOME/config.toml (MCP servers,
 *     plugins, hooks live there); auth still uses CODEX_HOME, run succeeded and
 *     the rmcp auth errors on stderr disappeared.
 *   `-c mcp_servers={}`: REJECTED as insufficient. Accepted, but the rmcp
 *     startup error still appeared on stderr, so servers still loaded.
 *   The adapter's own `-c` overrides (sandbox, web_search, thread cap) are
 *   passed explicitly, so they do not depend on the user config.
 *
 * Gemini
 *   `--extensions none`  KEPT: accepted, run succeeded with status "success".
 *   `--allowed-mcp-server-names arena-none`  KEPT: restricts settings.json MCP
 *     servers to a name nothing uses. Accepted, login intact.
 *   The test machine had no gemini extensions or MCP servers configured, so
 *   for gemini the smoke check proves the flags are accepted and auth works,
 *   not that they removed anything.
 *
 * `--ignore-user-config` makes Codex ignore the operator's config.toml (model
 * defaults, a custom model_provider / base URL), while model-catalog's
 * `codex debug models` probe does not use the flag.
 */

import { claudeEnv, isArenaSecretEnvVar, isOperatorHandleEnvVar } from '../utils/claude-env.js';

export function claudeIsolationArgs(): string[] {
  return ['--strict-mcp-config', '--setting-sources', 'project'];
}

export function codexIsolationArgs(): string[] {
  return ['--ignore-user-config'];
}

export function geminiIsolationArgs(): string[] {
  return ['--extensions', 'none', '--allowed-mcp-server-names', 'arena-none'];
}

/**
 * Environment variables that inject plugins, MCP servers, managed settings or
 * settings files into a competitor's CLI. The server is usually started from
 * inside a Claude Code session, which sets some of these; the flags above do
 * not cover them. Auth variables (CLAUDE_CONFIG_DIR, ANTHROPIC_*, CODEX_HOME,
 * GEMINI_CLI_HOME, API keys) are deliberately NOT here.
 */
const INJECTING_EXACT: readonly string[] = [
  'CLAUDE_CODE_MANAGED_SETTINGS_PATH',
  'GEMINI_CLI_SYSTEM_SETTINGS_PATH',
  'GEMINI_CLI_SYSTEM_DEFAULTS_PATH',
];
const INJECTING_PREFIXES: readonly string[] = ['CLAUDE_CODE_PLUGIN_', 'CLAUDE_CODE_MCP_'];

export function isInjectingEnvVar(name: string): boolean {
  return INJECTING_EXACT.includes(name) || INJECTING_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * The competitor's environment: the host env minus anything that injects extra
 * tools, minus the handles to the operator's machine (IDE ports, local
 * bridges, their tokens) that the sandbox blocklist already names
 * (`isOperatorHandleEnvVar`), and minus the arena's own secrets
 * (`isArenaSecretEnvVar`: DATABASE_URL, ARENA_*, PG*), which a host-run
 * competitor's code could otherwise use to read the arena DB or rewrite its
 * own scores. Auth stays: CLAUDE_CONFIG_DIR, ANTHROPIC_*, CODEX_HOME, OPENAI_*,
 * GEMINI_CLI_HOME, GEMINI_API_KEY / GOOGLE_* and HOME. The squad caps the
 * adapters add on top (CLAUDE_CODE_MAX_*) are set after this filter.
 */
export function competitorEnv(source: NodeJS.ProcessEnv = claudeEnv()): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(source)) {
    if (isInjectingEnvVar(k) || isOperatorHandleEnvVar(k) || isArenaSecretEnvVar(k)) continue;
    out[k] = v;
  }
  return out;
}
