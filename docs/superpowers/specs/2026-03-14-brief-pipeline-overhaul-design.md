# Sprint 5: Brief Pipeline Overhaul

**Date:** 2026-03-14
**Status:** Design approved, pending implementation plan
**Goal:** Transform the brief pipeline from a code-competition-centric single-shot generator into a full-spectrum, domain-aware, self-improving system that carries rich context through every stage from intake to forge.

## Problem Statement

The current pipeline was built for code competitions. Three systemic failures:

1. **The brief generator produces shallow briefs.** One prompt, one template, coding-interview criteria (`correctness`, `code-quality`, `efficiency`). No domain awareness. No `deliverableType` or `domainHint` set. Problem statements are 2-4 generic sentences vs. the detailed paragraphs in hand-crafted YAML briefs.

2. **The AI judge is context-blind.** It receives only rubric criteria descriptions and raw files — not the problem statement, constraints, expected deliverables, or title. It can't assess whether the work addresses the problem, honors constraints, or produced the expected files. Result: 7 of 11 completed competitions have a score spread under 0.05 ("all 8s" pattern).

3. **Context leaks between pipeline stages.** Each LLM-calling stage sees a different ad-hoc slice of the brief. Constraints are missing from synthesis. Weights are missing from presentations. The judge sees unlimited file sizes while presentations see 8K truncated versions.

## Evidence from Existing Data

11 completed competitions in DB. Score spread analysis:

| Competition | Spread | Pattern |
|---|---|---|
| Voice-to-Sheet | 0.005 | All 8s |
| AI Lesson Plan | 0.005 | All 8s |
| Chaos Alpha (run 1) | 0.005 | All 8s |
| Enneagram Toolkit | 0.000 | Dead tie |
| Backyard Planner | 0.000 | Dead tie |
| Chaos Alpha (run 2) | 0.025 | Mild |
| Launch Strategy | 0.025 | Mild (3 teams) |
| Debate Championship | 0.050 | Marginal |
| Co-Founder Conflict | 0.090 | Decent |
| Enneagram Framework | 0.360 | Strong |
| Revenue Engine | 0.360 | Strong |

The two competitions with strong differentiation (Enneagram Framework, Revenue Engine) both had specific, domain-grounded criteria. The rest had generic criteria and the judge gave everyone 8s.

## Architecture Overview

Three layers, each independently valuable, built in dependency order:

```
USER IDEA
    |
    v
+----------------------------------+
|  LAYER 2: INTELLIGENT GENERATOR  |
|  Intake -> Generate -> Quality   |<---- getGeneratorLearnings()
|  -> Editable Preview             |
+----------------------------------+
    |
    v
+----------------------------------+
|  LAYER 1: PIPELINE CONTEXT FIX   |
|  Full brief -> Judge, Presenter, |
|  Synthesis, Forge via shared     |
|  buildBriefContext() utility      |
+----------------------------------+
    |
    v
+----------------------------------+
|  LAYER 3: FEEDBACK TELEMETRY     |
|  Post-completion quality analysis |
|  -> brief_quality_signals table  |
|  -> feeds back into Layer 2      |
+----------------------------------+
```

Build order: Layer 1 first (small scope, immediate impact), then Layer 2 (new front door), then Layer 3 (learning loop), then Brief Library (persistence).

---

## Layer 1: Pipeline Context Fix

### Shared Utility

**New file:** `packages/orchestrator/src/utils/brief-context.ts`

```ts
interface BriefContextOptions {
  include: ('title' | 'problem' | 'constraints' | 'deliverables' | 'rubric' | 'format' | 'deliverableType')[];
  rubricDetail: 'full' | 'weights-only' | 'descriptions-only';
  fileTruncation?: number;   // chars per file, default 8000
  fileBudget?: number;       // total chars across all files, default 50000
}

function buildBriefContext(brief: Brief, options: BriefContextOptions): string
```

Returns a formatted markdown string with the requested brief sections. Every LLM-calling stage uses this instead of hand-building brief sections.

### Changes Per Stage

**AI Judge (`packages/orchestrator/src/judging/ai-judge.ts`)**
- Today: rubric criteria + raw files only. No problem, no constraints, no title, no file truncation.
- After: full brief context (title, problem, constraints, deliverables list, rubric with maxScore). File truncation at 12,000 chars/file, 80,000 total budget.
- New prompt structure:

