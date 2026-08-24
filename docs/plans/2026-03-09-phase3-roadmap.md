> **Historical design document, March 2026.** Written while the project was still called *Agent Arena*. Model ids, APIs, file paths and the project name below are as of that date and are **not current**. Kept as a record of what was decided then, not as guidance. See `README.md` for how Arena4Ai works today.

# Agent Arena — Phase 3 Roadmap

> **PM Synthesis** — Research conducted by Software Architect, Frontend Design, and Quality/Security Engineer agents.
> Date: 2026-03-09

---

## Executive Summary

Phase 1 and Phase 2 are fully complete and production-ready. The platform successfully runs live competitions between Claude, Codex, and Gemini with real-time event streaming, AI judging, file collection, and a polished web UI.

Three critical issues were surfaced by the research team and must be prioritized before new feature work:

1. **SECURITY**: Deliverable execution (automated scorer) runs agent-submitted code directly on the host OS. No sandbox.
2. **RELIABILITY**: `collectDeliverables` is non-recursive — Claude agents that create `src/main.py` have their files silently ignored.
3. **UX CONFUSION**: Claude's model color is orange in the arena but blue in the gallery — inconsistent cross-page identity.

---

## Phase 3 Workstreams

### Workstream 1: Security & Reliability (P0 — do first)

#### Task 1: Sandbox the Deliverable Execution Scorer [CRITICAL]

**Problem:** `src/engine/automated-scorer.ts` uses `spawnSync` to execute agent-submitted `.py`/`.js`/`.rb`/`.sh` files directly. The HTTP API defaults `skipSandbox: true`. An agent can submit a malicious deliverable and execute arbitrary code on the host.

**Fix:**
- Wrap execution in `sandbox-manager.ts` `spawnInContainer()` 
- Cap execution at 10s, 64MB memory, no network (`--network none`)
- Use a read-only mount for the workdir
- Reject files larger than 100KB before execution

**Files:** `packages/orchestrator/src/engine/automated-scorer.ts`, `packages/orchestrator/src/sandbox/sandbox-manager.ts`

**Test:** Submit a deliverable that attempts to read `/etc/passwd` — verify it is blocked.

---

#### Task 2: Add FAILED and CANCELLED Terminal States

**Problem:** When a competition is cancelled or an adapter crashes, it completes as `COMPLETE` with zero scores and no explanation. The gallery shows these as normal finished competitions.

**Fix:**
- Add `FAILED` and `CANCELLED` to `CompetitionState` enum in `packages/shared/src/types.ts`
- In `competition-runner.ts`: on unhandled adapter error → set `FAILED`; on explicit cancel → set `CANCELLED`
- In the web UI: show distinct badge colors (`red` for FAILED, `gray` for CANCELLED)
- Gallery page: add filter chips for state

**Files:** `packages/shared/src/types.ts`, `packages/orchestrator/src/engine/competition-runner.ts`, `packages/web/app/competitions/[id]/page.tsx`, `packages/web/app/page.tsx`

---

#### Task 3: Make collectDeliverables Recursive + Add Size Guards

**Problem:** `BaseAdapter.collectDeliverables()` only reads the top-level workdir. Claude agents that create `src/main.py` or `output/report.md` have those files silently ignored, causing false "No files submitted" scores.

**Fix:**
- Replace `readdir` with a recursive walk (use `glob` or `fs.readdir({ recursive: true })`)
- Exclude directories, binary files, and files over 500KB
- Cap total payload at 5MB across all files
- Add `path: relative/path/from/workdir` to each file entry

**Files:** `packages/orchestrator/src/adapters/base-adapter.ts`

**Test:** Create nested file structure in `/tmp`, verify all files are collected.

---

#### Task 4: Security Hardening (Auth, Rate Limiting, Proxy Allowlist)

**Problem:** API key auth is disabled in dev mode and has no rate limiting. The Next.js proxy blindly forwards any URL to the orchestrator.

