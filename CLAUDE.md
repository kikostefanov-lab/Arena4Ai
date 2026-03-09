# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Agent Arena — competitive AI orchestration platform. Two AI agents (Claude, Codex, or Gemini) race to solve a structured brief, then a cross-judge scores their deliverables.

**Status: Phase 0 + Phase 1 complete and working.**

## Running the Stack

### Prerequisites (one-time setup)

```bash
# Start PostgreSQL
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=arena -e POSTGRES_DB=arena postgres:16

# Build the agent sandbox image
docker build -f Dockerfile.agent -t arena-agent:latest .

# Copy env template for web UI
cp .env.example packages/web/.env.local

# Run database migrations
cd packages/orchestrator && DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena npm run db:migrate && cd ../..
```

### Running

```bash
# API server (port 3000)
DATABASE_URL=postgresql://postgres:arena@localhost:5432/arena \
  npx tsx packages/orchestrator/src/cli.ts serve --port 3000

# Web UI (port 3001) — separate terminal
cd packages/web && npm run dev

# CLI competition (skip-sandbox for dev without Docker)
npx tsx packages/orchestrator/src/cli.ts run briefs/fizzbuzz-cli.yml \
  --team-a claude:architect --team-b gemini:speedrunner \
  --skip-sandbox --log-dir /tmp/arena-logs --time-limit 120000
```

## Tests

```bash
npm run test                                    # all packages
npm run test --workspace=packages/orchestrator  # orchestrator only
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

94 tests, all passing.

## Monorepo Structure

```
packages/
  shared/       @arena/shared       — types, Zod schemas, EventType/CompetitionState enums
  orchestrator/ @arena/orchestrator — engine, adapters, judging, HTTP API, CLI
  web/          @arena/web          — Next.js 14 App Router UI (port 3001)
briefs/         — YAML brief files
```

## Key Architecture

### Competition lifecycle
`DRAFT → CONFIGURED → LAUNCHING → RUNNING → TIME_UP → COLLECTING → JUDGING → SCORED → COMPLETE`

### Adapters
All adapters extend `BaseAdapter` which implements `injectBrief`, `collectDeliverables`, `shutdown`, `done`. Subclasses only implement `startExecution()`.

Model routing in `competition-runner.ts`: prefix before `:` determines adapter.
- `claude:*` → ClaudeAdapter
- `codex:*`  → CodexAdapter
- `gemini:*` → GeminiAdapter

### CLI flags (critical — wrong flags = broken agent)
- **Claude**: `claude --print <prompt> --output-format stream-json --verbose --dangerously-skip-permissions`
- **Codex**: `codex exec --skip-git-repo-check -s workspace-write <prompt>`
  `-s workspace-write` required — default sandbox is read-only
- **Gemini**: `gemini -p <prompt> --yolo`
  `--yolo` required — auto-approves tool calls

### Shared normalizer utilities
`src/adapters/normalizer-utils.ts` — `stripAnsi`, `makeEvent`, `FILE_PATH_RE`, `ERROR_LINE_RE`, `normalizeOutput`. All three normalizers import from here.

### HTTP API (Express, port 3000)
- `POST /competitions` — start a competition, returns `{ competitionId }`
- `GET /competitions/:id` — status snapshot
- `GET /competitions/:id/events` — SSE stream
- `GET /health`

CompetitionStore caps events at 5,000 per competition and evicts completed competitions after 10 minutes.

### Web UI (Next.js 14, port 3001)
- `/` — brief submission form
- `/competitions/:id` — live two-lane event view + scoreboard
- `/api/competitions/*` — proxy routes to orchestrator

### Automated scorer
When a brief defines `expectedOutput`, the `correctness` criterion is scored by executing the deliverable (`.py`/`.js`/`.rb`/`.sh` via stdin) and comparing stdout line-by-line. Falls back to heuristics otherwise. `computeOverallScore(scores, rubric)` in `score-aggregator.ts` is shared by both the automated scorer and AI judge.

## Known Weaknesses
1. No replay viewer — events are stored in Postgres but the replay UI is Phase 2
2. Codex/Gemini stderr noise (banner lines) shows as ERROR events
