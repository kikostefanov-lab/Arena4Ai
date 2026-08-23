> **Historical design document, April 2026.** Written while the project was still called *Agent Arena*. Model ids, APIs, file paths and the project name below are as of that date and are **not current**. Kept as a record of what was decided then, not as guidance. See `README.md` for how Arena4Ai works today.

# Idea Scout Agent — Design & Implementation Plan

**Status:** Draft / awaiting decisions
**Branch:** `claude/idea-scout-agent-aBGWQ`
**Author:** Initial design via Claude Code session, 2026-04-08
**Related:** `docs/plans/2026-03-09-phase4-the-forge-design.md` (forge pattern this borrows from)

---

## 1. What we're building

A new **Idea Scout** agent for Arena4Ai. Given a startup or product idea, it:

1. Spawns parallel sub-agents for **market research**, **competitive analysis**, and **feasibility assessment**
2. Synthesizes their outputs into:
   - A **Lean Canvas** (9 blocks)
   - A **SWOT + PESTLE** analysis
   - A **weighted scorecard** (6 fixed dimensions)
   - A **GO / CAUTION / NO-GO verdict** with reasoning

It is a **meta-orchestrator**, not a competitor. There is no Brief, no judging, no winner. The user submits an idea description and gets a structured scouting report back.

---

## 2. Where it fits in the existing architecture

### The key insight

Idea Scout is **not** a Team, **not** a Brief, **not** a Persona, and **not** a Competition. It is a **parallel-fan-out + synthesis** pipeline — exactly the shape of `packages/orchestrator/src/forge/forge-orchestrator.ts`.

Forge already does this:

- Defines a list of `ArtifactSpec`s, each with its own `systemPrompt`
- Runs them through `Promise.all(allSpecs.map(generateArtifact))` against the Claude CLI (`forge-orchestrator.ts:1056`)
- Tracks live progress via `Map<id, ProgressMap>` (`forge-orchestrator.ts:24`)
- Persists output as JSON

Idea Scout mirrors this 1:1. The only structural difference is a **second synthesis stage** that consumes the parallel outputs.

### What we are NOT changing