**Fix:**
- Add `express-rate-limit`: 10 POST /competitions per minute per IP
- Add concurrency cap: max 2 simultaneous active competitions
- Validate `ARENA_API_KEY` is set in production (`NODE_ENV === 'production'`)
- Restrict proxy allowlist in `packages/web/next.config.js` to known orchestrator routes only

**Files:** `packages/orchestrator/src/server/app.ts`, `packages/orchestrator/src/server/middleware/auth.ts`, `packages/web/next.config.js`

---

#### Task 5: Adapter Error Surfacing + Temp Directory Cleanup

**Problem:** Adapter spawn errors (missing CLI binary, wrong flags) are swallowed silently. Temp workdirs from skip-sandbox runs are never cleaned up.

**Fix:**
- On `spawn error` event: emit `ArenaEvent` of type `ERROR` with the error message; transition to `FAILED`
- After competition ends: delete workdir (skip-sandbox mode) or let container cleanup handle it
- Show ERROR events in the arena UI with a red `!` badge

**Files:** `packages/orchestrator/src/adapters/base-adapter.ts`, each adapter's `startExecution()`

---

### Workstream 2: Judging Quality

#### Task 6: Neutral Judge + TypeScript/Go Runners

**Problem:** The AI judge prompt currently uses the brief's persona context, which may bias scoring. TS and Go deliverables cannot be auto-scored.

**Fix:**
- Strip persona from judge prompt; use a fixed neutral "You are an impartial competition judge" system prompt
- Add `.ts` runner: `npx tsx <file>` (10s timeout)
- Add `.go` runner: `go run <file>` (15s timeout)
- Filter phantom criteria: skip criteria with `weight < 0.05` or no description from rubric scoring

**Files:** `packages/orchestrator/src/engine/ai-judge.ts`, `packages/orchestrator/src/engine/automated-scorer.ts`

---

#### Task 7: Judge Calibration — Tie-Breaking and Score Normalization

**Problem:** Both teams regularly score identically when the judge can't distinguish quality. Scores aren't normalized across rubric weights.

**Fix:**
- Add tie-breaking pass: if total scores are within 0.5 points, ask judge to pick a winner explicitly
- Normalize: `weightedScore = (rawScore / maxScore) * weight * 100`
- Surface the judge's reasoning chain in the synthesis tab

**Files:** `packages/orchestrator/src/engine/ai-judge.ts`, `packages/orchestrator/src/server/websocket.ts`

---

#### Task 8: Synthesis Engine Improvements

**Problem:** Synthesis is a single AI call with no structure. It produces walls of markdown with no cross-reference to the actual scored criteria.

**Fix:**
- Structure synthesis prompt: "For each criterion, identify the best elements from each team and describe how to combine them."
- Return structured JSON: `{ criterion: string, teamAStrength: string, teamBStrength: string, synthesis: string }[]`
- Render each criterion block separately in the Synthesis tab

**Files:** `packages/orchestrator/src/engine/ai-judge.ts`, `packages/web/app/competitions/[id]/page.tsx`

---

### Workstream 3: Frontend Polish

#### Task 9: Shared Design Constants + Model Color Fix

**Problem:** Claude's color is orange (`#f97316`) in the arena lane but blue (`#3b82f6`) in the gallery and analytics. No shared design token file exists — colors are hardcoded in 6+ locations.

**Fix:**
- Create `packages/web/lib/design-tokens.ts`: `MODEL_COLORS`, `STATE_COLORS`, `FONT_SIZES`
- Standardize Claude → orange everywhere, Codex → purple, Gemini → blue
- Replace all hardcoded hex values with token references

**Files:** `packages/web/lib/design-tokens.ts` (new), `packages/web/app/page.tsx`, `packages/web/app/competitions/[id]/page.tsx`

---

#### Task 10: Arena UX Fixes (Timer, Pause Overlay, Broadcast Dedup, StateBanner)

**Problem (from session):** Timer starts from 0 instead of from competition start time. Paused competitions show no visual overlay. Broadcast events appear in both lanes (duplicated). No banner for state transitions.

