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
# API server (port 3000)
DATABASE_URL=postgresql://localhost/arena \
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
  --team-a claude:architect --model-a claude-opus-5 \
  --team-b codex:speedrunner --model-b gpt-5.1-codex-max \
  --skip-sandbox --time-limit 120000

# Round-robin tournament (all pairs compete)
npx tsx packages/orchestrator/src/cli.ts tournament run briefs/fizzbuzz-cli.yml \
  --teams claude:architect,claude:speedrunner,codex:standard \
  --models claude-opus-5,claude-sonnet-5,gpt-5.3-codex \
  --skip-sandbox

# Re-evaluate completed competitions (stages: judge | presentation | synthesis | all)
# Archives the previous results to results_history before overwriting.
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts re-evaluate --all --stage judge

# Seed quality signals from existing competitions
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts seed-quality-signals
```

### Auth
`ARENA_API_KEY` (see `.env.example`) gates every mutating orchestrator request
(`POST`/`PUT`/`PATCH`/`DELETE`) behind `Authorization: Bearer <key>`; unset = auth disabled.
The web app's proxy routes attach it server-side via `orchestratorHeaders()` from
`packages/web/lib/orchestrator.ts` — always use that helper (and `orchestratorUrl()`) in
`app/api/` routes; a hand-rolled `fetch` header starts returning 401 as soon as a key is set.

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
- **Claude**: `claude --print <prompt> --output-format stream-json --verbose --dangerously-skip-permissions`
- **Codex**: `codex exec --skip-git-repo-check -s workspace-write <prompt>` (`-s workspace-write` required)
- **Gemini**: `gemini -p <prompt> --yolo` (`--yolo` required — auto-approves tool calls)

### HTTP API (Express, port 3000)
- `POST /competitions` — start competition → `{ competitionId }`
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

### Model registry, variants & pinning
`packages/orchestrator/src/adapters/model-registry.ts` is the **single source of truth** for
model ids — `seed-personas-agents.ts` derives its ids from it via `requireDefaultModel()`, so
never hardcode a model id anywhere else. Add new models by editing this file.

Presets per provider:
- **Claude**: `claude-opus-5` (default), `claude-sonnet-5`, `claude-opus-4-8`, `claude-haiku-4-5` — never date-suffix an Anthropic id
- **Codex**: `gpt-5.3-codex` (default), `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`
- **Gemini**: `gemini-3-flash` (default), `gemini-3-pro`, `gemini-3.1-pro`

Each provider entry also carries `bin` + `installHint`, used by the CLI preflight check.

**Competitor variants** — `Team.modelVariant?: string` flows through the competition runner to
adapter CLI args (Claude `--model`, Codex `-m`, Gemini `--model`). Resolution priority:
explicit `team.modelVariant` (CLI flag) > `agent.modelVariant` (DB) > undefined (CLI default).
CLI: `--model-a`…`--model-d` for `run`, `--models` comma-list for `tournament`. The
AgentBuilder UI offers a preset dropdown + freeform custom id.

**Judge pinning** — `DEFAULT_JUDGE_MODEL` (`claude-opus-5`) and `DEFAULT_ADVERSARIAL_JUDGE_MODEL`
(`claude-sonnet-5`) pin the judge so scores stay comparable across time, and so
`--adversarial-judge` is a genuinely different model rather than the same model with a
different prompt. Override per-run with `ARENA_JUDGE_MODEL` / `ARENA_ADVERSARIAL_JUDGE_MODEL`
(useful when reproducing an old score).

**Stage pinning** — every other `claude` call (synthesis, presentations, commentary, forge,
brief intake/generation) passes `--model resolveStageModel()` (`DEFAULT_STAGE_MODEL`,
override with `ARENA_STAGE_MODEL`). New LLM-calling stages must do the same — an unpinned
stage inherits whatever the CLI defaults to that week.

### Judging pipeline
1. **AI cross-judge** (`ai-judge.ts`) — PRIMARY scorer. Claude reads actual deliverables and scores against rubric criteria.
2. **Automated scorer** (`rubric-scorer.ts`) — FALLBACK only, per-team when the AI judge fails. Executes deliverables (`.py`/`.js`/`.rb`/`.sh` via stdin, `.ts` via tsx temp file); 100KB input / 512KB stdout / 10s timeout limits. Heuristic scoring when no `expectedOutput`.
3. **Aggregation** (`score-aggregator.ts`) — weighted average; tie-breaking within 0.005 tolerance. Only AI judge scores are aggregated when the AI judge succeeds.
4. **Synthesis** (`merge-engine.ts`) — returns `SynthesisResult { synthesis: string, perCriterion[] }` with per-criterion winner attribution. On-demand only.

**Adversarial mode** — `adversarialJudge: true` in the `POST /competitions` body or
`--adversarial-judge` runs standard + adversarial judges. Toggle lives in New Battle →
Advanced; completed competitions have a "Re-judge (adversarial)" button on the Scores tab.

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
- `JUDGE_CONTEXT`: title/problem/constraints/deliverables/rubric (full detail), 12K/file, 80K budget
- `PRESENTER_CONTEXT`: same fields, weights-only rubric, 8K/file, 50K budget
- `SYNTHESIS_CONTEXT`: title/problem/constraints/rubric (full), 8K/file, 50K budget
- `FORGE_CONTEXT`: title/problem/constraints/rubric (full), 6K/file, 40K budget

### Event normalizers
- **Claude** (`claude-normalizer.ts`) — parses `stream-json`: unwraps `{ type: "assistant", message: { content: [...] } }`, classifies content blocks (tool_use → TOOL_CALL, Write/Edit → FILE_CREATE, thinking → REASONING, text → REASONING/FILE_CREATE).
- **Codex** (`codex-normalizer.ts`) — stateful parser for Codex's text protocol. Suppresses banner/prompt echo, classifies `exec` → TOOL_CALL, `file update` → FILE_CREATE, `codex` → REASONING.
- **Gemini** (`gemini-normalizer.ts`) — plain text pattern matching; mostly REASONING (see Known Issues).

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

### Live battle visualization — Arena v2 (TRON Broadcast)
Default view on the competition detail page. Pure client-side Canvas 2D + React; phase is derived from existing competition state, so no backend changes are needed.
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

## Known Issues
1. Gemini events are mostly REASONING due to plain-text CLI output (no structured markers).
   Fixable now: gemini-cli 0.38.x supports `-o stream-json`, which would give the Gemini
   normalizer the structured markers it currently lacks (codex-cli 0.144.x likewise has
   `codex exec --json`). Not yet wired up.
2. WebSocket seq counter is approximate (local, not DB serial)
3. Persona generation (`server/routes/generate-persona.ts`) is the one `claude` call that
   still spawns without `--model resolveStageModel()`, so it inherits the CLI default.
