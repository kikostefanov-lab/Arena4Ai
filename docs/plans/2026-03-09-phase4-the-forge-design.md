> **Historical design document, March 2026.** Written while the project was still called *Agent Arena*. Model ids, APIs, file paths and the project name below are as of that date and are **not current**. Kept as a record of what was decided then, not as guidance. See `README.md` for how Arena4Ai works today.

# Phase 4 Design: The Forge — Presentation Layer + Build-Ready Artifacts

> Date: 2026-03-09
> Status: DRAFT

---

## Problem Statement

Agent Arena runs competitions between AI models, but the results are AI-centric: raw code files, numerical scores, and unstructured markdown. A human who gave agents a complex challenge (e.g., "design an urban density plan") gets back `optimizer.py` and a score of 0.9. They can't understand what was produced, can't form their own judgment, and can't act on the results.

**The Ivy League Test:** If 4 teams from different universities competed, they wouldn't hand the judges a Python script. They'd *present* their findings — mapped back to the criteria the judges care about. The audience would understand every team's approach, agree or disagree with the judges, and then decide what to build.

Agent Arena needs this same "presentation layer" — translating AI work products back into the language of the original brief so humans can understand, judge, and act.

---

## Design Philosophy

**Brief goes in human → work happens in AI → results come back human.**

Three translation layers, each making the output progressively more actionable:

1. **Presentations** — "What did each team find?" (per-team, per-criterion)
2. **Synthesis** — "What's the best of both?" (per-criterion element selection with rationale)
3. **The Forge** — "Turn the agreed solution into a build plan" (human-triggered, not automatic)

The human is in the loop between synthesis and forge. They review presentations, consider scores, read the synthesis, and only then decide what to forge.

---

## Revised Competition Lifecycle

```
DRAFT → CONFIGURED → LAUNCHING → RUNNING → TIME_UP → COLLECTING
  → PRESENTING → JUDGING → SCORED → SYNTHESIZING → COMPLETE
                                                       ↓
                                               [Human reviews]
                                                       ↓
                                              FORGING → FORGE_COMPLETE
```

### New States

| State | Description |
|---|---|
| `PRESENTING` | Generating human-readable presentations for each team's deliverables |
| `FORGING` | Generating build-ready artifacts from the agreed solution |
| `FORGE_COMPLETE` | Forge artifacts ready for download |

### State Machine Changes

- `COLLECTING → PRESENTING` (new)
- `PRESENTING → JUDGING` (was: COLLECTING → JUDGING)
- `COMPLETE` remains the terminal state after synthesis
- `FORGING` and `FORGE_COMPLETE` are triggered manually via `POST /competitions/:id/forge`

---

## Section 1: The Presentation Layer

### What It Is

After deliverables are collected, before judging begins, Claude reads each team's brief + deliverables and generates a **structured presentation** that maps findings back to the rubric criteria.

### Presentation Schema

```typescript
export interface TeamPresentation {
  teamId: string;
  model: string;              // e.g. "codex:defender"
  approach: string;           // 1-2 sentence summary of their overall approach
  criterionFindings: Array<{
    criterionId: string;
    finding: string;          // 2-3 sentences: what did this team produce for this criterion?
    strength: string;         // 1 sentence: what's strong about their approach?
    gap: string;              // 1 sentence: what's missing or weak? (empty string if nothing)
  }>;
  keyInsight: string;         // The single most important insight from this team's work
  deliverableSummary: string; // Plain-English summary of what files were produced and what they do
}
```

### Generation

New file: `packages/orchestrator/src/presentation/presentation-generator.ts`

For each team, call Claude with:
- The original brief (problem, constraints, rubric criteria)
- That team's deliverables (files + content)
- A structured system prompt asking for findings mapped to each criterion

Parallel generation — both teams' presentations generated simultaneously.

### Prompt Design

```
You are presenting a team's competition results to a non-technical audience.

The competition brief asked teams to solve this problem:
{brief.problem}

The judging criteria are:
{for each criterion: id, description}

This team ({teamId}, using {model}) produced the following deliverables:
{for each file: path + content}

Create a structured presentation of what this team produced.
For EACH criterion in the rubric, explain what this team found or built
in plain language that a non-technical person can understand.

Return valid JSON: { approach, criterionFindings: [...], keyInsight, deliverableSummary }
```

### Storage

New column on `results` table: `presentations JSONB` storing `TeamPresentation[]`.

### Timing

Presentations are generated BEFORE judging. This means:
- The judge can reference the presentations (improving judge quality)
- The human can see presentations even while judging is still running
- ~30-60 seconds added to the pipeline (2 parallel Claude calls)

---

## Section 2: Synthesis Improvements