**Fix:**
- Timer: use `competitionStartTime` from WS metadata as epoch base
- Pause: render semi-transparent overlay with "PAUSED" text on both lanes when `state === 'PAUSED'`
- Broadcast dedup: filter events where `teamId === null` or `teamId === 'broadcast'` out of lane event lists; show in a center strip instead
- StateBanner: animated banner that slides in on `JUDGING`, `COLLECTING`, `COMPLETE` state transitions

**Files:** `packages/web/app/competitions/[id]/page.tsx`

---

#### Task 11: Shared Event Components + Click-to-Expand Rows

**Problem:** Event row rendering is duplicated between LanePanel and the planned Replay viewer. Long REASONING text is truncated with no way to expand.

**Fix:**
- Extract `EventRow` component to `packages/web/components/EventRow.tsx`
- Click event row → expand to full text in a modal or inline expansion
- Truncate at 120 chars by default, show "..." expand affordance

**Files:** `packages/web/components/EventRow.tsx` (new), `packages/web/app/competitions/[id]/page.tsx`

---

#### Task 12: Gallery Filtering + Brief Library Seed

**Problem:** Gallery shows all competitions in a flat list. No filtering by state, model, or date. No example briefs to help new users get started.

**Fix:**
- Add filter bar to gallery: by state chip, by model chip, date range
- Add "Example Briefs" section to `/competitions/new` with 6 pre-built briefs (FizzBuzz, Hotel Price Search, Story Generator, Code Review, Data Analysis, Translation)
- Clicking an example brief pre-populates the form

**Files:** `packages/web/app/page.tsx`, `packages/web/app/competitions/new/page.tsx`, `packages/web/lib/example-briefs.ts` (new)

---

#### Task 13: Form Validation + Replay Keyboard Shortcuts

**Problem:** New competition form allows submitting with blank criteria descriptions. Replay has no keyboard navigation.

**Fix:**
- Form: inline validation on blur for each criterion field; disable submit until all required fields pass
- Replay: `Space` = play/pause, `←`/`→` = step, `0` = reset, `End` = jump to end

**Files:** `packages/web/app/competitions/new/page.tsx`, `packages/web/app/competitions/[id]/page.tsx`

---

### Workstream 4: New Features

#### Task 14: Multi-Round Tournaments

**Description:** Bracket-style tournament where 4+ model/persona combinations compete across multiple briefs. Teams accumulate points. Championship round.

**Design:**
- New DB table: `tournaments` with bracket JSON
- New route: `POST /tournaments`, `GET /tournaments/:id`
- Each round is a standard competition; results feed the bracket
- Web UI: bracket visualization with Challenger vs Champion layout

**Files:** New throughout — tournament router, tournament-runner, bracket-manager, web tournament page

---

#### Task 15: Commentary Agent

**Description:** A live AI narrator that observes the event stream and adds color commentary in real-time — "Claude just created 3 files in 10 seconds!", "Gemini is asking for clarification early, interesting strategy."

**Design:**
- Subscribe to competition SSE stream
- Every 10 seconds, send last N events to Claude claude-haiku-4-5-20251001 for commentary
- Emit commentary as a new event type `COMMENTARY` with `{ text, teamId | null }`
- Show in center strip between the two lanes

**Files:** `packages/orchestrator/src/engine/commentary-agent.ts` (new)

---

#### Task 16: Leaderboard

**Description:** Cross-competition leaderboard ranking model/persona combinations by win rate, average score, and improvement over time.

**Design:**
- SuiteQL-style view over `results` table: aggregate by `teams[].teamId`
- Expose `GET /leaderboard` endpoint
- Web page: `/leaderboard` with sortable table + sparkline win rate trends

**Files:** `packages/orchestrator/src/server/routes/leaderboard.ts` (new), `packages/web/app/leaderboard/page.tsx` (new)

---

#### Task 17: Replay Viewer

**Description:** Playback slider for stored events. Scrub through any past competition at any speed.

