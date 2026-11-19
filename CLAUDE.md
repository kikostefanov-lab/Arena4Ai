# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Arena4Ai — competitive AI orchestration platform. Two (or more) AI agents race to solve a structured brief, then a cross-judge scores their deliverables. Supports Claude, Codex, and Gemini.

## Running the Stack

### Prerequisites (one-time setup)

```bash
# Uses local Homebrew PostgreSQL — Docker NOT required for dev
createdb arena
cp .env.example packages/web/.env.local
# Run all migrations
DATABASE_URL=postgresql://localhost/arena npm run db:migrate --workspace=packages/orchestrator
```

Set `NEXT_PUBLIC_WS_URL=ws://localhost:3000` in `packages/web/.env.local`.

### Running

```bash
# API server (port 3000). Without Docker, ARENA_SKIP_SANDBOX=true is required or every
# web-launched match fails with "Docker is not installed".
DATABASE_URL=postgresql://localhost/arena ARENA_SKIP_SANDBOX=true \
  npx tsx packages/orchestrator/src/cli.ts serve --port 3000

# Web UI (port 3001) — separate terminal
cd packages/web && npm run dev

# Single competition (no sandbox, dev mode) — DATABASE_URL required to appear in dashboard
DATABASE_URL=postgresql://localhost/arena npx tsx packages/orchestrator/src/cli.ts run briefs/fizzbuzz-cli.yml \
  --team-a claude:architect --team-b gemini:speedrunner \
  --skip-sandbox --log-dir /tmp/arena-logs --time-limit 120000

# With live AI commentary
npx tsx packages/orchestrator/src/cli.ts run briefs/fizzbuzz-cli.yml \
  --team-a claude:architect --team-b claude:speedrunner \
  --skip-sandbox --commentary

# With specific model variants
DATABASE_URL=postgresql://localhost/arena npx tsx packages/orchestrator/src/cli.ts run briefs/fizzbuzz-cli.yml \
  --team-a claude:architect --model-a opus \
  --team-b codex:speedrunner \
  --skip-sandbox --time-limit 120000

# Round-robin tournament (all pairs compete)
npx tsx packages/orchestrator/src/cli.ts tournament run briefs/fizzbuzz-cli.yml \
  --teams claude:architect,claude:speedrunner,codex:standard \
  --models opus,sonnet,cli-default \
  --skip-sandbox

# Re-evaluate completed competitions (stages: judge | presentation | synthesis | all)
# Archives the previous results to results_history before overwriting.
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts re-evaluate --all --stage judge

# Seed quality signals from existing competitions
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts seed-quality-signals
```

### Auth and network exposure
- `serve` binds to `127.0.0.1`; `--host` / `ARENA_HOST` widens it (with a startup warning if no key is set).
- `ARENA_API_KEY` unset = nothing is authenticated (local dev). Set = EVERY orchestrator route
  needs `Authorization: Bearer <key>` except `/health`, reads included.
- The web app's proxy routes attach the key server-side via `orchestratorHeaders()` from
  `packages/web/lib/orchestrator.ts`. Always use that helper (and `orchestratorUrl()`) in
  `app/api/` routes, GETs too: a route without it returns 401 as soon as a key is set, and a
  test fails if one forgets.
- The WebSocket stream needs the key or a 60-second ticket (`server/stream-ticket.ts`,
  `GET /competitions/:id/stream-ticket`). The browser gets tickets through
  `packages/web/lib/stream-url.ts`; never send the key to a browser.
- Browser origins: the API refuses any `Origin` that is not loopback or in
  `ARENA_ALLOWED_ORIGINS`; `packages/web/middleware.ts` refuses cross-site writes to `/api/*`.

### Helper stages run tool-less
Every HELPER spawn of an agent CLI (judge, presentations, synthesis, forge, commentary, brief
intake/generation, persona generation) reads untrusted deliverables, so it must build its args
with `helperClaudeArgs()` and its env with `helperClaudeEnv()` / `helperEnv(provider)` from
`packages/orchestrator/src/utils/claude-helper.ts`: no tools, no MCP, an allowlisted
environment. Never pass `--dangerously-skip-permissions` to a helper. Competitor agents
(`src/adapters/`) keep broad permissions by design.
Codex and Gemini judges use `helperCodexArgs()` / `helperGeminiArgs()` from the same file: codex
runs `--ignore-user-config`, read-only, web search off, every tool-bearing feature disabled
(`CODEX_HELPER_DISABLED_FEATURES`) and on a copy of its model catalog with the per-model tool
fields neutralised (`CODEX_TOOL_LESS_MODEL_FIELDS`, `-c model_catalog_json`); it runs with
`--json`, and any tool item in the stream fails that judge closed (`bad-output`). Check with
`npx tsx packages/orchestrator/src/dev/codex-judge-tool-probe.ts`, which renders the offered tools
(`codex debug prompt-input`; only `request_user_input` should remain). Gemini runs under an admin-tier deny-all policy
(`GEMINI_DENY_ALL_POLICY`) with no extensions or MCP servers. Every judge runs in an empty
scratch directory, never the orchestrator's checkout.