### Current Problem

Synthesis produces a raw markdown blob with no connection to the rubric criteria. The perCriterion analysis is minimal (1-sentence rationale). The human can't understand WHY elements were chosen.

### Improved Synthesis Schema

```typescript
export interface SynthesisResult {
  synthesis: string;                    // the full hybrid solution markdown
  perCriterion: Array<{
    criterionId: string;
    winningTeamId: string;              // which team's approach was selected
    winningApproach: string;            // 2-3 sentences: what was selected and why
    losingApproach: string;             // 1-2 sentences: what the other team did differently
    rationale: string;                  // why the winner's approach is better for this criterion
  }>;
  overallRationale: string;            // 2-3 sentences: the thesis of the hybrid
}
```

### Improved Prompt

The synthesis prompt should:
1. Reference the presentations (not raw files) — Claude reads what each team found
2. For each criterion, explain WHAT was selected and WHY
3. Explain what was NOT selected and why
4. Produce a clear thesis for the hybrid solution

### Frontend Rendering

Instead of a markdown wall, render:
- **Overall thesis** at the top (2-3 sentences)
- **Per-criterion cards**: each shows the winner for that criterion, what was selected, why, and what was left behind
- **Full hybrid solution** expandable below (the markdown synthesis)

---

## Section 3: The Forge

### What It Is

A standalone post-processing service that takes the competition's winning/synthesized solution and generates 6 build-ready artifacts. Triggered manually by the human after they've reviewed presentations, scores, and synthesis.

### Model Selection

- If synthesis exists: count `perCriterion` entries per `winningTeamId` → use the model of the team that won the most criteria
- If no synthesis (direct win): use the winning team's model
- The selected model is recorded as `forgeModel` in the output

### ForgeOrchestrator

New file: `packages/orchestrator/src/forge/forge-orchestrator.ts`

```typescript
export interface ForgeInput {
  brief: Brief;
  presentations: TeamPresentation[];
  synthesis: SynthesisResult | null;
  winner: { teamId: string; model: string };
  deliverables: TeamDeliverable[];
}

export interface ForgeOutput {
  forgeModel: string;
  artifacts: ForgeArtifact[];
  generatedAt: string;
}

export interface ForgeArtifact {
  type: 'roadmap' | 'task_graph' | 'repo_blueprint' | 'api_contracts' | 'risk_register' | 'decision_log';
  title: string;
  content: string;         // markdown
  generatedAt: string;
}
```

### Generation

Uses `@anthropic-ai/sdk` directly (not Claude CLI) to call the model API. 6 artifacts generated in parallel with focused system prompts:

| Artifact | Prompt Focus |
|---|---|
| `roadmap` | Phased delivery plan with milestones, gates, effort estimates |
| `task_graph` | Dependency-linked task list with IDs, effort (S/M/L/XL), skill types |
| `repo_blueprint` | Directory tree + file descriptions + technology choices |
| `api_contracts` | REST endpoints, request/response schemas, WS protocol if applicable |
| `risk_register` | Risks × likelihood × impact × mitigation strategies |
| `decision_log` | Architectural decisions with context, options considered, rationale |

Each prompt receives: the original brief, the winning presentation, the synthesis (if available), and relevant deliverable files.

### API

- `POST /competitions/:id/forge` — triggers forge generation. Returns `{ forgeId }`.
- `GET /competitions/:id/forge` — returns forge outputs (or 404 if not yet generated).

### State Transitions

When forge is triggered:
- Competition state: `COMPLETE → FORGING`
- Events emitted: `FORGE_STARTED`, then `FORGE_ARTIFACT_READY` for each artifact, then `FORGE_COMPLETE`
- Final state: `FORGE_COMPLETE`

### Storage

New column on `results` table: `forge JSONB` storing `ForgeOutput`.

---

## Section 4: Web UI Changes

### Results Panel — New Tab Order

```
PRESENTATIONS (default) | SCORES | FILES | SYNTHESIS | FORGE
```

**PRESENTATIONS** is the default tab — the first thing a human sees.

### Presentations Tab

- Two columns (or stacked on mobile): one per team
- Each team shows:
  - Model badge + team label
  - "Approach" summary (1-2 sentences)
  - Per-criterion findings cards (expandable)
  - "Key Insight" callout box
  - "What they produced" summary

### Scores Tab (existing, minor update)

- Add judge reasoning excerpts from criterion scores
- Link each criterion score to the corresponding presentation finding

### Synthesis Tab (improved)

- Overall thesis at top
- Per-criterion verdict cards: winner badge, what was selected, why, what was left behind
- Expandable "Full Hybrid Solution" section (the markdown)

### Forge Tab (new)

