# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Arena4Ai — competitive AI orchestration platform. Two (or more) AI agents race to solve a structured brief, then a cross-judge scores their deliverables. Supports Claude, Codex, and Gemini.

**Status: Sprint 4 complete. 211 tests passing.**

## Running the Stack

### Prerequisites (one-time setup)

```bash
# Uses local Homebrew PostgreSQL — Docker NOT required for dev
createdb arena
cp .env.example packages/web/.env.local
# Run all migrations (competitions, events, results, tournaments tables)
cd packages/orchestrator && DATABASE_URL=postgresql://localhost/arena npm run db:migrate && cd ../..
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

# Round-robin tournament (all pairs compete)
npx tsx packages/orchestrator/src/cli.ts tournament run briefs/fizzbuzz-cli.yml \
  --teams claude:architect,claude:speedrunner,codex:standard \
  --skip-sandbox
```

## Tests

```bash
npm run test --workspace=packages/orchestrator   # 211 tests
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

## Monorepo Structure

```
packages/
  shared/       @arena/shared       — types, Zod schemas, EventType/CompetitionState enums
  orchestrator/ @arena/orchestrator — engine, adapters, judging, HTTP API, CLI
  web/          @arena/web          — Next.js 15 App Router UI (port 3001)
  video/        @arena/video        — Remotion composition for competition recap reels
briefs/         — YAML brief files (fizzbuzz-cli.yml, roman-numerals.yml, etc.)
```

## Key Architecture

### Competition lifecycle
`DRAFT → CONFIGURED → LAUNCHING → RUNNING → TIME_UP → COLLECTING → PRESENTING → JUDGING → SCORED → COMPLETE`
Human-triggered post-completion: `COMPLETE → FORGING → FORGE_COMPLETE`
Synthesis is no longer automatic — it is triggered manually via `POST /competitions/:id/synthesis`.
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
- `POST /tournaments` — create round-robin tournament → `{ tournamentId }`
- `GET /tournaments/:id` — tournament status + standings
- `GET /leaderboard` — aggregate win rates per model
- `GET /analytics/summary` — competition stats
- `POST /competitions/:id/forge` — trigger forge (requires COMPLETE/FORGE_COMPLETE state, `ANTHROPIC_API_KEY`); body: `{ source: 'winner'|'loser'|'synthesis' }`
- `GET /competitions/:id/forge` — get forge runs → `{ status: 'forging'|'complete'|'idle', runs: ForgeRun[] }`
- `GET /competitions/:id/forge/:runId/download` — download full forge run as ZIP
- `GET /competitions/:id/forge/:runId/artifacts/:type/download` — download single artifact (raw file with correct Content-Type)
- `POST /competitions/:id/synthesis` — trigger on-demand synthesis (202 async, requires COMPLETE state)
- `GET /competitions/:id/synthesis` — synthesis status
- `GET /competitions/:id/deliverables/:teamId/download` — ZIP of team deliverables
- `POST /generate-brief` — Claude expands rough idea → structured brief JSON
- `GET /health`

Rate limiting: 10/min on `POST /competitions`; 5/min on `POST /competitions/:id/forge` and `POST /competitions/:id/synthesis`; 20/min on `POST /generate-brief`.

### Presentation layer
After collecting deliverables, `presentation-generator.ts` calls Claude (in parallel per team) to generate human-readable `TeamPresentation` objects that map deliverables back to rubric criteria. This runs BEFORE judging (PRESENTING state).

### The Forge (post-completion)
Human-triggered via `POST /competitions/:id/forge`. Uses `@anthropic-ai/sdk` directly to generate artifacts in parallel. Requires `ANTHROPIC_API_KEY`.

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

**Sprint 4 — Forge as Product Factory:**
- `ForgeOutputFormat` type: `'markdown' | 'sql' | 'csv' | 'yaml' | 'json' | 'text' | 'dockerfile'`
- `ForgeArtifact` has `outputFormat: ForgeOutputFormat` and `filename: string`; legacy records normalized on read via `normalizeArtifact()` (backfills `outputFormat: 'markdown'`, `filename: '{type}.md'`)
- **Domain detection** — auto-selects 'software' | 'business' | 'research' | 'creative' from brief; `DOMAIN_TYPE_DEFAULTS` maps domain → default artifact types
- **12 artifact types**: roadmap, task_graph, repo_blueprint, api_contracts, risk_register, decision_log, dockerfile, github_actions, gantt_timeline, reference_implementation, test_suite_template, project_readme
- **Starter kit** — `generateStarterKit()` runs in parallel with domain artifacts, producing `reference_implementation`, `test_suite_template`, `project_readme` (3 extra artifacts, always appended)
- **ZIP routing** — `packages/web/lib/forge-zip-utils.ts` exports `resolveZipPath(artifact)` and `expandMultiFileArtifact(zip, artifact)` for correct folder placement and multi-file expansion
- **Per-artifact download button** on each artifact card in the Forge tab
- **Format badges** (top-right corner of each card) showing outputFormat
- **Format-aware modal** — CSV → table, multi-file JSON → file tree, sql/yaml/dockerfile/text → `<pre>`, markdown → unchanged

### Judging pipeline
1. **AI cross-judge** (`ai-judge.ts`) — PRIMARY scorer. Claude reads actual deliverables and scores against rubric criteria with real analysis.
2. **Automated scorer** (`rubric-scorer.ts`) — FALLBACK only. Used per-team when AI judge fails. Executes deliverables (`.py`/`.js`/`.rb`/`.sh` via stdin, `.ts` via tsx temp file); 100KB input / 512KB stdout / 10s timeout limits. Heuristic scoring when no `expectedOutput`.
3. **Aggregation** (`score-aggregator.ts`) — weighted average; tie-breaking within 0.005 tolerance. Only AI judge scores are aggregated when AI judge succeeds.
4. **Synthesis** (`merge-engine.ts`) — returns `SynthesisResult { synthesis: string, perCriterion[] }` with per-criterion winner attribution. Now on-demand only.

### Commentary agent
Enable with `--commentary` flag or `commentary: true` in RunOptions. Batches 5 events → Claude generates one witty sentence → emitted as `COMMENTARY` ArenaEvent (gold bar in UI).

### Web UI pages
- `/` — gallery with state/model filters, health dot, auto-refresh, tournament list
- `/competitions/new` — brief builder with AI generator (✨), example picker, YAML import (📂)
- `/competitions/:id` — live arena + tabs: Scores, Presentations, Files, Synthesis, Forge; Rematch/Copy/Download/🎬 Reel buttons
- `/competitions/:id/replay` — replay viewer with scrubber and 1×–10× speed
- `/leaderboard` — model win-rate leaderboard
- `/analytics` — competition stats
- `/tournaments/new` — tournament creation
- `/tournaments/:id` — tournament standings + match history
- `/briefs` — brief library with search + tag filters
- `/compare` — head-to-head model stats
- `/personas` — custom persona library (localStorage)

### DB schema (Drizzle + PostgreSQL)
- `competitions`: id, brief (jsonb), teams (jsonb), state, startedAt, completedAt
- `events`: id, competitionId, teamId, timestamp, type, payload, metadata, seq (serial)
- `results`: competitionId, scorecards (jsonb), winnerId, synthesis (jsonb — SynthesisResult), presentations (jsonb), forge (jsonb — ForgeRun[]), deliverables (jsonb)
- `tournaments`: id, name, brief (jsonb), teams (jsonb), type, state, matchIds (jsonb), rankings (jsonb), createdAt, completedAt

Run migrations: `DATABASE_URL=postgresql://localhost/arena npm run db:migrate --workspace=packages/orchestrator`