### Agent-written paths
A workdir is written by model code, which can plant a FIFO, a device or a symlink, or swap one in
after a directory listing. Anything that reads a workdir (the collector, the watcher) must lstat,
skip non-regular files, and read through `readRegularFile()` / `readRegularFileSync()` in
`adapters/safe-read.ts` (O_NOFOLLOW | O_NONBLOCK, fstat on the fd, size cap, fd closed in finally).

### Competitor environment
`competitorEnv()` (`adapters/isolation.ts`) is what a host-run competitor (`ARENA_SKIP_SANDBOX=true`)
gets. It drops the arena's own secrets (`DATABASE_URL`, `ARENA_*`, `PG*`; the shared list in
`utils/claude-env.ts`, which the sandbox path uses too), plugin/MCP-injecting variables and
handles to the operator's machine. Provider auth and the squad caps survive.

### Agent processes
Agents are spawned `detached` (own process group). The runner shuts every adapter down at the
deadline BEFORE collecting files, cancellation is terminal (`CompetitionCancelledError`), and
`cli.ts` installs SIGINT/SIGTERM handlers that call `shutdownAllAdapters()`. Any new entry
point that runs competitions must do the same, or Ctrl-C will leave agents running.

### Agent squads (sub-agents)
Competitor CLIs may spawn their own sub-agents; Arena records and draws them as robots.
- **Event contract** (`@arena/shared` `types/event.ts`): `SUB_AGENT_SPAWN` (`agentId`, `label`,
  `description`, `kind?`, `model?`, `background?`, `depth`) and `SUB_AGENT_DONE` (`agentId`,
  `status: completed|failed|killed|unknown`, `reason?`, `summary?`, `usage?`). `metadata.agentId`
  attributes any event to its sub-agent (absent = the lead). `metadata.squad: true` marks a file
  written while a squad was open when the member is unknown. `capabilityFor(model)` carries
  `subagentAttribution` and `subagentLifecycle` per provider.
- **Lifecycle closure rule:** every spawn gets a DONE. At shutdown `closeOpenSubAgents()` emits
  `killed` / `unknown` DONEs for anything still open, so no robot is left standing.
- **Workdir watcher** (`adapters/workdir-watcher.ts`): polls the workdir for files the stream
  never reports (sub-agents write straight to disk) and emits file events with
  `opSource: 'watch'`. It is evidence of a file, not of who wrote it, so it never makes a
  team's heights `measured`: a team whose every file came from the watcher is drawn `inferred`
  with its own legend note ("files observed on disk; the CLI did not report its edits"). It
  polls every 2 s, skips binaries, caps one scan at 5,000 files, and flushes once more at
  shutdown so files from the final seconds still appear.
- **Limits:** 6 concurrent sub-agents and depth 1 per team (`ARENA_SQUAD_MAX_CONCURRENT`,
  `ARENA_SQUAD_MAX_DEPTH`, `adapters/squad-limits.ts`), told to the agent by a `[SQUAD]` prompt block.
- **Isolation:** competitors see only their CLI's built-ins (`adapters/isolation.ts`): Claude
  `--strict-mcp-config --setting-sources project`, Codex `--ignore-user-config`, Gemini
  `--extensions none --allowed-mcp-server-names arena-none`, plus a scrub of plugin/MCP-injecting
  env vars. Login and workdir permissions are untouched. `dev/isolation-smoke.ts` re-checks it.
- **Codex** now runs `codex exec --json` with network access, `web_search=live`, multi-agent V1
  pinned (`features.multi_agent_v2=false`, whose collab tools expose receiver ids) and
  `agents.max_concurrent_threads_per_session` set to the squad cap.
- **Leaderboard** credits the lead agent's model, not its sub-agents'.
- **Demo:** `npx tsx packages/orchestrator/src/dev/seed-squad-demo.ts [--brief file.yml]` seeds a
  COMPLETE three-team match titled "[DEMO] Squads — synthetic replay" from the committed fixtures
  (real normalizers, re-timed, replayed several times) and prints its id. Synthetic: not a result. Its brief is tagged `synthetic-demo` (`isSyntheticCompetition()`
  in `@arena/shared`); leaderboard, analytics, compare, criteria and `seed-quality-signals` skip it.
  `seed-squad-demo.ts --remove` deletes every synthetic competition and nothing else.

## Tests

```bash
npm run test --workspace=packages/orchestrator
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

## Monorepo Structure

```
packages/
  shared/       @arena/shared       — types, Zod schemas, EventType/CompetitionState enums
  orchestrator/ @arena/orchestrator — engine, adapters, judging, HTTP API, CLI
  web/          @arena/web          — Next.js 14 App Router UI (port 3001)
  video/        @arena/video        — Remotion reels + sizzle (see packages/video/CLAUDE.md)