**Design:**
- Fetch all events from `GET /competitions/:id/events?all=true`
- Render events frame-by-frame via requestAnimationFrame
- Controls: play, pause, speed (0.5x / 1x / 2x / 4x), scrub bar, jump to state transition
- Keyboard shortcuts from Task 13

**Files:** `packages/web/app/competitions/[id]/replay/page.tsx` (new)

---

## Priority Order

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| P0 🔴 | Task 1: Sandbox scorer | M | Security blocker |
| P0 🔴 | Task 3: Recursive collect | S | Reliability blocker |
| P1 🟠 | Task 2: FAILED/CANCELLED states | S | User clarity |
| P1 🟠 | Task 9: Shared design constants | S | Brand consistency |
| P1 🟠 | Task 10: Arena UX fixes | M | Core UX |
| P2 🟡 | Task 4: Rate limiting | S | Security hardening |
| P2 🟡 | Task 5: Error surfacing | S | Debugging |
| P2 🟡 | Task 6: Neutral judge | S | Quality |
| P2 🟡 | Task 11: Event components | M | DX + Replay prep |
| P3 🟢 | Task 7: Judge calibration | M | Quality |
| P3 🟢 | Task 8: Synthesis engine | M | Quality |
| P3 🟢 | Task 12: Gallery filtering | M | UX |
| P3 🟢 | Task 13: Form validation + keyboard | S | Polish |
| P4 🔵 | Task 14: Tournaments | XL | New feature |
| P4 🔵 | Task 15: Commentary agent | L | New feature |
| P4 🔵 | Task 16: Leaderboard | L | New feature |
| P4 🔵 | Task 17: Replay viewer | L | Phase 2 carry |

---

## Agent Research Findings

### Software Architect

- Competition state machine is clean and well-tested. The sandbox pause/resume logic is solid.
- **Critical gap**: `collectDeliverables` at line 75-86 of `base-adapter.ts` only reads the top-level workdir. Every Claude competition where the agent creates files in subdirectories silently produces 0 deliverables.
- `score-aggregator.ts` `computeOverallScore()` is correctly shared between AI judge and automated scorer. Good.
- `competition-runner.ts` has no FAILED state — adapter crashes produce a COMPLETE competition with no scores and no error message visible anywhere in the UI.
- WebSocket `lastSeq` cursor logic uses a local counter, not the DB serial. On reconnect after a slow DB write, events may be replayed from slightly wrong offset.

### Frontend Design

- The two-lane arena layout is distinctive and works well. The pre-battle animation creates tension.
- **Color inconsistency**: Claude is orange in the arena lane header but blue in the gallery card. Codex/Gemini are consistent. This breaks visual identity.
- No shared design tokens file — colors, fonts, and spacing are hardcoded across 6+ files.
- The ScoreDrawer tabs (SCORES / FILES / SYNTHESIS) are a good pattern. Synthesis tab needs structured rendering — raw markdown walls are unreadable on mobile.
- ExampleChips component on the new competition form is a great addition. Should be extended to the criteria description fields too.
- Gallery needs filtering — 20+ competitions make it impossible to find a specific one.

### Quality / Security Engineer

- **CRITICAL**: `automated-scorer.ts` executes agent code with `spawnSync` directly on the host OS. Any agent can submit a reverse shell as a deliverable. Must sandbox before enabling in production.
- No rate limiting on `POST /competitions`. An attacker can flood the server with unlimited competitions.
- Auth middleware is disabled when `ARENA_API_KEY` is not set — fine for local dev but must be enforced in production.
- The Next.js proxy at `/api/competitions/*` forwards any path to the orchestrator with no allowlist. A crafted URL could reach internal routes.
- `skipSandbox: true` is the default in the HTTP route handler — should default to `false` once the scanner is sandboxed.
- No input validation on brief YAML file paths (CLI mode). A crafted brief could traverse directories.

---

*End of Phase 3 Roadmap — Agent Arena PM Synthesis*