**Delete is transactional** — `repo.delete()` wraps events/results/competitions deletes in a single transaction to prevent orphaned rows.

### Design tokens & shared utilities
- `packages/web/lib/design-tokens.ts` — TRON model colors (claude `#ff6600`, codex `#0066ff`, gemini `#00f0ff`), STATE_STYLES, `hexToRgb()`. Use these everywhere — don't hardcode colors or redefine `hexToRgb`.
- `packages/web/lib/format.ts` — `formatDuration`, `formatElapsed`, `formatTimeLimit`, `resolveTeamLabel`. Don't inline team-label resolution in components.
- `packages/web/lib/forge-zip-utils.ts` — `resolveZipPath(artifact)` and `expandMultiFileArtifact(zip, artifact)`. Use these in any code building forge ZIPs — don't duplicate the routing tables.

### TopBar & responsive navigation
- `packages/web/components/TopBar.tsx` — fixed top nav with ARENA4AI logo + 6 nav links + ⚔ New Battle CTA
- Responsive: full inline nav ≥ 1051px; hamburger dropdown ≤ 1050px
- Hamburger closes on outside click and route change
- CSS classes: `.topbar`, `.topbar-logo`, `.topbar-nav`, `.topbar-desktop`, `.topbar-mobile`, `.topbar-hamburger`, `.topbar-dropdown` — all in `globals.css`
- TopBar uses `px` units (not `rem`) for font-size/padding to bypass the `html { font-size: 120% }` scaling

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

### JSON extraction from LLM output
`packages/orchestrator/src/utils/extract-json.ts` — balanced-brace walker for extracting the first complete JSON object from LLM stdout. Use this in all places that parse Claude/Codex/Gemini output — never use the greedy `/\{[\s\S]*\}/` regex (breaks when synthesis markdown contains `}` characters).

```ts
import { extractJson } from '../utils/extract-json.js';
const parsed = JSON.parse(extractJson(stdout));
```

### DB persistence for CLI `run`
When `DATABASE_URL` is set, the CLI `run` command persists to DB:
- `arenaEvent` writes are fire-and-forget (collected into `pendingEvents[]`, drained with `Promise.all` after `runner.run()`)
- `stateChange` / `result` writes are serialized via `stateQueue` to prevent ordering issues
- Omitting `DATABASE_URL` = log files only; competition won't appear in dashboard

