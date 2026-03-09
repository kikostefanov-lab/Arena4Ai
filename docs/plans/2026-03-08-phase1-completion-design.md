# Phase 1 Completion — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans after this design is approved.

**Goal:** Close the Phase 1 gaps to deliver the product the roadmap intended — Docker sandboxing, PostgreSQL persistence, WebSocket streaming, real Brief Builder, competition controls, and API key auth.

**What we skip from the original plan (and why):**
- NATS JetStream — unnecessary when Docker containers run on the same host; stdout piping gives us the same event flow without a message broker. NATS is a Phase 3 concern when we go multi-host.
- Firecracker microVMs — macOS incompatible. Docker is the sandbox layer.
- Magic-link auth — over-engineered for an operator tool. API key is sufficient.

---

## Architecture Overview

```
Browser
  ↕ WebSocket (ws://)
Next.js (port 3001)
  ↕ HTTP proxy
Express API (port 3000)
  ├─ CompetitionRepository (Drizzle + PostgreSQL)
  ├─ WebSocket server (ws library, mounted on Express)
  └─ CompetitionRunner
       ├─ SandboxManager (Docker, one container per team)
       │    └─ docker run arena-agent:latest <cli> <args>
       │         stdout piped back to runner
       └─ Adapters (ClaudeAdapter / CodexAdapter / GeminiAdapter)
            still implement startExecution() — now inside Docker
```

---

## Section 1: Data Layer (PostgreSQL + Drizzle)

### Schema

```typescript
// competitions table
{
  id:           text (PK),
  brief:        jsonb,           // full Brief object
  teams:        jsonb,           // [Team, Team]
  state:        text,            // CompetitionState
  started_at:   timestamptz,
  completed_at: timestamptz,
}

// events table
{
  id:              text (PK),    // ArenaEvent.eventId
  competition_id:  text (FK → competitions.id, indexed),
  team_id:         text,
  timestamp:       timestamptz,
  type:            text,
  payload:         jsonb,
  metadata:        jsonb,
  seq:             integer,      // insertion order for deterministic replay
}

// results table
{
  competition_id:  text (PK, FK → competitions.id),
  scorecards:      jsonb,        // ScoreCard[]
  winner_id:       text,
  summary:         text,
}
```

### Repository

`CompetitionRepository` wraps Drizzle. Replaces `CompetitionStore`.

Key methods:
- `create(id, brief, teams)` — inserts competition row
- `appendEvent(event)` — inserts event row (called on every ArenaEvent)
- `updateState(id, state)` — updates competition state
- `saveResult(id, result)` — inserts result row
- `getEvents(id, afterSeq?)` — fetch events for replay, optional cursor
- `list(limit)` — for gallery page

The in-memory `EventEmitter` pattern stays — it's still how live events flow to connected WebSocket clients. Every event is also written to Postgres immediately so replay is always available.

### Connection