```
You are an impartial competition judge.

## Competition Brief
${buildBriefContext(brief, {
  include: ['title', 'problem', 'constraints', 'deliverables'],
  rubricDetail: 'full'
})}

## Deliverable Files
${truncatedFiles}

## Your Task
Score this team's deliverables against each criterion. Consider:
1. Does the work address the original problem?
2. Were the stated constraints honored?
3. Were the expected deliverables produced?
4. Quality and depth per criterion.
Be specific — reference actual content from the deliverables in your commentary.
Differentiate: if two teams both attempt the same criterion, one is likely stronger. Say why.

Return ONLY a JSON object:
{ "scores": [{ "criterionId": "<id>", "score": <0-maxScore>, "commentary": "<2-3 sentences referencing specific deliverable content>" }] }
```

**Presentation Generator (`packages/orchestrator/src/presentation/presentation-generator.ts`)**
- Add: `brief.title`, `rubric.weight` (so presenter emphasizes what matters most), `brief.deliverables` (so it can note missing files)
- Keep: 8K file truncation (presentations are summaries)
- Use `buildBriefContext()` for the brief section of the prompt

**Synthesis (`packages/orchestrator/src/synthesis/merge-engine.ts`)**
- Add: `brief.constraints` (currently missing), `brief.title`
- Use `buildBriefContext()` for the brief section of the prompt

**Forge (`packages/orchestrator/src/forge/forge-orchestrator.ts`)**
- Already has the most context. Normalize `buildForgeUserPrompt()` to use `buildBriefContext()`.
- No major content additions needed.

### File Truncation Standardization

| Stage | Per-file limit | Total budget | Rationale |
|---|---|---|---|
| Presentation | 8,000 chars | 50,000 chars | Summaries, not deep analysis |
| AI Judge | 12,000 chars | 80,000 chars | Needs to see more for accurate scoring |
| Synthesis | 8,000 chars | 50,000 chars | Comparative analysis, not file-level |
| Forge | 6,000 chars | 40,000 chars | Generating artifacts, not scoring |

### Re-evaluate CLI Command

**New CLI command:** `re-evaluate`

```bash
# Re-judge a single competition
npx tsx packages/orchestrator/src/cli.ts re-evaluate <competition-id> --stage judge

# Re-run all downstream stages
npx tsx packages/orchestrator/src/cli.ts re-evaluate <competition-id> --stage all

# Batch re-evaluate all completed competitions
npx tsx packages/orchestrator/src/cli.ts re-evaluate --all --stage judge
```

Stages: `judge`, `presentation`, `synthesis`, `all` (presentation -> judge -> synthesis in order).

Reads deliverables from the `results` table, re-runs specified stages with `buildBriefContext()`, writes new results back. Original results backed up to `results_history` table with timestamp.

**Stage dependency behavior:**
- `--stage judge` re-runs judging only, using existing presentations. Does NOT trigger quality analysis.
- `--stage presentation` re-runs presentation only.
- `--stage synthesis` re-runs synthesis only, using current scorecards.
- `--stage all` runs `presentation -> judge -> synthesis` in order (fresh presentations feed into fresh judging).
- Add `--analyze` flag to any stage to also trigger quality analysis after completion.

**New DB table:** `results_history`

```sql
CREATE TABLE results_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stage TEXT NOT NULL,           -- 'judge' | 'presentation' | 'synthesis' | 'all'
  previous_results JSONB NOT NULL  -- snapshot of results row before overwrite
);
CREATE INDEX idx_results_history_competition ON results_history(competition_id);
```

---

## Layer 2: Intelligent Brief Generator

### Backward Compatibility

The existing `POST /generate-brief` endpoint is preserved as a convenience shortcut. It internally chains intake (auto-answering questions with defaults based on domain detection) + generate, returning a full `Brief` object as before. The web UI transitions to the new multi-step flow, but the single-shot endpoint remains available for CLI and API consumers.

### Step 1: Conversational Intake

**New file:** `packages/orchestrator/src/brief/intake.ts`
**New endpoint:** `POST /generate-brief/intake`

**Input:** `{ idea: string }`
**Output:**
```ts
{
  detectedDomain: 'software' | 'business' | 'research' | 'creative' | 'strategy' | 'security' | 'ideation';
  detectedDeliverableType: 'code' | 'document' | 'analysis' | 'presentation' | 'plan' | 'mixed';
  questions: Array<{
    id: string;
    text: string;
    options: string[];  // 2-4 multiple choice options
  }>;
}
```

The intake prompt:
1. Classifies the domain and deliverable type from the idea
2. Generates 1-3 targeted questions specific to what the user described
3. Question count adapts: clear ideas get 1 question, vague ideas get 3