### Event normalizers
- **Claude** (`claude-normalizer.ts`) — parses `stream-json` format: unwraps `{ type: "assistant", message: { content: [...] } }` envelope, classifies content blocks (tool_use → TOOL_CALL, Write/Edit → FILE_CREATE, thinking → REASONING, text → REASONING/FILE_CREATE).
- **Codex** (`codex-normalizer.ts`) — stateful parser for Codex's text protocol. Suppresses banner/prompt echo, classifies `exec` → TOOL_CALL, `file update` → FILE_CREATE, `codex` → REASONING.
- **Gemini** (`gemini-normalizer.ts`) — plain text pattern matching. Limited classification — mostly REASONING since Gemini CLI lacks structured output markers.

### Live event display
- Per-team event buffer capped at ~600 for performance; TOOL_CALL/FILE_CREATE/ERROR events are always kept, only REASONING is trimmed
- Accurate event type counts tracked separately in `eventCountsRef` (never trimmed) — used for summary bar icons (⚡/📄/🧠)

### Next.js 15 route handlers
All `app/api/` route handlers use `Promise<{ param: string }>` for route params:
```ts
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  ...
}
```

### Remotion video reels
On-demand ESPN-style recap video generation from completed competition pages.

**Package:** `packages/video/` (`@arena/video`) — Remotion 4.x, 1080×1920 @ 30fps, 42s (1260 frames)

**API routes (Next.js web):**
- `POST /api/competitions/:id/reel` — trigger render (202 async); atomic lock via `{ flag: 'wx' }` prevents double-renders; re-POSTing a done/error reel deletes old files and re-renders
- `GET /api/competitions/:id/reel` — poll render status → `{ status: 'idle'|'rendering'|'done'|'error', progress?, url?, message? }`
- `GET /api/competitions/:id/reel/download` — stream MP4 via `fs.createReadStream` + `Readable.toWeb()`

**Key implementation details:**
- Bundle singleton in `packages/web/lib/remotion-bundle.ts` — `bundle()` called once per process lifetime; uses `process.cwd()` (= `packages/web/`) NOT `__dirname` (resolves to `.next/server/` in compiled output)
- Entry point: `packages/video/src/Root.tsx` (must call `registerRoot()`) — NOT `index.ts`
- `publicDir: path.resolve(process.cwd(), '../video/public')` passed to `bundle()` for static assets (audio)
- webpack `externals` function in `next.config.mjs` blocks `@remotion/*`, `@rspack/*`, `remotion`, `*.node` from being bundled by Next.js — `serverExternalPackages` alone is insufficient in Next.js 14
- `scorecard.finalScore` (not `totalScore`) holds the 0–1 score; criteria scores in `scorecard.judgeResults[0].scores` (not `scorecard.criteriaScores`)
- `team.persona` is a separate field on the team object; `team.model` is just the model prefix without `:persona`
- Brief rubric `description` is often a placeholder `">"` — fall back to formatting the `id` (kebab-case → Title Case)

**Scene timing:**

| Scene | Frames | Duration |
|---|---|---|
| IntroBumper | 0–90 | 3s |
| Matchup | 90–210 | 4s |
| TheBrief | 210–330 | 4s |
| KeyMoments | 330–570 | 8s |
| ScoreReveal | 570–900 | 11s |
| Winner | 900–990 | 3s |
| GoDeeper | 990–1170 | 6s |
| Outro | 1170–1260 | 3s |

**Scene design:**
- **Matchup**: N-team support; each team swoops from unique direction (left/top/right by index); badge size adapts to team count
- **TheBrief**: Description truncated to 130 chars; criteria as animated pip+icon rows
- **KeyMoments**: Per-agent directional swoop (agent 0=left, 1=right, 2=bottom, 3=top); card layout with team color stripe
- **ScoreReveal**: Full scores grid all N teams × all criteria with animated bars; Ken Burns pan+zoom; ranked final scores
- **Winner**: Radiating spokes, conic score ring, top-3 criteria, pulsing glow

**Audio:** `packages/video/public/arena4ai-theme.mp3` — plays via Remotion `<Audio loop>` at 75% volume, 1.5s fade-in, 2s fade-out

**Stale reel files:** `/tmp/arena-reels/<id>.json` (state) + `/tmp/arena-reels/<id>.mp4`; stale renders (>10min) auto-detected by mtime

**Reel UI buttons:** Competition detail page shows `🎬 Generate Reel` when idle/error; `⬇ Download Reel` + `🔄 Regenerate` when done. Regenerate re-POSTs and resets polling.

**GoDeeper scene:** Synthesis and Forge promo cards only render when `hasSynthesis`/`hasForge` are true in `ReelData`. Both are passed from the reel API route based on competition result data.

**Bundle pre-warm:** `packages/web/instrumentation.ts` calls `getBundle()` on server startup (Next.js `register()` hook, Node.js runtime only). First reel render is no longer cold.

### Brief pre-select from library
`/briefs` Launch button links to `/competitions/new?briefSlug={brief.id}`. On mount, `competitions/new/page.tsx` reads `?briefSlug`, fetches `/api/briefs`, finds the matching brief, and pre-populates all form fields. Jumps to step 3 (teams).

## Known Issues
1. Gemini events are mostly REASONING due to plain-text CLI output (no structured markers)
2. WebSocket seq counter is approximate (local, not DB serial)
