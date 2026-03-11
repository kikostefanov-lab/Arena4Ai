# Arena4Ai

Competitive AI orchestration platform. Two or more AI agents race to solve a structured brief, then a cross-judge scores their deliverables. Supports Claude, Codex, and Gemini.

## Features

- **Head-to-head and round-robin competitions** — pit any combination of Claude, Codex, and Gemini personas against each other
- **AI cross-judge** — Claude reads actual deliverables and scores them against rubric criteria; heuristic scorer used only as fallback
- **Presentation layer** — before judging, each team's deliverables are mapped to rubric criteria in a human-readable summary
- **Presentation download & expand** — download each team's presentation as markdown or view it in a full modal
- **Files tab** — inline file preview with syntax tinting, full-file modal, and per-team ZIP download
- **On-demand synthesis** — manually trigger AI synthesis to blend the best ideas from all teams
- **The Forge** — post-completion artifact generation with source picker (winner / loser / synthesis); stacked runs, each downloadable as ZIP
- **Live event stream** — WebSocket-backed real-time view of agent actions (tool calls, file writes, reasoning) per team
- **Commentary agent** — optional live AI commentary batched from the event stream
- **Replay viewer** — scrub through any competition at 1x–10x speed
- **Leaderboard and analytics** — aggregate win rates per model, competition stats
- **Brief builder** — AI-assisted brief generator, example picker, and YAML import in the web UI

## Prerequisites

- Node.js 20+
- Homebrew PostgreSQL (Docker not required)
- Agent CLIs installed and on `PATH`:
  - [`claude`](https://github.com/anthropics/claude-code) (Claude Code CLI)
  - [`codex`](https://github.com/openai/codex) (OpenAI Codex CLI)
  - [`gemini`](https://github.com/google-gemini/gemini-cli) (Google Gemini CLI)
- `ANTHROPIC_API_KEY` set in your environment (required for judging and The Forge)

## Quick Start

```bash
# 1. Create the database
createdb arena

# 2. Copy environment file and configure it
cp .env.example packages/web/.env.local
# Set NEXT_PUBLIC_WS_URL=ws://localhost:3000 in packages/web/.env.local

# 3. Install dependencies
npm install

# 4. Run database migrations
DATABASE_URL=postgresql://localhost/arena npm run db:migrate --workspace=packages/orchestrator
```

### Run the stack

Open two terminals:

```bash
# Terminal 1 — API server (port 3000)
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts serve --port 3000

# Terminal 2 — Web UI (port 3001)
cd packages/web && npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

## Running Competitions

### Single competition

```bash
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts run briefs/fizzbuzz-cli.yml \
  --team-a claude:architect --team-b gemini:speedrunner \
  --skip-sandbox --log-dir /tmp/arena-logs --time-limit 120000
```

`DATABASE_URL` is required for the competition to appear in the dashboard. Omit it for log-file-only mode.

### With live AI commentary

```bash
npx tsx packages/orchestrator/src/cli.ts run briefs/fizzbuzz-cli.yml \
  --team-a claude:architect --team-b claude:speedrunner \
  --skip-sandbox --commentary
```

### Round-robin tournament

```bash
npx tsx packages/orchestrator/src/cli.ts tournament run briefs/fizzbuzz-cli.yml \
  --teams claude:architect,claude:speedrunner,codex:standard \
  --skip-sandbox
```

### Trigger The Forge (after a competition completes)

```bash
# Forge using the winner's deliverables as context
curl -X POST http://localhost:3000/competitions/<id>/forge \
  -H 'Content-Type: application/json' \
  -d '{"source":"winner"}'
```

Requires `ANTHROPIC_API_KEY` and the competition must be in `COMPLETE` or `FORGE_COMPLETE` state. Multiple forge runs stack — each is preserved.

### Trigger Synthesis (on demand)

```bash
curl -X POST http://localhost:3000/competitions/<id>/synthesis
```

Synthesis is not automatic — trigger it manually after a competition completes.

## Web UI

| Route | Description |
|-------|-------------|
| `/` | Competition gallery with state/model filters and tournament list |
| `/competitions/new` | Brief builder with AI generator, example picker, and YAML import |
| `/competitions/:id` | Live arena with tabs: Scores, Presentations, Files, Synthesis, Forge |
| `/competitions/:id/replay` | Replay viewer with scrubber and 1x–10x playback speed |
| `/leaderboard` | Win-rate leaderboard per model |
| `/analytics` | Competition stats |
| `/tournaments/new` | Tournament creation |
| `/tournaments/:id` | Tournament standings and match history |

## Architecture

### Monorepo structure

```
packages/
  shared/       @arena/shared       — types, Zod schemas, EventType/CompetitionState enums
  orchestrator/ @arena/orchestrator — engine, adapters, judging, HTTP API, CLI
  web/          @arena/web          — Next.js 15 App Router UI (port 3001)
briefs/                             — YAML brief files
```

### Competition lifecycle

```
DRAFT → CONFIGURED → LAUNCHING → RUNNING → TIME_UP → COLLECTING
  → PRESENTING → JUDGING → SCORED → COMPLETE
```

Human-triggered post-completion:

```
COMPLETE → FORGING → FORGE_COMPLETE   (forge, repeatable)
COMPLETE → SYNTHESIZING → COMPLETE    (synthesis, on-demand)
```

Terminal states: `FAILED`, `CANCELLED`

### Model routing

The prefix before `:` in a team argument determines the adapter:

| Prefix | Adapter | CLI invocation |
|--------|---------|----------------|
| `claude:*` | ClaudeAdapter | `claude --print <prompt> --output-format stream-json --verbose --dangerously-skip-permissions` |
| `codex:*` | CodexAdapter | `codex exec --skip-git-repo-check -s workspace-write <prompt>` |
| `gemini:*` | GeminiAdapter | `gemini -p <prompt> --yolo` |

### Judging pipeline

1. **AI cross-judge** (primary) — Claude reads deliverables and scores against rubric criteria
2. **Automated scorer** (fallback) — heuristic execution-based scorer, used only when AI judge fails
3. **Aggregation** — weighted average of AI judge scores with tie-breaking within 0.005 tolerance
4. **Synthesis** — per-criterion winner attribution with a combined narrative (on-demand)

## The Forge

After a competition reaches `COMPLETE`, trigger The Forge via the web UI or API. Select a source:

- **Winner** — uses the winning team's deliverables as context
- **Loser** — uses the losing team's deliverables as context
- **Synthesis** — uses the synthesis result as context (requires synthesis to be run first)

Each forge run generates six build artifacts in parallel using Claude:

- **Roadmap** — phased development plan
- **Task graph** — dependency-aware task breakdown
- **Repo blueprint** — recommended repository structure
- **API contracts** — interface definitions
- **Risk register** — identified risks and mitigations
- **Decision log** — key architectural decisions

Forge runs stack — each is stored and downloadable as a ZIP. Results are displayed in the Forge tab.

## Tests

```bash
# Orchestrator tests (159 tests)
npm run test --workspace=packages/orchestrator

# Type checking
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

Six DB integration tests are skipped automatically when `DATABASE_URL` is not set.