- `DATABASE_URL` env var (postgres://...)
- Drizzle migrations in `packages/orchestrator/src/db/migrations/`
- `npm run db:migrate` command added to orchestrator

---

## Section 2: Real-time Streaming (WebSocket)

Replace SSE (`EventSource`) with WebSocket (`ws` library).

### Server

`ws.Server` attached to the same Express HTTP server (no new port).

```
wss.handleUpgrade(req, socket, head, (ws) => {
  // extract competitionId from req.url: /competitions/:id/stream
  // replay past events from Postgres (after client's lastSeq if provided)
  // subscribe to in-memory EventEmitter for live events
  // on competition complete: send final result, close
})
```

**Reconnection:** client sends `{ lastSeq: number }` as first message on connect. Server replays only events with `seq > lastSeq`. No duplicates.

### Client

`packages/web/app/competitions/[id]/page.tsx` replaces `EventSource` with `WebSocket`:
- Same message-handling logic (JSON parse, route by teamId, render EventRow)
- Reconnects automatically on disconnect (exponential backoff, max 5 retries)
- Sends `lastSeq` of last received event on reconnect

**Message format:** identical JSON shape to current SSE payloads — no frontend event-handling changes needed beyond the transport swap.

---

## Section 3: Docker Sandbox

### arena-agent Docker Image

Single image with all three CLIs pre-installed. Built from `Dockerfile.agent` at repo root.

```dockerfile
FROM node:20-slim
RUN npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli
WORKDIR /workspace
```

Build once: `docker build -f Dockerfile.agent -t arena-agent:latest .`

### SandboxManager (real implementation)

Currently `--skip-sandbox` bypasses `SandboxManager`. Real implementation:

```typescript
create(teamId, { workdir }):
  // verify arena-agent image exists (docker image inspect)
  // record workdir path — container will bind-mount it

run(teamId, command, args, env):
  // docker run --rm
  //   -v <workdir>:/workspace
  //   -w /workspace
  //   --network host          (agents need internet for API calls)
  //   --memory 2g --cpus 1
  //   -e ANTHROPIC_API_KEY=... -e OPENAI_API_KEY=... -e GEMINI_API_KEY=...
  //   arena-agent:latest
  //   <command> <args>
  // returns ChildProcess (stdout/stderr still piped to adapter)

shutdown(teamId):
  // docker kill <containerId> if still running

collectDeliverables(teamId):
  // read from workdir on host (bind-mount, already accessible)
```

### Adapter changes

Each adapter's `startExecution()` currently calls `spawn(bin, args)`. It calls `sandboxManager.run(teamId, bin, args, env)` instead. Return type is the same `ChildProcess` — nothing else in the adapter changes.

### CLI flags (unchanged — these run inside the container)

- Claude: `claude --print <prompt> --output-format stream-json --verbose --dangerously-skip-permissions`
- Codex: `codex exec --skip-git-repo-check -s workspace-write <prompt>`
- Gemini: `gemini -p <prompt> --yolo`

---

## Section 4: Brief Builder UI

New page: `packages/web/app/competitions/new/page.tsx`

Five-step wizard using local React state. No server round-trips until final submit.

**Step 1 — Problem**
- Title (text)
- Format (dropdown: SPRINT / HACKATHON)
- Time limit (number input, in minutes, converted to ms on submit)
- Problem statement (textarea)

**Step 2 — Constraints & Deliverables**
- Add/remove constraint strings (text + add button, list with remove)
- Add/remove deliverable strings (same pattern)

**Step 3 — Rubric**
- Add criteria rows: id, description, maxScore, weight
- Live weight-sum validator (shows red if ≠ 1.0)
- `expectedOutput` textarea (optional — enables execution-based correctness scoring)

**Step 4 — Teams**
- Team A: model dropdown (claude / codex / gemini) + persona dropdown (architect / speedrunner / pragmatist / debugger)
- Team B: same
- Validation: both teams must be configured

**Step 5 — Review & Launch**
- Read-only preview of the full brief JSON
- "Launch Competition" button → `POST /competitions`
- On success: redirect to `/competitions/:id`

**Components:**
- `BriefForm.tsx` — step container + navigation
- `RubricEditor.tsx` — criteria list + weight validator
- `TeamConfigurator.tsx` — model + persona selectors

---

## Section 5: Auth

Single operator API key. Simple and sufficient for an internal tool.

**Server:** `ARENA_API_KEY` env var. Express middleware checks `Authorization: Bearer <key>` on all mutating routes (`POST /competitions`, future `DELETE`, `PATCH`). Read routes (`GET /competitions`, `GET /competitions/:id`, WebSocket) are public — spectators can watch without a key.

**Web client:** On first launch, if no key is stored, show a full-screen prompt for the API key. Store in `localStorage`. Send as `Authorization` header on all API calls from the frontend. If the server returns 401, clear stored key and re-prompt.

**No magic links, no sessions, no JWTs.** A single shared key for the operator. Multi-user auth is Phase 3.

---

## Section 6: Competition Controls

Controls rendered in the Arena View header, visible to authenticated operators.

### Cancel

The only hard-required control. Terminates a running competition immediately:
- `POST /competitions/:id/cancel`
- Runner kills both adapter processes (`adapter.shutdown()`)
- State transitions to `COMPLETE` with whatever deliverables were collected
- Judging still runs on partial deliverables

### Pause / Resume

Best-effort — implemented via SIGSTOP/SIGCONT on the Docker container PIDs.
- `POST /competitions/:id/pause` → `docker pause <containerId>`
- `POST /competitions/:id/resume` → `docker unpause <containerId>`
- ClockManager is also paused/resumed so time budget is fair
- Only available when sandboxing is active (no-op with `--skip-sandbox`)

### UI

Three buttons in the Arena View header bar, visible only when `state === 'RUNNING'`:
- **Cancel** (red, always shown when running)
- **Pause** (yellow, shown when running and not paused)
- **Resume** (green, shown when paused)

---

## Section 7: Additional Pages

### Gallery (`/`)

Repurpose the home page from the brief form to a competition gallery. Move Brief Builder to `/competitions/new`.

Gallery shows past competitions (from PostgreSQL):
- Competition ID, brief title, state badge, team models, final scores, timestamp
- Link to Arena View for each
- "New Competition" button → `/competitions/new`

### Replay (`/competitions/:id/replay`)

Simple replay viewer — same two-lane layout as Arena View but driven by stored events with a playback slider and speed control (1x / 2x / 4x).

Deferred to after the core Phase 1 work is stable — it's a feature, not a gate requirement.

---

## What This Closes

| Gate 1 Criterion | Status After This |
|---|---|
| 3-model competition | ✅ Already working |
| Live Arena UI < 2s latency | ✅ WebSocket maintains this |
| Adapter reliability 5/5 | ✅ Docker isolation improves reliability |
| Brief Builder < 10 min | ✅ 5-step wizard |
| Resource governance | ✅ Docker memory/CPU limits + time limit |
| Persistence / history | ✅ PostgreSQL |

**Gate 1 passed.**

---

## Out of Scope (Phase 2)

- Synthesis engine
- Multi-judge panel
- Human judge override UI
- Replay viewer (deferred from Phase 1)
- Multi-round tournaments
- NATS / multi-host scaling
- Public gallery (auth-gated for now)