briefs/         — YAML brief files (fizzbuzz-cli.yml, roman-numerals.yml, etc.)
```

## Key Architecture

### Competition lifecycle
`DRAFT → CONFIGURED → LAUNCHING → RUNNING → TIME_UP → COLLECTING → PRESENTING → JUDGING → SCORED → COMPLETE`
Human-triggered post-completion: `COMPLETE → FORGING → FORGE_COMPLETE`
Synthesis is not automatic — it is triggered manually via `POST /competitions/:id/synthesis`.
Also terminal states: `FAILED`, `CANCELLED`

### Adapters
All adapters extend `BaseAdapter`: `injectBrief`, `collectDeliverables` (recursive walk, 500KB/file, 5MB total), `shutdown`, `cleanupWorkdir`, `done`. Subclasses implement only `startExecution()`.

The brief injection includes `[COMPETITION RULES]` telling agents they are autonomous — no human to interact with, no clarifying questions, make assumptions and start working immediately.

Model routing in `competition-runner.ts` (prefix before `:`):
- `claude:*` → ClaudeAdapter
- `codex:*`  → CodexAdapter
- `gemini:*` → GeminiAdapter

### CLI flags (critical — wrong flags = broken agent)
The source of truth is the code: `claudeArgs` in `claude-adapter.ts`, `codexArgs()` in
`codex-adapter.ts`, the gemini args in `gemini-adapter.ts`, and `adapters/isolation.ts`. Shape:
- **Claude**: `claude --print - --output-format stream-json --verbose --dangerously-skip-permissions --strict-mcp-config --setting-sources project [--model <m>]` (prompt on stdin)
- **Codex**: `codex exec --json --skip-git-repo-check -s workspace-write --ignore-user-config -c features.multi_agent_v2=false -c sandbox_workspace_write.network_access=true -c web_search=live -c agents.max_concurrent_threads_per_session=<cap> [-m <m>] <prompt>` (`-s workspace-write` required)
- **Gemini**: `gemini -p <prompt> --yolo -o stream-json --extensions none --allowed-mcp-server-names arena-none [--model <m>]` (`--yolo` required — auto-approves tool calls)

### HTTP API (Express, port 3000)
- `POST /competitions` — start competition → `{ competitionId }`; body `{ brief, teams, adversarialJudge?, judgePanel?, options?: { commentary } }`
- `GET /competitions/:id` — status snapshot
- `GET /competitions/:id/events` — event list (DB-backed)
- `WS ws://localhost:3000/competitions/:id/stream` — live event stream
- `POST /competitions/:id/re-judge` — re-judge a completed competition in adversarial mode (averages scores)
- `POST /tournaments` — create round-robin tournament → `{ tournamentId }`
- `GET /tournaments/:id` — tournament status + standings
- `GET /leaderboard` — aggregate win rates per model
- `GET /analytics/summary` — competition stats
- `GET /models` — `{ providers: ProviderConfig[] }` with presets + `allowCustom: true`
- `POST /competitions/:id/forge` — trigger forge (requires COMPLETE/FORGE_COMPLETE state); body: `{ source: 'winner'|'loser'|'synthesis' }`
- `GET /competitions/:id/forge` — get forge runs → `{ status: 'forging'|'complete'|'idle', runs: ForgeRun[] }`
- `GET /competitions/:id/forge/:runId/download` — download full forge run as ZIP
- `GET /competitions/:id/forge/:runId/artifacts/:type/download` — download single artifact (raw file with correct Content-Type)
- `POST /competitions/:id/synthesis` — trigger on-demand synthesis (202 async, requires COMPLETE state)
- `GET /competitions/:id/synthesis` — synthesis status
- `GET /competitions/:id/deliverables/:teamId/download` — ZIP of team deliverables
- `POST /generate-brief/intake` — domain detection + clarifying questions
- `POST /generate-brief/generate` — domain-aware brief generation with answers
- `POST /generate-brief/quality` — brief quality heuristic check
- `POST /generate-brief` — legacy single-shot (chains intake + generate)
- `GET /briefs` — DB-backed brief library
- `POST /briefs` — save brief to library
- `PUT /briefs/:id` — update library brief
- `DELETE /briefs/:id` — remove (YAML-sourced briefs protected, returns 403)
- `GET /health`

Rate limiting: 10/min on `POST /competitions`; 5/min on `POST /competitions/:id/forge` and `POST /competitions/:id/synthesis`; 20/min on `POST /generate-brief`.