Questions focus on:
- What data/context will agents have to work with?
- What should the deliverable look like?
- What does "good" mean for this problem? (drives criterion generation)

### Step 2: Domain-Aware Generation

**New file:** `packages/orchestrator/src/brief/domain-templates.ts`
**Updated endpoint:** `POST /generate-brief/generate`

**Input:** `{ idea: string, answers: Record<string, string>, domain: string, deliverableType: string, format?: string }`
**Output:** Full `Brief` object (matching `briefSchema`)

Seven domain-specific prompt templates:

| Domain | System prompt focus | Exemplar criteria style |
|---|---|---|
| `software` | Architecture, correctness, edge cases, runnable output | `error-handling`, `api-design`, `test-coverage` |
| `business` | Data reasoning, feasibility, financial grounding, actionability | `financial-accuracy`, `market-insight`, `actionability` |
| `research` | Methodology, evidence quality, rigor, reproducibility | `methodology`, `evidence-depth`, `reproducibility` |
| `creative` | Originality, craft, audience impact, voice | `voice-consistency`, `structural-innovation`, `emotional-impact` |
| `strategy` | Systems thinking, tradeoffs, implementation path | `systems-thinking`, `feasibility`, `tradeoff-honesty` |
| `security` | Threat modeling, defense depth, operational realism | `threat-coverage`, `defense-depth`, `operational-realism` |
| `ideation` | Concept exploration, hypothesis formation, MVP scoping | `concept-clarity`, `hypothesis-quality`, `mvp-viability` |

**Type alignment:** The existing `Brief.domainHint` and `ForgeDomain` enums in `@arena/shared` include `ideation` but not `strategy`. This sprint adds `strategy` to both enums. The full domain set becomes: `software | business | research | creative | strategy | security | ideation`. The `DOMAIN_TYPE_DEFAULTS` in `forge-orchestrator.ts` and the `FORMAT_DOMAIN_DEFAULTS` mapping must be updated to include `strategy`.

Each template includes:
- Domain-specific system prompt with tone and focus
- 2-3 exemplar criteria drawn from the best hand-crafted briefs (e.g., city-design's `systems-thinking`, startup-autopsy's `financial-accuracy`)
- Anti-patterns: "Do NOT generate criteria like 'code quality' or 'completeness' — these are generic. Criteria must reference specific aspects of the domain."
- Constraint guidance: "Constraints should actually constrain. 'Must be well-tested' is not a constraint. 'Work only from the data provided — do not invent additional facts' is."
- Appropriate deliverable filenames per domain (not `main_file.py` for a strategy brief)
- Appropriate `timeLimitMs` defaults per domain and complexity

The generation prompt also receives `## Learnings from Past Competitions` from Layer 3's `getGeneratorLearnings()` (empty string until Layer 3 is built).

### Step 3: Quality Scorer

**New file:** `packages/orchestrator/src/brief/quality-scorer.ts`
**New endpoint:** `POST /generate-brief/quality`

**Input:** `Brief` object
**Output:**
```ts
interface BriefQualityReport {
  overallScore: number;              // 0-1
  launchReady: boolean;              // true if overallScore > 0.7
  issues: BriefQualityIssue[];
  suggestions: CriterionSuggestion[];
}

interface BriefQualityIssue {
  field: string;        // e.g. 'criteria[2].description', 'constraints'
  severity: 'error' | 'warning';
  message: string;
  suggestion?: string;
}

interface CriterionSuggestion {
  criterionId: string;
  currentDescription: string;
  suggestedDescription: string;
  reason: string;
}
```

**Heuristic checks (instant, no LLM):**
- Criterion descriptions longer than 15 chars (catches `">"` placeholders)
- Constraints array non-empty
- Deliverable filenames have extensions matching `deliverableType`
- Problem statement longer than 200 chars
- Weights sum to 1.0
- No duplicate criterion IDs
- `deliverableType` is set (not defaulting to `code`)

**LLM quality check (one fast call):**
- Prompt: "Given this brief, could you differentiate between a good and bad submission for each criterion? Which criteria are too vague to score meaningfully?"
- Returns per-criterion confidence and suggested rewording for weak criteria

### Step 4: Editable Preview (UI)

**Modified file:** `packages/web/app/competitions/new/page.tsx`

New intake flow replacing the current single-textbox + generate:

```
[Idea textbox] -> [Generate button]
       |
       v
[Intake questions panel] -> [Answer & Generate]
       |
       v
[Editable preview with quality annotations]
  - All fields editable (title, problem, constraints, deliverables, criteria)
  - Quality issues shown inline (red = error, yellow = warning)
  - Weak criteria have a "Sharpen" button (LLM reword)
  - Quality meter (0-100) updates live on edit
  - deliverableType and domainHint as visible dropdowns
  - "Save to Library" button (persists to briefs table)
  - "Launch Competition" button (proceeds to team selection)
```

---

## Layer 3: Feedback Telemetry

### Quality Signals Table

**New migration:** `packages/orchestrator/src/db/migrations/0010_brief_pipeline.sql`

```sql
CREATE TABLE brief_quality_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Score differentiation
  score_spread NUMERIC,
  tied BOOLEAN,
  all_eights BOOLEAN,

  -- Per-criterion signals
  criterion_signals JSONB,
  -- [{ criterionId, scoreSpread, avgScore, commentarySpecific, commentaryGeneric }]

  -- Judge quality
  judge_referenced_problem BOOLEAN,
  judge_referenced_constraints BOOLEAN,
  judge_referenced_deliverables BOOLEAN,

  -- Deliverable signals
  expected_files_produced JSONB,   -- { expected: [], found: [], missing: [] }
  total_files_produced INTEGER,
  total_content_size INTEGER,

  -- Forge signals
  forge_domain_matched BOOLEAN,
  forge_artifacts_downloaded INTEGER DEFAULT 0,

  -- User behavior signals
  brief_was_ai_generated BOOLEAN,
  brief_edit_distance INTEGER,
  competition_rerun BOOLEAN,

  -- Synthesis signals
  synthesis_triggered BOOLEAN,
  synthesis_meaningful BOOLEAN,

  UNIQUE(competition_id)  -- upsert on re-evaluation; one row per competition
);
CREATE INDEX idx_quality_signals_competition ON brief_quality_signals(competition_id);
```

**Upsert behavior:** `analyzeCompetitionQuality()` uses `INSERT ... ON CONFLICT (competition_id) DO UPDATE` so re-evaluation overwrites previous signals rather than creating duplicates.

### Quality Analyzer

**New file:** `packages/orchestrator/src/telemetry/quality-analyzer.ts`

```ts
async function analyzeCompetitionQuality(competitionId: string): Promise<void>
```

Fires automatically when competition state transitions to `COMPLETE`. Also triggered by `re-evaluate --analyze` flag. Uses upsert — re-running overwrites previous signals for that competition. Steps:

1. Read scorecards, deliverables, brief from DB
2. Compute heuristic signals:
   - `score_spread`: winner score minus runner-up
   - `tied`: spread < 0.01
   - `all_eights`: every criterion scored 7-9 for all teams
   - `expected_files_produced`: diff brief.deliverables against actual file paths
   - Per-criterion `scoreSpread`: max - min across teams for each criterion
3. Run one LLM call to analyze judge commentary quality:
   - Does commentary reference specific deliverable content or is it generic?
   - Could this commentary apply to any submission?
4. Write row to `brief_quality_signals`

### Learnings Extractor

**New file:** `packages/orchestrator/src/telemetry/learnings.ts`

```ts
async function getGeneratorLearnings(): Promise<string>
```

Queries `brief_quality_signals` and extracts patterns. Returns a markdown paragraph injected into the Layer 2 generation prompt as `## Learnings from Past Competitions`.

Example output:
```
Based on 15 past competitions:
- Criteria like "code quality" produce undifferentiated scores (avg spread 0.005).
  Prefer criteria that reference specific outputs or domain concepts.
- Business domain briefs need explicit data in the problem statement to avoid generic responses.
- Briefs with 5+ specific constraints average 0.08 score spread vs 0.02 for 0-2 constraints.
- The most differentiating criterion pattern: "[verb] [specific domain artifact]" (e.g., "financial calculations are correct", "governance structure addresses power concentration").
```

### Retroactive Seeding

On first deploy (or via CLI), run `analyzeCompetitionQuality()` on all 11 existing completed competitions. This populates the signals table and gives the generator real learnings from day one.

```bash
npx tsx packages/orchestrator/src/cli.ts seed-quality-signals
```

### User Behavior Tracking

Three lightweight additions:
1. Tag competitions with `aiGenerated: true` when brief came through `/generate-brief`
2. Compute edit distance between generated brief and submitted brief (Levenshtein on JSON-stringified)
3. Increment `forge_artifacts_downloaded` counter on artifact download endpoint hits