- ❌ No new adapter (we don't subclass `BaseAdapter`)
- ❌ No changes to `competition-runner.ts`
- ❌ No changes to the judging pipeline
- ❌ No changes to the existing state machine
- ❌ No coupling to the `competitions` / `results` tables

### What we ARE adding

| Layer | New Files / Changes | Notes |
|---|---|---|
| **Types** | `packages/shared/src/types/scout.ts` (new) | `ScoutRun`, `ScoutInput`, `LeanCanvas`, `SwotPestle`, `Scorecard`, `ScoutVerdict` |
| **DB schema** | Add `scoutRuns` table to `packages/orchestrator/src/db/schema.ts` + migration | Mirrors the `briefs` / `tournaments` pattern — small, isolated table |
| **Repo** | `packages/orchestrator/src/db/scout-repository.ts` (new) | `create`, `update`, `get`, `list` |
| **Orchestrator** | `packages/orchestrator/src/scout/scout-orchestrator.ts` (new) | `runScout(input, runId)` — mirrors `runForge()` |
| **Sub-agent prompts** | `packages/orchestrator/src/scout/scout-prompts.ts` (new) | Three system prompts |
| **Synthesis** | `packages/orchestrator/src/scout/scout-synthesizer.ts` (new) | Builds Lean Canvas, SWOT/PESTLE, scorecard, verdict from sub-agent outputs |
| **Tests** | `packages/orchestrator/src/scout/scout-orchestrator.test.ts` (new) | Mock `runClaude`, assert pipeline shape |
| **Shared util** | Lift `runClaude()` from `forge-orchestrator.ts:889` to `packages/orchestrator/src/utils/run-claude.ts` | Tiny refactor, no behavior change — both forge and scout use it |
| **HTTP routes** | `packages/orchestrator/src/server/routes/scout.ts` (new) | `POST /scout`, `GET /scout/:id`, `GET /scout`, `GET /scout/:id/download` |
| **App wiring** | `packages/orchestrator/src/server/app.ts` | Mount router; rate-limit `POST /scout` at 5/min |
| **CLI** | `packages/orchestrator/src/cli.ts` | New `scout run --idea "..."` command |
| **Web API proxy** | `packages/web/app/api/scout/*` (new) | Mirrors `app/api/competitions/*` pattern |
| **Web pages** | `packages/web/app/scout/page.tsx`, `app/scout/new/page.tsx`, `app/scout/[id]/page.tsx` (new) | List, new-idea form, result viewer |
| **Nav** | `packages/web/components/TopBar.tsx:8-13` | Add `{ href: '/scout', label: 'Idea Scout' }` |

---

## 3. Why a new DB table (not reusing `competitions` / `results`)

The `competitions` schema is tightly coupled to:
- A Brief with rubric criteria
- Two-or-more Teams competing
- A judging pipeline producing scorecards
- Adapter-collected file deliverables

A scout run has **none** of these. Forcing it into `competitions` would mean:

- Synthesizing a fake Brief and fake teams just to satisfy the schema
- Polluting the gallery (`/`), leaderboards, and tournaments with non-competition rows
- Breaking every state-machine transition (`DRAFT → CONFIGURED → RUNNING → JUDGING → COMPLETE` makes no sense for scout)
- Adding `if (isScoutRun)` branches throughout the engine, judge, and UI

A dedicated `scout_runs` table is **~12 lines of schema** and keeps concerns separate. This is the same reasoning that earned `tournaments`, `briefs`, and `brief_quality_signals` their own tables.

### Schema sketch

```ts
export const scoutRuns = pgTable('scout_runs', {
  id:             text('id').primaryKey(),
  ideaTitle:      text('idea_title').notNull(),
  ideaDescription: text('idea_description').notNull(),
  targetMarket:   text('target_market'),         // optional, freeform
  timeline:       text('timeline'),              // '3-month' | '12-month' | '36-month'
  fundingStage:   text('funding_stage'),         // 'pre-seed' | 'seed' | 'series-a'
  state:          text('state').notNull(),       // 'queued' | 'researching' | 'synthesizing' | 'complete' | 'failed'
  marketResearch:    jsonb('market_research'),   // raw sub-agent output
  competitiveAnalysis: jsonb('competitive_analysis'),
  feasibility:    jsonb('feasibility'),
  leanCanvas:     jsonb('lean_canvas'),          // 9 blocks
  swotPestle:     jsonb('swot_pestle'),
  scorecard:      jsonb('scorecard'),            // criteria + weights + scores
  verdict:        text('verdict'),               // 'GO' | 'CAUTION' | 'NO-GO'
  verdictScore:   numeric('verdict_score'),     // 0–10 weighted total
  reasoning:      text('reasoning'),             // synthesis narrative
  errorMessage:   text('error_message'),         // when state = 'failed'
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt:    timestamp('completed_at', { withTimezone: true }),
});
```

---

## 4. The pipeline

```
User submits idea
       │
       ▼
┌─────────────────────────────────────────────┐
│ Stage 1: parallel research (Promise.all)    │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │  Market  │ │ Compete- │ │ Feasibil-  │  │
│  │ Research │ │   tive   │ │    ity     │  │
│  │ sub-agent│ │ Analysis │ │ Assessment │  │
│  └────┬─────┘ └────┬─────┘ └─────┬──────┘  │
│       │            │             │          │
└───────┼────────────┼─────────────┼──────────┘
        │            │             │
        └────────────┼─────────────┘
                     ▼
┌─────────────────────────────────────────────┐
│ Stage 2: synthesis (sequential, 1 call)     │
│                                             │
│  Inputs: idea + 3 sub-agent outputs         │
│  Outputs:                                   │
│    • Lean Canvas (9 blocks, JSON)           │
│    • SWOT + PESTLE (JSON)                   │
│    • Weighted scorecard (JSON)              │
│    • Verdict (GO / CAUTION / NO-GO)         │
│    • Reasoning (markdown narrative)         │
└─────────────────────────────────────────────┘
                     │
                     ▼
            Persist + return runId
```

### Sub-agent responsibilities

**Market Research** — TAM / SAM / SOM, customer segments, willingness-to-pay, market trends, growth rate, regulatory tailwinds. Output: JSON.

**Competitive Analysis** — Direct competitors, indirect alternatives, incumbent moats, pricing landscape, white-space opportunities, switching costs. Output: JSON.

**Feasibility Assessment** — Technical complexity, regulatory burden, capital requirements, team-skill fit, time-to-MVP, go-to-market difficulty. Output: JSON.

### Synthesis stage

Takes the three JSON blobs + the original idea and produces one merged JSON object with:

```ts
{
  leanCanvas: {
    problem, solution, uniqueValueProposition, unfairAdvantage,
    customerSegments, keyMetrics, channels, costStructure, revenueStreams
  },
  swot: { strengths[], weaknesses[], opportunities[], threats[] },
  pestle: { political[], economic[], social[], technological[], legal[], environmental[] },
  scorecard: {
    criteria: [
      { id: 'market_size',          weight: 0.20, score: 0–10, rationale },
      { id: 'competitive_position', weight: 0.20, score: 0–10, rationale },
      { id: 'feasibility',          weight: 0.20, score: 0–10, rationale },
      { id: 'defensibility',        weight: 0.15, score: 0–10, rationale },
      { id: 'team_fit',             weight: 0.10, score: 0–10, rationale },
      { id: 'timing',               weight: 0.15, score: 0–10, rationale },
    ],
    weightedTotal: number  // 0–10
  },
  verdict: 'GO' | 'CAUTION' | 'NO-GO',
  reasoning: '...markdown narrative...'
}
```

**Verdict thresholds** are deterministic, applied in code (not by the LLM):

- `weightedTotal >= 7.5` → **GO**
- `5.0 <= weightedTotal < 7.5` → **CAUTION**
- `weightedTotal < 5.0` → **NO-GO**

This makes the verdict transparent, reproducible, and tunable.

---

## 5. HTTP API

| Method | Path | Body / Response |
|---|---|---|
| `POST` | `/scout` | Body: `{ ideaTitle, ideaDescription, targetMarket?, timeline?, fundingStage? }` → `{ scoutId }` (202) |
| `GET` | `/scout/:id` | Returns full `ScoutRun` row + live progress map |
| `GET` | `/scout` | List runs (paginated), most recent first |
| `GET` | `/scout/:id/download` | ZIP of all artifacts (lean_canvas.md, swot_pestle.md, scorecard.json, verdict.md, raw sub-agent outputs) |

**Rate limit:** 5 / minute on `POST /scout` (matches forge limiter).

---

## 6. CLI

```bash
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts scout run \
  --idea "AI-powered customer support for SaaS" \
  --market "B2B SaaS, 100-1000 employee companies" \
  --timeline 12-month \
  --funding-stage seed
```

The CLI command POSTs to `/scout`, polls `/scout/:id` until complete, then prints the verdict + downloads the ZIP to `--out` (defaults to `./scout-runs/<id>/`).

---

## 7. Web UI

### New routes

- **`/scout`** — Scout history list. Card per run: idea title, verdict badge (color-coded), weighted score, timestamp. Filter by verdict.
- **`/scout/new`** — Idea submission form. Fields: title, description (textarea), optional market / timeline / funding-stage. CTA: "Scout this idea".
- **`/scout/[id]`** — Result viewer. Tabs: Verdict, Lean Canvas, SWOT/PESTLE, Scorecard, Raw Research, Download. Shows live progress while running.

### Navigation

Add to `packages/web/components/TopBar.tsx:8-13`:

```ts
const NAV_LINKS = [
  { href: '/',              label: 'Competitions' },
  { href: '/briefs',        label: 'Briefs'       },
  { href: '/stats',         label: 'Stats'        },
  { href: '/agent-armory',  label: 'Armory'       },
  { href: '/scout',         label: 'Idea Scout'   },  // NEW
];
```

### Hero / styling

Follow the existing hero pattern documented in `CLAUDE.md`:
- Kicker `IDEA SCOUT` with `color: '#00f0ff'`
- H1 gradient text `MONOSPACE_FONT`
- Verdict badge colors: `GO` = `#00ff88`, `CAUTION` = `#ffaa00`, `NO-GO` = `#ff4466`
- maxWidth 1400px on the list page; 800px on the form

---

## 8. Decisions to confirm before coding

1. **Scope for the first PR** — full stack in one PR, or slice into (a) types + orchestrator + HTTP + CLI, then (b) Web UI as follow-up?
2. **Scorecard criteria** — fixed 6 dimensions (Market Size, Competitive Position, Feasibility, Defensibility, Team Fit, Timing) or configurable per run?
3. **Sub-agent provider** — Claude-only (matches forge) or also support Codex / Gemini via `--provider` flag?
4. **Verdict thresholds** — deterministic cutoffs (≥7.5 / 5.0–7.5 / <5.0) or let the LLM decide in synthesis?
5. **Idea intake** — one-shot (idea → scout immediately) or add a clarifying-question step first like `brief/intake.ts`?

### Recommended defaults (from initial design session)

1. **Full stack in one PR**
2. **Fixed 6-dimension scorecard** (Market Size 0.20, Competitive Position 0.20, Feasibility 0.20, Defensibility 0.15, Team Fit 0.10, Timing 0.15)
3. **Claude-only sub-agents** for v1 (forge precedent; multi-provider can come later)
4. **Deterministic verdict thresholds** — transparent, reproducible, tunable
5. **One-shot intake** — clarifying questions are a future enhancement

---

## 9. Implementation order (when we start coding)

1. Types in `packages/shared/src/types/scout.ts` + barrel export
2. DB migration + schema for `scout_runs`
3. `ScoutRepository` with create/update/get/list
4. Lift `runClaude()` to shared util; update `forge-orchestrator.ts` import
5. `scout-prompts.ts` — three sub-agent system prompts
6. `scout-orchestrator.ts` — `runScout()` orchestration
7. `scout-synthesizer.ts` — synthesis stage + verdict thresholds
8. Unit tests for orchestrator (mock `runClaude`)
9. HTTP routes + rate limiter + app wiring
10. CLI command
11. Web API proxy routes
12. Web pages: list, new, detail
13. TopBar nav link
14. Manual end-to-end smoke test against a real idea
15. Update `CLAUDE.md` with the new endpoints, table, and routes

---

## 10. Reference files (cheat sheet)

| What | File | Lines |
|---|---|---|
| Forge parallel pattern (the template) | `packages/orchestrator/src/forge/forge-orchestrator.ts` | 24, 889, 995, 1025, 1056 |
| `runClaude()` helper to lift | `packages/orchestrator/src/forge/forge-orchestrator.ts` | 889–924 |
| `extractJson` for sub-agent JSON parsing | `packages/orchestrator/src/utils/extract-json.ts` | — |
| DB schema (where `scoutRuns` goes) | `packages/orchestrator/src/db/schema.ts` | — |
| Express app wiring | `packages/orchestrator/src/server/app.ts` | ~97–119 |
| Existing route example | `packages/orchestrator/src/server/routes/competitions.ts` | — |
| TopBar nav | `packages/web/components/TopBar.tsx` | 8–13 |
| Brief intake (alt template if we add clarifying questions) | `packages/orchestrator/src/brief/intake.ts` | 24–75 |
| Existing plans dir convention | `docs/plans/` | — |

---

## 11. How to resume this in a fresh Claude Code session

When you start a new Claude Code session on your local machine, paste this prompt to get back to the same starting point:

> I'm working on the Idea Scout agent for Arena4Ai. Read `docs/plans/2026-04-08-idea-scout-agent.md` for the full design. Branch is `claude/idea-scout-agent-aBGWQ`. I'm ready to start implementation — confirm the recommended defaults in section 8 (or I'll specify changes), then begin with the implementation order in section 9.