### Model catalog, variants & pinning
Model ids go stale every time a provider ships, so **the installed CLIs are the source of truth**,
not a hand-kept list. `packages/orchestrator/src/adapters/model-catalog.ts` asks each CLI what it
offers (cached 10 min; `GET /models` serves it to every picker):
- **Codex**: `codex debug models` (JSON; listed models in the CLI's priority order)
- **Gemini**: `gemini --list-models` (gemini-cli 0.68 prints it to stderr; colours are stripped)
- **Claude**: no list command; offers the aliases `opus` / `sonnet` / `haiku` / `fable`, which
  always resolve to the latest model of that family, plus the few full ids in `model-registry.ts`
When a probe fails, the static presets in `model-registry.ts` are used and nothing is rejected.

**`cli-default`** (`CLI_DEFAULT_MODEL` in `@arena/shared`) means "pass no model flag". It is the
default for every provider and what system agents are seeded with, because the CLI's own default
cannot go stale. Never hardcode a codex/gemini id anywhere. On startup (server and CLI `run`),
`repairStaleSystemAgents()` moves any SYSTEM agent whose model the CLI does not list back to
`cli-default`; user-created agents are left alone.

**Pre-launch model check** — after the CLI preflight, `findUnavailableModels()` refuses to start a
team whose model its CLI does not list (`ERROR` event, `stage: 'preflight'`,
`kind: 'model-unavailable'`), naming the alternatives. Full Claude ids can't be verified offline,
so they pass and any failure surfaces as an agent crash (below).

Each provider entry also carries `bin` + `installHint`, used by the CLI preflight check.

**Competitor variants** — `Team.modelVariant?: string` flows through the competition runner to
adapter CLI args (Claude `--model`, Codex `-m`, Gemini `--model`). Resolution priority:
explicit `team.modelVariant` (CLI flag) > `agent.modelVariant` (DB) > undefined (CLI default).
CLI: `--model-a`…`--model-d` for `run`, `--models` comma-list for `tournament`. The
AgentBuilder UI offers a preset dropdown + freeform custom id.

**Judge pinning** — the judges are the one place a full id is deliberate: `DEFAULT_JUDGE_MODEL` (`claude-opus-5`) and `DEFAULT_ADVERSARIAL_JUDGE_MODEL`
(`claude-sonnet-5`) pin the judge so scores stay comparable across time, and so
`--adversarial-judge` is a genuinely different model rather than the same model with a
different prompt. Override per-run with `ARENA_JUDGE_MODEL` / `ARENA_ADVERSARIAL_JUDGE_MODEL`
(useful when reproducing an old score). Those two apply to Claude judges only: the Codex and
Gemini judges of the cross-vendor panel run on `cli-default` unless `ARENA_JUDGE_MODEL_CODEX` /
`ARENA_JUDGE_MODEL_GEMINI` names a model, and `AiJudgeResult.model` records the model the CLI
ran on: gemini's `-o json` stats, or for codex the catalog default the judge pins with `-m`
(codex's `--json` stream does not name its model).

**Stage pinning** — every other `claude` call (synthesis, presentations, commentary, forge,
brief intake/generation) passes `--model resolveStageModel()` (`DEFAULT_STAGE_MODEL`,
override with `ARENA_STAGE_MODEL`). New LLM-calling stages must do the same — an unpinned
stage inherits whatever the CLI defaults to that week.

### Agent crashes
An agent CLI that exits non-zero before the deadline (bad model, expired login, rate limit,
untrusted folder) sets `adapter.failure` and emits an `ERROR` event with `stage: 'agent'` and the
CLI's own message (`summarizeAgentError()`; Claude's stream-json errors are read from stdout).
If it produced no files, the team is **not judged**: its scorecard carries `agentFailure`, ranks
last at 0, and the UI shows "did not compete" / DNC. Agent stats and quality signals are skipped
for that match. If every agent crashed, the competition ends `FAILED`. Never infer a crash from a
zero score; branch on `agentFailure`.

### Judging pipeline
1. **AI cross-judge** (`ai-judge.ts`) — PRIMARY scorer. Claude (or, with the panel, Claude + Codex + Gemini) reads actual deliverables and scores against rubric criteria.
2. **Automated scorer** (`rubric-scorer.ts`) — FALLBACK only, per-team when the AI judge fails. Executes deliverables (`.py`/`.js`/`.rb`/`.sh` via stdin, `.ts` via tsx temp file); 100KB input / 512KB stdout / 10s timeout limits. Otherwise it scores completeness only (named `brief.deliverables` present and not placeholders), capped at `HEURISTIC_CEILING` (50%), and sets `heuristic: true`; the UI labels those scores. Never treat length as quality there.
3. **Aggregation** (`score-aggregator.ts`) — weighted average; tie-breaking within 0.005 tolerance. Only AI judge scores are aggregated when the AI judge succeeds.
   Limits for big briefs: time limit ceiling 3 h (`brief/parser.ts`); the judge reads up to 24K chars
   per file and 240K in total (`JUDGE_CONTEXT`), named deliverables first; helper timeouts scale with
   input size (`stageTimeoutMs`, 2-10 min); a judge failure of kind timeout / rate-limit / cli-error /
   bad-output is retried once.
4. **Synthesis** (`merge-engine.ts`) — returns `SynthesisResult { synthesis: string, perCriterion[] }` with per-criterion winner attribution. On-demand only.

**Adversarial mode** — `adversarialJudge: true` in the `POST /competitions` body or
`--adversarial-judge` runs standard + adversarial judges. Toggle lives in New Battle →
Advanced; completed competitions have a "Re-judge (adversarial)" button on the Scores tab.

**Cross-vendor judge panel** — `judgePanel: true` in the `POST /competitions` body,
`run --judge-panel`, or New Battle → Advanced "Cross-vendor judge panel". Claude, Codex and
Gemini each judge every team in parallel (same prompt and rubric, one retry each); the panel
replaces the adversarial pair. Each result is stored in `judgeResults` as
`ai-<provider>/<model it ran on>`, `finalScore` is the mean of the judges that succeeded (the same
`aggregate()` averaging and tie tolerance), and `ScoreCard.judgePanel` lists every seat with its
`failure` kind if it dropped out. A failed judge emits an `ERROR` event
`{ stage: 'judging', provider, failure }`; if all three fail, the heuristic fallback applies. The
preflight checks all three CLIs before launch. The Scores tab shows a per-judge row per team
(`judgeBreakdown()` in `@arena/shared`). Re-judge does not use the panel.

### Provider CLI preflight & judge failure reporting
Arena drives the agent CLIs the operator already has installed, so "binary not on PATH"
is the most likely first-run failure — and it must never look like a bad score.
- `packages/orchestrator/src/utils/cli-preflight.ts` — `findMissingClis()` probes each
  provider's binary once (via `<bin> --version`) before `LAUNCHING`. Anything missing
  aborts the run with a message naming the binary and its install hint, and emits an
  `ERROR` event with `payload.stage === 'preflight'`.
- `aiJudge()` returns `AiJudgeResult` = `JudgeResult` + an explicit `failure?: AiJudgeFailure`
  (`cli-missing` | `auth` | `rate-limit` | `model-unavailable` | `timeout` | `cli-error` |
  `bad-output`) and the `model` it ran on. It logs to stderr and rewrites the zero-score
  commentary with the reason. **Never infer judge failure from score values or commentary
  text** — branch on `failure`.
- `competition-runner.ts` uses that field to decide per-team whether to fall back to the
  automated scorer, and emits an `ERROR` event with `payload.stage === 'judging'` for every
  failed judge so a broken setup is visible in the UI and persisted in the event log.

### Presentation layer
After collecting deliverables, `presentation-generator.ts` calls Claude (in parallel per team) to generate human-readable `TeamPresentation` objects that map deliverables back to rubric criteria. This runs BEFORE judging (PRESENTING state).

### The Forge (post-completion)
Human-triggered via `POST /competitions/:id/forge`. `forge-orchestrator.ts` spawns the
`claude` CLI (`CLAUDE_BIN` overrides the binary) with the pinned stage model, generating
artifacts in parallel.

Forge runs are **stacked** — each trigger appends a new `ForgeRun` to `results.forge`. Source picker: `winner` | `loser` | `synthesis`. The `ForgeRun` type (in `@arena/shared`):
```ts
interface ForgeRun {
  id: string;
  source: 'winner' | 'loser' | 'synthesis';
  sourceTeamId?: string;
  forgeModel: string;
  artifacts: ForgeArtifact[];
  generatedAt: string;
  domain?: ForgeDomain;
  selectedTypes?: ForgeArtifactType[];
}
```
Legacy single `ForgeOutput` records are wrapped into a 1-element array on read (backward-compat in `repository.ts`).

`ForgeArtifactType`, `ForgeDomain` and `ForgeOutputFormat` live in
`packages/shared/src/types/forge.ts` — read that file for the current lists rather than
trusting a copy here. Shape of the pipeline:
- **Domain detection** — one of 7 domains (software, research, creative, security, business, ideation, strategy); `DOMAIN_TYPE_DEFAULTS` maps domain → default artifact types. `DELIVERABLE_TYPE_FALLBACK` maps `deliverableType` → domain when the AI classifier fails (document→research, analysis→business, plan→strategy).
- **Universal artifacts** (`executive_summary`, `next_steps`, `tool_recommendations`) are always generated, flagged `universal: true`.
- **Relevance filter** — `filterByRelevance()` runs after domain selection, before generation; `ARTIFACT_RELEVANCE_KEYWORDS` gates conditional types (dockerfile only when the brief mentions docker/deploy, sql_schema only for database briefs, etc.).
- **Starter kit** — `generateStarterKit()` runs in parallel with domain artifacts and always appends `reference_implementation`, `test_suite_template`, `project_readme`.
- **Output formats** — each `ForgeArtifact` has `outputFormat` + `filename`; legacy records are normalized on read via `normalizeArtifact()` (backfills `outputFormat: 'markdown'`, `filename: '{type}.md'`). `stripMarkdownFences()` removes ``` fences from SQL/YAML/Dockerfile/CSV output.
- **UI** — per-artifact download button, format badge (top-right of each card), format-aware modal (CSV → table, multi-file JSON → file tree, sql/yaml/dockerfile/text → `<pre>`, markdown → rendered).
- **ZIPs** — `packages/web/lib/forge-zip-utils.ts` (`resolveZipPath`, `expandMultiFileArtifact`) handles folder placement and multi-file expansion.

### Commentary agent
Enable with `--commentary` flag or `commentary: true` in RunOptions. Batches 5 events → Claude generates one witty sentence → emitted as `COMMENTARY` ArenaEvent (gold bar in UI).

### Brief generator
Multi-step pipeline:
1. **Intake** (`POST /generate-brief/intake`) — classifies domain + generates 1-3 clarifying questions
2. **Generate** (`POST /generate-brief/generate`) — uses a domain template from `packages/orchestrator/src/brief/domain-templates.ts` (7 domains: software, business, research, creative, strategy, security, ideation)
3. **Quality** (`POST /generate-brief/quality`) — heuristic checks (7 rules, no LLM): criterion length, constraints, problem length, weights, duplicates, deliverableType
4. Legacy `POST /generate-brief` chains intake + generate internally

`DOMAIN_TEMPLATES` entries each have: systemFocus, deliverableType, exemplarCriteria (3 per domain), antiPatterns, deliverableHints, defaultTimeLimitMs.

### Brief library persistence
`briefs` table. Three write paths:
- **YAML seed on startup** — `briefs/*.yml` upserted with `source: 'yaml'` (YAML is source of truth, overwrites DB on restart)
- **Save from generator** — `source: 'generated'`
- **Save from competition** — `source: 'competition'`

YAML-sourced briefs cannot be deleted via API (403).

`/briefs` Launch button links to `/competitions/new?briefSlug={brief.id}`; the New Battle page reads `?briefSlug`, fetches `/api/briefs`, pre-populates all fields and jumps to step 3 (teams).

### Feedback telemetry
`brief_quality_signals` table — one row per competition (upsert). Computed by `computeHeuristicSignals()` in `packages/orchestrator/src/telemetry/quality-analyzer.ts`. Tracks:
- Score differentiation: spread, tied (< 0.01), all-eights (7-9 range)
- Per-criterion signals: spread and average per criterion
- File delivery: expected vs. produced deliverables

`getGeneratorLearnings()` in `packages/orchestrator/src/telemetry/learnings.ts` queries signals and returns insights injected into the brief generation prompt — more competitions → better briefs. `seed-quality-signals` backfills all completed competitions.

### Agent stats auto-resolve
`findByProviderAndModel()` on AgentRepository matches `provider + persona` to existing agents. The competition runner resolves `agentId` before execution, so stats accumulate regardless of launch method (CLI, New Battle, or Armory). The CLI wires `agentRepo` when `DATABASE_URL` is set.

### Shared LLM utilities
**JSON extraction** — `packages/orchestrator/src/utils/extract-json.ts` is a balanced-brace walker for extracting the first complete JSON object from LLM stdout. Use it everywhere Claude/Codex/Gemini output is parsed — never use the greedy `/\{[\s\S]*\}/` regex (breaks when synthesis markdown contains `}` characters).

```ts
import { extractJson } from '../utils/extract-json.js';
const parsed = JSON.parse(extractJson(stdout));
```

**Brief context** — `packages/orchestrator/src/utils/brief-context.ts` builds the brief section of every LLM prompt. Exports `buildBriefContext(brief, options)`, `truncateFiles(files, perFile, budget)`, and 4 presets — use them, don't hand-build brief sections:
- `JUDGE_CONTEXT`: title/problem/constraints/deliverables/rubric (full detail), 24K/file, 240K budget
- `PRESENTER_CONTEXT`: same fields, weights-only rubric, 12K/file, 120K budget
- `SYNTHESIS_CONTEXT`: title/problem/constraints/rubric (full), 8K/file, 50K budget
- `FORGE_CONTEXT`: title/problem/constraints/rubric (full), 6K/file, 40K budget

### Event normalizers
- **Claude** (`claude-normalizer.ts`) — parses `stream-json`: unwraps `{ type: "assistant", message: { content: [...] } }`, classifies content blocks (tool_use → TOOL_CALL, Write/Edit → FILE_CREATE, thinking → REASONING, text → REASONING/FILE_CREATE).
  `ClaudeNormalizer` is stateful: `task_started` / `task_updated` / `task_notification` become
  `SUB_AGENT_SPAWN` / `SUB_AGENT_DONE`, and lines with `parent_tool_use_id` get `metadata.agentId`.
- **Codex** (`codex-json-normalizer.ts`) — `CodexJsonNormalizer` parses `codex exec --json` (`item.completed` lines only): `command_execution` → TOOL_CALL, `file_change` → FILE_CREATE/MODIFY (marker), `collab_tool_call` spawn/wait/close → squad events with the receiver thread id as `agentId`. The old text parser is gone.
- **Gemini** (`gemini-normalizer.ts`) — `-o stream-json` lines; `invoke_agent` tool_use/tool_result → squad spawn/done. Plain-text fallback for older CLIs.

Squad fixtures (scrubbed real transcripts) live in `adapters/__fixtures__/squads/`; never commit raw ones (`.squad-research/` is git-excluded). A test bans paths, account names and MCP names from them.

### DB schema (Drizzle + PostgreSQL)
- `competitions`: id, brief (jsonb), teams (jsonb), state, startedAt, completedAt
- `events`: id, competitionId, teamId, timestamp, type, payload, metadata, seq (serial)
- `results`: competitionId, scorecards (jsonb), winnerId, synthesis (jsonb — SynthesisResult), presentations (jsonb), forge (jsonb — ForgeRun[]), deliverables (jsonb)
- `tournaments`: id, name, brief (jsonb), teams (jsonb), type, state, matchIds (jsonb), rankings (jsonb), createdAt, completedAt
- `results_history`: id (uuid), competitionId, archivedAt, stage, previousResults (jsonb) — backup before re-evaluate overwrites
- `brief_quality_signals`: id (uuid), competitionId (unique), scoreSpread, tied, allEights, criterionSignals (jsonb), expectedFilesProduced (jsonb), etc.
- `briefs`: id (text PK), title, brief (jsonb), source ('yaml'|'generated'|'competition'), qualityScore, tags (jsonb), createdAt, updatedAt

**Delete is transactional** — `repo.delete()` wraps events/results/competitions deletes in a single transaction to prevent orphaned rows.

### DB persistence for CLI `run`
When `DATABASE_URL` is set, the CLI `run` command persists to DB:
- `arenaEvent` writes are fire-and-forget (collected into `pendingEvents[]`, drained with `Promise.all` after `runner.run()`)
- `stateChange` / `result` writes are serialized via `stateQueue` to prevent ordering issues
- Omitting `DATABASE_URL` = log files only; competition won't appear in dashboard

## Web UI (`packages/web`)

### Pages
- `/` — gallery with state/model filters, health dot, auto-refresh, score bars on cards, tournament list
- `/competitions/new` — brief builder with AI generator (✨), intake questions, quality scorer, example picker, YAML import (📂)
- `/competitions/:id` — live battle arena (default) or log view (toggle); tabs: Scores, Presentations, Files, Synthesis, Forge
- `/competitions/:id/replay` — replay viewer with scrubber and 1×–10× speed
- `/stats` — tabbed: Analytics (default), Leaderboard, Compare
- `/briefs` — brief library with search + tag filters, source badges, quality scores
- `/tournaments/:id` — tournament standings + match history
- `/agent-armory` — tabbed: Agent Roster, Personas, Agent Builder (reads `?tab` from URL)

Old routes redirect: `/analytics` → `/stats?tab=analytics`, `/leaderboard` → `/stats?tab=leaderboard`, `/compare` → `/stats?tab=compare`, `/personas` → `/agent-armory?tab=personas`

### TopBar
`packages/web/components/TopBar.tsx` — fixed top nav: ARENA4AI logo + 4 links (**Competitions** `/` | **Briefs** `/briefs` | **Stats** `/stats` | **Armory** `/agent-armory`) + **⚔ New Battle** CTA (`/competitions/new`).
- Responsive: full inline nav ≥ 1051px; hamburger dropdown ≤ 1050px; hamburger closes on outside click and route change
- CSS classes: `.topbar`, `.topbar-logo`, `.topbar-nav`, `.topbar-desktop`, `.topbar-mobile`, `.topbar-hamburger`, `.topbar-dropdown` — all in `globals.css`
- Uses `px` units (not `rem`) for font-size/padding to bypass the `html { font-size: 120% }` scaling

### Hero pattern (all pages)
Every page uses the same hero structure — do not deviate:
- Kicker: `KICKER_STYLE` + `color: '#00f0ff'`
- H1: gradient text (`#c8eef8 → #00f0ff → #0080ff`), `fontFamily: MONOSPACE_FONT`, 1.8–2rem
- Subtitle: 0.72rem, `#4a8fa8`
- No back-navigation buttons in hero — TopBar handles all navigation
- Page-specific CTAs (e.g., "+ New Persona", "⚔ Run a Match") are fine on the right side

### Layout widths
- Content pages use `maxWidth: '1400px'`
- Form-heavy pages (`/competitions/new`, `/tournaments/new`, `/personas`) keep narrower widths (680–800px)

### Design tokens & shared utilities
- `packages/web/lib/design-tokens.ts` — TRON model colors (claude `#ff6600`, codex `#0066ff`, gemini `#00f0ff`), STATE_STYLES, `hexToRgb()`. Use these everywhere — don't hardcode colors or redefine `hexToRgb`.
- `packages/web/lib/format.ts` — `formatDuration`, `formatElapsed`, `formatTimeLimit`, `resolveTeamLabel`. Don't inline team-label resolution in components.
- `packages/web/lib/orchestrator.ts` — `orchestratorUrl()` + `orchestratorHeaders()` for every proxy route (see Auth).
- `packages/web/lib/forge-zip-utils.ts` — use for any code building forge ZIPs; don't duplicate the routing tables.

### Route handlers
The app is on Next.js 14. New `app/api/` handlers use the Promise-params form (forward-compatible with Next 15); a few older routes still use the sync `{ params: { id: string } }` form.
```ts
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  ...
}
```

### Live event display
- Per-team event buffer capped at ~600 for performance; TOOL_CALL/FILE_CREATE/ERROR events are always kept, only REASONING is trimmed
- Accurate event type counts tracked separately in `eventCountsRef` (never trimmed) — used for summary bar icons (⚡/📄/🧠)

### Live battle visualization
The competition page has three views: `3D` (desktop default), `Iso` and `Log`. `ArenaViewerV2`
is the HOST for both pictures: it drives `IsoArenaRenderer` from `@arena/shared` (clock, seek,
ingest, honesty notes) and either lets it draw the isometric canvas or hands its `World` to the
3D scene (`packages/video/src/arena3d/scene.ts`, see `packages/video/CLAUDE.md`). Every block is
a file and height is the edit count; the 3D path must call `stepStructures(world)` each frame
because it never calls the isometric `draw()`.

- **Replay**: a finished match opens on its end state and plays as a match. Pause holds the
  current frame; Resume continues from the playhead and only a playhead at the end restarts from
  0. `setFinalState()` sets `world.replayOf`, and only a verdict state (`VERDICT_STATES`:
  SCORED / COMPLETE / FORGING / FORGE_COMPLETE) reveals at the end. The 3D jumbotron reads
  `REPLAY · A vs B` for a replay (`LIVE · …` live, and in every reel, which never sets
  `replayOf`) and `REPLAY · MATCH FAILED · …` / `REPLAY · CANCELLED · …` for a match that ended
  without a verdict.
- **Theater** (`⛶ Theater`, Esc exits): the arena alone over the viewport for recording, with
  the team headers, the momentum bar and a 16:9 canvas. Only styles change, so the renderer and
  the WebGL scene survive the switch; the site chrome is hidden via `body.arena-theater`
  (`globals.css`) because the arena sits in `<main>`'s stacking context below the TopBar.
  Honesty notes move into the in-frame legend while it is on.

The bullets below describe the earlier 2D gladiator arena (`lib/arena/*-v2.ts`). Those files
remain but the live page no longer draws with them; treat this list as history.
- `packages/web/components/ArenaViewerV2.tsx` — main component (Canvas + inline HUD: LaneHeader, MomentumMeter, PhaseChip, WinnerBanner)
- `packages/web/lib/arena/gladiator-v2.ts` — GladiatorV2 class; public API: `setBase` / `setTerminal` / `flash` / `setEnergy` / `update` / `draw`
- `packages/web/lib/arena/poses-v2.ts` — 8-pose library (idle, thinking, strike, power, hit, triumph, kneel, salute) + model visuals config
- `packages/web/lib/arena/ring-v2.ts` — ArenaRingV2 (floor grid, rings, phase tint, pulses) + ShockwavesV2 (particles/confetti)
- `packages/web/lib/arena/classify-v2.ts` — `classifyEventV2()` (event type → flash pose) + `stateToPhase()` (competition state → arena phase)
- `packages/web/lib/arena/poses.ts` — retained for `resolveModelBuild()` only
- Pose priority: flash > terminal > base (in `_updateTarget()`). Event mapping: FILE_CREATE/FILE_MODIFY→strike, TOOL_CALL→power, ERROR→hit, REASONING→thinking (transient)
- Momentum: recent events → energy (0–1 per team, 3s window) → posture; momentum meter over a 10s window
- View toggle: `⚔ Battle` / `📋 Log` (persisted in localStorage, mobile falls back to Log)
- 2-team face-off layout; N-team ring formation (canvas supports it, HUD is 2-team only)
- End sequence: phase freeze → judging tint → winner triumph + loser kneel + confetti
- Figures: armored silhouettes with TRON circuit edges, ~180 units tall on a 1200×640 logical canvas; model-specific kit — **Claude** tall-crown helmet + spinning identity disc, **Codex** flat-top helmet + dual forearm blades, **Gemini** pointed helmet + energy staff
- **Critical:** the init effect is keyed on `teamsKey` (stable id|model|persona signature). Re-initializing on every parent render wipes terminal poses.
- `packages/video/src/components/VideoGladiator.ts` mirrors this armor and pose library for reels — keep them in sync.

## Next session

Where things stand after 2026-11-18 (see `CHANGELOG.md` for the detail):
- Agent squads are on `feat/agent-squads` (not merged): sub-agent events, robots in the 3D view,
  squad chips and deliverable strips in the HUD, the Codex `--json` move and the WebSocket
  subscribe-before-history fix. Browser verification and the PR are what is left.

Earlier, after 2026-11-14:
- As of 2026-11-14, `main` had the 3D arena (`v2.0.0`) and the harness hardening (#17).
- **Done 2026-11-14:** real end-to-end runs (CLI and web) on the hardened build. They led to the
  live model catalog and agent-crash reporting on `feat/live-model-catalog` (see CHANGELOG).
- **Next:** mark a team whose CLI stalled on provider errors (e.g. Gemini 503s until the deadline)
  as failed rather than judging its empty workdir; offer a one-click fix in the Armory for user
  agents on retired ids.
- **Then, in rough priority:** show a draw in the UI and the reel (a tie is stored with no
  `winnerId` and currently renders as a blank winner; the match page's loser calculation and the
  Forge source picker still fall back to the first team); awaiting tournament match-record
  creation (`routes/tournaments.ts`); a cancelled state for tournaments; the sandbox-mode CLI
  preflight that looks for agent binaries on the host.
- **Open decisions for the owner:** whether the web UI gets a login before anyone exposes it;
  how a sandboxed agent should authenticate beyond environment variables; whether to bump the
  `0.1.0` package versions to match the tag.
- **Unexplained:** two "POST returns 201" tests fail about once in fifteen full turbo runs.
- Docker is not installed on the development machine, so sandbox changes are stub-tested only.

## Known Issues
1. Resolved for Codex (`exec --json`) and Gemini (`-o stream-json`): both are structured now.
   Gemini's stream still names few file writes; sub-agent writes reach the arena through the
   workdir watcher (`opSource: 'watch'`).
2. WebSocket seq counter is approximate (local, not DB serial). The reconnect replay gap is
   closed (subscribe, then read history, dedupe by event id), except for the persistence-lag
   window: an event emitted before the subscribe but not yet committed when history is read is
   still missing for that connection. A full fix needs an in-memory ring buffer on the runner.
3. Gemini's API can return 503 "high demand" for long stretches; gemini-cli retries with backoff
   until Arena's deadline kills it, so the team is judged on an empty workdir. It is not marked
   `agentFailure` because the CLI never exited on its own.
4. A drawn match (scores within the aggregator's tolerance) is stored with no `winnerId`; the
   tied teams are the scorecards with `rank === 1`. The UI and the reel do not label a draw yet.
5. Gemini has no spawn cap: no cap is passed to gemini-cli, so the squad limit is only requested in
   the `[SQUAD]` prompt (Codex gets a real one via `agents.max_concurrent_threads_per_session`).
6. Codex and Gemini attribute and time squads coarsely. Neither names which member wrote a file
   (`subagentAttribution: false`; files carry `metadata.squad` and show as unassigned pulses), and
   Gemini's `invoke_agent` only marks the call and its result, so lifespans are approximate.
   Codex's `--ignore-user-config` also ignores the operator's `config.toml` (default model, a custom
   provider or base URL) for competitors, while the model-catalog probe does not use the flag.
7. The heuristic fallback scorer (`rubric-scorer.ts`) belongs to the honest-fallback-scorer work
   (PR #20); the squad work does not change it.