---

## Brief Library Persistence

### Briefs Table

**Added to migration 005:**

```sql
CREATE TABLE briefs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brief JSONB NOT NULL,
  source TEXT NOT NULL,           -- 'yaml' | 'generated' | 'competition'
  quality_score NUMERIC,
  tags TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Three Write Paths

1. **Seed from YAML on startup** — existing `briefs/*.yml` files upserted into `briefs` table (source: `'yaml'`) when the server starts. YAML files remain source of truth for hand-crafted briefs.

2. **Save from generator** — "Save to Library" button in `/competitions/new` editable preview. Persists brief with quality score (source: `'generated'`).

3. **Save from competition** — "Save Brief to Library" button on competition detail page. Saves the brief as actually used, which may differ from what was generated (source: `'competition'`).

### API Endpoints

- `GET /briefs` — reads from DB (replaces filesystem read). Returns array of `{ id, title, brief, source, qualityScore, tags, createdAt }`. **Breaking change from current shape** which returns `{ id, title, format, tags, timeLimitMs, problemSnippet, filename }`. The web UI pages that consume this endpoint (`/briefs`, `/competitions/new` briefSlug pre-select, and `packages/web/app/api/briefs/route.ts` proxy) must all be updated in the same commit. The new shape includes the full `brief` object so consumers can extract any field they need (e.g., `brief.problem.slice(0, 200)` replaces `problemSnippet`).
- `POST /briefs` — save a brief to the library. Body: `{ brief, source, tags? }`. Auto-generates `id` from slugified title.
- `PUT /briefs/:id` — update an existing library brief.
- `DELETE /briefs/:id` — remove from library. YAML-sourced briefs cannot be deleted via API (returns 403).

### UI Changes

**`/briefs` page:**
- "+ New Brief" button opens the conversational intake flow (reuses `/competitions/new` intake components, but saves to library instead of launching)
- Source badge on each card: `YAML` | `Generated` | `From Competition`
- Quality score shown as a small meter on each card
- Edit button on each card for tweaking and re-scoring

**`/competitions/new` page:**
- "Save to Library" button in the editable preview step

**`/competitions/[id]` page:**
- "Save Brief to Library" button (visible on COMPLETE/FORGE_COMPLETE competitions)

---

## File Inventory

### New Files

| File | Purpose |
|---|---|
| `packages/orchestrator/src/utils/brief-context.ts` | Shared `buildBriefContext()` utility |
| `packages/orchestrator/src/brief/intake.ts` | Domain detection + question generation |
| `packages/orchestrator/src/brief/domain-templates.ts` | 6 domain-specific generation prompts |
| `packages/orchestrator/src/brief/quality-scorer.ts` | Heuristic + LLM brief quality check |
| `packages/orchestrator/src/telemetry/quality-analyzer.ts` | Post-competition signal extraction |
| `packages/orchestrator/src/telemetry/learnings.ts` | `getGeneratorLearnings()` query |
| `packages/orchestrator/src/db/migrations/0010_brief_pipeline.sql` | `brief_quality_signals`, `briefs`, `results_history` tables |

### Modified Files

| File | Change |
|---|---|
| `packages/orchestrator/src/judging/ai-judge.ts` | Inject full brief context via `buildBriefContext()` |
| `packages/orchestrator/src/presentation/presentation-generator.ts` | Use `buildBriefContext()`, add title/weights/deliverables |
| `packages/orchestrator/src/synthesis/merge-engine.ts` | Add constraints + title via `buildBriefContext()` |
| `packages/orchestrator/src/forge/forge-orchestrator.ts` | Normalize to `buildBriefContext()` |
| `packages/orchestrator/src/engine/competition-runner.ts` | Trigger quality analysis on COMPLETE transition |
| `packages/orchestrator/src/cli.ts` | Add `re-evaluate` and `seed-quality-signals` commands |
| `packages/orchestrator/src/db/schema.ts` | `brief_quality_signals`, `briefs`, `results_history` tables |
| `packages/orchestrator/src/db/repository.ts` | Quality signal CRUD, results history backup, briefs CRUD |
| `packages/orchestrator/src/server/routes/generate-brief.ts` | Rewrite with intake/generate/quality endpoints |
| `packages/orchestrator/src/server/app.ts` | Mount new routes, briefs CRUD |
| `packages/web/app/competitions/new/page.tsx` | Conversational intake flow + quality preview |
| `packages/web/app/briefs/page.tsx` | DB-backed library with source badges, quality scores, CRUD |
| `packages/web/app/competitions/[id]/page.tsx` | "Save Brief to Library" button |
| `packages/web/app/api/briefs/route.ts` | Proxy to new briefs endpoints |

### Unchanged

- `packages/orchestrator/src/adapters/base-adapter.ts` — `injectBrief()` and `DELIVERABLE_GUIDE` work fine
- Adapter subclasses — no execution changes
- Score aggregation logic — math is sound
- Forge artifact types/formats — Sprint 4 work stands
- Remotion video reels — unaffected

---

## Success Metrics

Measurable from the 11 existing competitions (re-evaluated) + new ones:

| Metric | Current | Target |
|---|---|---|
| Average score spread | ~0.03 | > 0.08 |
| Competitions with "all 8s" pattern | 7/11 (64%) | < 20% |
| Judge commentary references specific deliverables | ~30% est. | > 80% |
| Generated briefs quality score (pre-edit) | N/A | > 0.7 |
| Generated briefs with `deliverableType` set | 2/11 (18%) | 100% |
| Brief library entries | 12 (YAML only) | 30+ (mixed sources) |

---

## Build Order

1. **Layer 1** — `buildBriefContext()` + judge/presentation/synthesis/forge integration + re-evaluate CLI
2. **Re-evaluate existing competitions** — validate score spread improvement on all 11
3. **Layer 2** — intake + domain templates + quality scorer + UI
4. **Brief Library** — DB table + CRUD + UI + YAML seed
5. **Layer 3** — quality analyzer + learnings extractor + retroactive seed + feedback injection into Layer 2
6. **Validation** — run 5+ new competitions through the full pipeline, compare metrics

---

## Implementation Notes

### `buildBriefContext` presets

Define named presets so callers don't manually specify includes:

```ts
const JUDGE_CONTEXT: BriefContextOptions = {
  include: ['title', 'problem', 'constraints', 'deliverables', 'rubric'],
  rubricDetail: 'full', fileTruncation: 12000, fileBudget: 80000
};
const PRESENTER_CONTEXT: BriefContextOptions = {
  include: ['title', 'problem', 'constraints', 'deliverables', 'rubric'],
  rubricDetail: 'weights-only', fileTruncation: 8000, fileBudget: 50000
};
// etc.
```

### Quality meter debouncing

The "live quality meter" in the editable preview updates from **heuristic checks only** on every edit (instant, no LLM). The LLM quality check runs on a 2-second debounce after the user stops typing, or on explicit "Check Quality" button press. This avoids excessive LLM calls.

### Rate limits for new endpoints

- `POST /generate-brief/intake` — 20/min (lightweight LLM call)
- `POST /generate-brief/generate` — 10/min (heavy LLM call, same as current `/generate-brief`)
- `POST /generate-brief/quality` — 10/min (LLM call)
- `POST /generate-brief` (legacy shortcut) — 10/min (unchanged)

### YAML brief precedence on startup

YAML files are upserted on startup with `ON CONFLICT (id) DO UPDATE` only when `source = 'yaml'`. This means:
- YAML always overwrites DB for YAML-sourced briefs (YAML is source of truth)
- User edits to YAML-sourced briefs via `PUT /briefs/:id` are overwritten on restart (by design — edit the YAML file instead)
- `generated` and `competition` sourced briefs are never touched by the YAML seed

### Edit distance for user behavior tracking

Compute edit distance on a **normalized subset** of fields (title + problem + constraints + criteria descriptions) rather than the full JSON-stringified brief. This avoids noise from auto-generated fields like `id`, `timeLimitMs` defaults, and JSON key ordering differences.

### Test coverage expectations

New test files:
- `packages/orchestrator/src/utils/__tests__/brief-context.test.ts` — unit tests for `buildBriefContext()` with all preset combinations
- `packages/orchestrator/src/brief/__tests__/quality-scorer.test.ts` — heuristic checks (all passing/failing cases), mock LLM check
- `packages/orchestrator/src/brief/__tests__/intake.test.ts` — domain detection, question generation
- `packages/orchestrator/src/telemetry/__tests__/quality-analyzer.test.ts` — signal computation from mock scorecards/deliverables
- `packages/orchestrator/src/server/__tests__/briefs-crud.test.ts` — CRUD endpoints, YAML seed, source protection
- `packages/orchestrator/src/server/__tests__/re-evaluate.test.ts` — re-evaluate CLI command, results history backup

Target: maintain 100% of existing 211 tests + add 40-60 new tests across the above files.