- Initially shows: "Review the presentations and synthesis above, then forge when ready"
- **"Forge This Solution" button** — triggers POST /competitions/:id/forge
- While forging: progress bar per artifact with "Generating..." state
- After forging: sub-tabs for each artifact type (Roadmap, Tasks, Blueprint, API, Risks, Decisions)
- Each artifact has a **Download** button (`.md` file)
- **Download All** button (`.zip` of all 6 artifacts)
- Badge: "Forged by {model}" showing which model generated the artifacts

### Action Panel (bottom of results area)

After competition completes, show a clear action row:
- **Download Files** — zip of raw deliverables
- **Forge →** — go to Forge tab
- **Rematch** — re-run with same config
- **Share** — copy link

---

## Section 5: DB Schema Changes

### Migration: 0006_presentations_and_forge.sql

```sql
ALTER TABLE results ADD COLUMN presentations JSONB;
ALTER TABLE results ADD COLUMN forge JSONB;
```

Both columns are nullable — presentations are generated during the pipeline, forge is triggered manually.

### Updated Results Type

```typescript
export const results = pgTable('results', {
  competitionId: text('competition_id').primaryKey().references(() => competitions.id),
  scorecards:    jsonb('scorecards').notNull(),
  winnerId:      text('winner_id'),
  summary:       text('summary'),
  synthesis:     text('synthesis'),
  presentations: jsonb('presentations').$type<TeamPresentation[]>(),
  forge:         jsonb('forge').$type<ForgeOutput>(),
  deliverables:  jsonb('deliverables').$type<TeamDeliverable[]>(),
});
```

---

## Section 6: New Event Types

| Event Type | Payload | When |
|---|---|---|
| `PRESENTATION_READY` | `{ teamId, presentation: TeamPresentation }` | Each team's presentation is generated |
| `FORGE_STARTED` | `{ forgeModel }` | Forge begins |
| `FORGE_ARTIFACT_READY` | `{ type, title }` | Each artifact completes |

Add to `EventType` enum in `packages/shared/src/constants/event-types.ts`.

---

## Implementation Order

1. **Fix synthesis rendering bug** — investigate and fix empty synthesis content
2. **Add PRESENTING state** — state machine + presentation generator
3. **Wire presentations into competition-runner** — between COLLECTING and JUDGING
4. **Build Presentations UI tab** — default tab, per-team criterion findings
5. **Improve synthesis prompts** — human-readable per-criterion rationale
6. **Update synthesis UI** — per-criterion cards instead of markdown wall
7. **Build ForgeOrchestrator** — standalone service, 6 parallel artifact generators
8. **Add forge API endpoints** — POST/GET /competitions/:id/forge
9. **Build Forge UI tab** — sub-tabs, download buttons, progress states
10. **DB migration** — presentations + forge columns on results table

---

## Files Changed / Created

### New Files
- `packages/orchestrator/src/presentation/presentation-generator.ts`
- `packages/orchestrator/src/forge/forge-orchestrator.ts`
- `packages/orchestrator/src/server/routes/forge.ts`
- `packages/orchestrator/src/db/migrations/0006_presentations_and_forge.sql`

### Modified Files
- `packages/shared/src/constants/states.ts` — add PRESENTING, FORGING, FORGE_COMPLETE
- `packages/shared/src/constants/event-types.ts` — add PRESENTATION_READY, FORGE_STARTED, FORGE_ARTIFACT_READY
- `packages/shared/src/types/competition.ts` — add TeamPresentation type
- `packages/orchestrator/src/engine/competition-runner.ts` — insert PRESENTING phase
- `packages/orchestrator/src/engine/state-machine.ts` — update transitions (if separate)
- `packages/orchestrator/src/synthesis/merge-engine.ts` — improved prompt + schema
- `packages/orchestrator/src/db/schema.ts` — add presentations + forge columns
- `packages/orchestrator/src/db/repository.ts` — save/get presentations and forge
- `packages/orchestrator/src/server/app.ts` — mount forge routes
- `packages/orchestrator/src/server/websocket.ts` — send presentations with result
- `packages/web/app/competitions/[id]/page.tsx` — new tabs, presentations UI, forge UI

---

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Presentation generation adds latency | Parallel generation (both teams simultaneously); ~30s per team |
| Forge API costs (6 Claude calls) | Only triggered manually; show cost estimate before forging |
| Presentation quality varies by deliverable complexity | Fallback: if presentation fails, show raw files with "Presentation unavailable" |
| Forge outputs may not match deliverable quality | Forge prompt includes the actual deliverables, not just summaries |

---

*Phase 4: The Forge — translating AI competition results back into human understanding and actionable build plans.*
