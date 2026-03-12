# Arena4Ai — Sprint Plan Design
**Date:** 2026-03-12
**Lead:** Flynn (chief architect)
**Agents:** Agent-1 (Armory research), Agent-2 (UX/Forge research), Agent-3 (naming research)

---

## Overview

Four focused sprints, each independently shippable:

| Sprint | Name | Focus | Scope |
|--------|------|-------|-------|
| **Sprint 1** | Polish & Naming | Typography, brand, UX, file naming, forge catalog foundations | ~2–3 days |
| **Sprint 2** | Brief Intelligence | `deliverableType` schema, domain hints, brief creation UI | ~1–2 days |
| **Sprint 3** | Agent Armory | DB-backed agent profiles, card gallery, stats, emoji avatars | ~4–5 days |
| **Sprint 4** | Forge as Product Factory | Structured non-markdown outputs, per-domain artifacts, code consumption | ~3–4 days |
| **Sprint 3** | Agent Armory | DB-backed agent profiles, card gallery, stats, emoji avatars | ~4–5 days |

---

## Sprint 1 — Polish & Naming

### Goals
- Fix all font readability issues (the primary complaint)
- Establish the two-font system permanently via design tokens
- Surface the arena4.ai brand consistently across all pages
- Make download filenames human-readable and consistent
- Add new forge artifact types for non-software domains

### 1A — Typography System (two-font strategy)

**Problem:** Orbitron is used everywhere — headings AND body copy. At small sizes Orbitron's tight geometric letterforms are illegible (event feed rows, presentation paragraphs, file paths).

**Solution:** Two named tokens in `packages/web/lib/design-tokens.ts`:

```ts
// Display: headings, nav, badges, kickers, scores, buttons
export const MONOSPACE_FONT = "var(--font-orbitron), 'SF Mono', 'Fira Code', monospace";

// Body: event feed, presentation paragraphs, file paths, descriptions, any sentence-length copy
export const BODY_FONT = "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace";
```

**Updated size tokens (all tested at 120% scale):**

```ts
// Replacing existing too-small values:
KICKER_STYLE.fontSize:   0.55rem → 0.70rem  (10.6px → 13.4px)
FORM_LABEL_STYLE.fontSize: 0.60rem → 0.72rem  (11.5px → 13.8px)
// New token for body copy scale:
export const BODY_FONT_SIZE = '0.72rem';        // 13.8px — event feed, descriptions
export const BODY_FONT_SIZE_SM = '0.68rem';     // 13.1px — metadata, timestamps
export const BODY_LINE_HEIGHT = 1.65;           // generous for readability
```

**Application sweep — files to update:**

| File | What changes |
|------|-------------|
| `packages/web/lib/design-tokens.ts` | Add `BODY_FONT`, `BODY_FONT_SIZE`, `BODY_FONT_SIZE_SM`, `BODY_LINE_HEIGHT`; update `KICKER_STYLE`, `FORM_LABEL_STYLE` sizes |
| `packages/web/app/competitions/[id]/page.tsx` | Event feed rows, presentation tab paragraphs, file path display → `BODY_FONT` |
| `packages/web/app/personas/page.tsx` | System prompt preview, description text → `BODY_FONT` |
| `packages/web/app/page.tsx` | Gallery card description text, event count labels → `BODY_FONT`; filter button sizes → 0.65rem |
| `packages/web/app/briefs/page.tsx` | Brief description/problem text → `BODY_FONT` |
| `packages/web/app/leaderboard/page.tsx` | Stats text, model labels → `BODY_FONT` |
| `packages/web/app/analytics/page.tsx` | Any body/stat text → `BODY_FONT` |
| `packages/web/app/compare/page.tsx` | Any body/stat text → `BODY_FONT` |
| `packages/web/app/competitions/new/page.tsx` | Brief description fields, form helper text → `BODY_FONT` |
| `packages/web/app/tournaments/[id]/page.tsx` | Match history text → `BODY_FONT` |

**Rule (for all future development):**
- `MONOSPACE_FONT` → page titles, H1, H2, nav links, model badges, state badges, tab labels, kickers, score numbers, button text, any ALL-CAPS label
- `BODY_FONT` → any sentence, paragraph, description, event text, file path, system prompt, quote, body copy

### 1B — Brand Visibility

**Problem:** "Arena4Ai" / "arena4.ai" appears only in the TopBar. Users don't associate the app with the brand.

**Changes:**

1. **Global footer** — add to `packages/web/app/layout.tsx`:
   ```tsx
   <footer style={{
     borderTop: '1px solid #0a2235',
     padding: '1rem 1.5rem',
     textAlign: 'center',
     fontSize: '0.65rem',
     color: '#3d7d94',
     fontFamily: BODY_FONT,
     letterSpacing: '1px',
   }}>
     arena4.ai — competitive AI orchestration
   </footer>
   ```

2. **Hero kicker update** — all page heroes currently say e.g. `◆ Leaderboard`. Update to `◆ ARENA4AI | LEADERBOARD` pattern — reinforces the brand on every page without changing the visual hierarchy.

3. **Emoji standardization** — standardize on `⚔` (non-emoji codepoint) across all components. Search and replace `⚔️` → `⚔` in all `.tsx` files.

4. **Empty state copy** — replace generic placeholder text with Arena4Ai-voiced copy:
   - Gallery empty: `"No battles recorded. ⚔ Run the first match to claim the arena."`
   - Leaderboard empty: `"No champions yet — the arena awaits its first victor."`
   - Briefs empty: `"Brief archive is empty — forge a new competition or import a preset."`

### 1C — File Naming Convention

**Problem:** Download filenames are either cryptic UUIDs or lack enough context to know what you're looking at outside the app.

**New convention:**

```
arena4ai_{brief-slug}_{qualifier}_{date}_{type}.zip
```

Where:
- `brief-slug`: `brief.id` if set, else `title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)`
- `qualifier`: model-persona for deliverables (`claude-architect`), source for forge (`winner`/`loser`/`synthesis`)
- `date`: `YYYYMMDD` from competition `startedAt`
- `type`: `deliverables` / `forge` / `forge-run`

**Examples:**

| Download | Old name | New name |
|----------|----------|----------|
| Team deliverables | `claude-architect-files.zip` | `arena4ai_fizzbuzz-cli_claude-architect_20260312_deliverables.zip` |
| Forge all-artifacts | `fizzbuzz-cli-forge.zip` | `arena4ai_fizzbuzz-cli_winner_20260312_forge.zip` |
| Forge per-run | `forge-run-a1f2c3d4.zip` | `arena4ai_fizzbuzz-cli_winner_20260312-163522_forge-run.zip` |
| Fallback (no team) | `team-a8f3b2c1-files.zip` | `arena4ai_fizzbuzz-cli_team-a_20260312_deliverables.zip` |

**New utility:** `packages/orchestrator/src/utils/naming.ts`

```ts
export function slugifyBrief(brief: Brief, maxLen = 60): string
export function formatDateCompact(date: Date | string): string      // YYYYMMDD
export function formatDateTimestamp(date: Date | string): string    // YYYYMMDD-HHMMSS
export function buildDeliverableFilename(brief: Brief, team: Team, startedAt?: string): string
export function buildForgeFilename(brief: Brief, source: ForgeSource, generatedAt?: string): string
```

**Files to change:**
- `packages/orchestrator/src/utils/naming.ts` (new — ~80 lines)
- `packages/orchestrator/src/server/routes/competitions.ts` — lines 259–263 (forge zip), lines 415–420 (deliverables zip)
- `packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts` — fetch competition to get brief slug, update filename
- `packages/web/app/api/competitions/[id]/deliverables/[teamId]/download/route.ts` — naming convention already applied via orchestrator Content-Disposition pass-through; verify header is forwarded correctly

**Internal ZIP structure:** Add `_manifest.json` at ZIP root for deliverables and `_metadata.json` for forge runs:
```json
// _manifest.json (deliverables)
{ "competitionId": "...", "briefId": "...", "briefTitle": "...",
  "teamId": "...", "teamModel": "claude", "teamPersona": "architect",
  "collectedAt": "...", "arena4aiVersion": "2.0" }
```

### 1D — Forge Catalog Additions (simple)

**Problem:** Forge always defaults to software artifacts even for marketing/research/creative briefs.

**Changes to `packages/orchestrator/src/forge/forge-orchestrator.ts`:**

1. **Increase AI domain-selection timeout:** 30s → 60s (line 537: `runClaude(selectionPrompt, ..., 30_000)` → `60_000`)

2. **Add missing format defaults:**
   ```ts
   const FORMAT_DOMAIN_DEFAULTS = {
     // existing...
     BRAINSTORM: { domain: 'ideation',  types: ['concept_canvas', 'mvp_definition', 'hypothesis_backlog', 'decision_framework'] },
     RESEARCH:   { domain: 'research',  types: ['evaluation_matrix', 'vendor_scorecard', 'decision_framework', 'decision_log'] },
     PITCH:      { domain: 'creative',  types: ['presentation_structure', 'messaging_guide', 'content_outline', 'concept_canvas'] },
   };
   ```

3. **Add 4 new artifact types** to `ARTIFACT_CATALOG` AND extend the `ForgeArtifactType` union in `packages/shared/src/types/forge.ts`:
   - `sql_schema` — raw SQL schema output (for software domain)
   - `environment_template` — `.env.example` template
   - `slide_deck` — slide-by-slide outline with actual copy (for creative domain)
   - `spreadsheet_export` — CSV-formatted comparison matrix (for research domain)

   Note: `decision_framework` referenced in the RESEARCH default above already exists in the catalog — no addition needed for it.

4. **Fix generic default** — change from always `software` to use AI selection result even on fallback; only use `software` if AI call errors:
   ```ts
   const GENERIC_DEFAULT = { domain: 'software', types: ['roadmap', 'task_graph', 'repo_blueprint', 'decision_log'] };
   // Used ONLY as error fallback, not as timeout fallback
   ```

### Sprint 1 — Acceptance Criteria

- [ ] All body/sentence text uses `BODY_FONT` (SF Mono); Orbitron reserved for display elements only
- [ ] No font size below 0.65rem anywhere in the app
- [ ] `KICKER_STYLE` and `FORM_LABEL_STYLE` updated in design-tokens.ts; all pages pick up change automatically
- [ ] `arena4.ai` footer visible on every page
- [ ] All page hero kickers follow `◆ ARENA4AI | PAGE NAME` pattern
- [ ] `⚔` standardized (no `⚔️` remaining)
- [ ] Empty states use Arena4Ai-voiced copy
- [ ] All 3 download types produce human-readable filenames matching new convention
- [ ] `_manifest.json` / `_metadata.json` present inside ZIPs
- [ ] Forge domain-selection timeout = 60s
- [ ] 3 new format defaults (BRAINSTORM, RESEARCH, PITCH) in forge
- [ ] 4 new artifact types available in forge catalog
- [ ] 159 existing tests still passing; new naming utility has unit tests

---

## Sprint 2 — Brief Intelligence

### Goals
- Allow briefs to declare what kind of output they expect
- Stop agents from generating Python for non-code tasks
- Give Forge a reliable domain signal beyond guessing from text

### 2A — `deliverableType` Schema Field

**New field in `packages/shared/src/schemas/brief.schema.ts`:**

```ts
export const DeliverableType = z.enum([
  'code',          // runnable files (.py, .js, .ts, .go, etc.)
  'document',      // written output (.md, .pdf, .txt)
  'analysis',      // data/spreadsheet output
  'presentation',  // slides, visual assets
  'plan',          // strategy, roadmap, architecture doc
  'mixed'          // combination expected
]);

export const briefSchema = z.object({
  // ... existing fields unchanged ...
  deliverableType: DeliverableType.default('code'),   // backward compat default
  domainHint: z.enum(['software','research','creative','security','business','ideation']).optional(),
});
```

**Type update** in `packages/shared/src/types/index.ts`:
```ts
export interface Brief {
  // ... existing ...
  deliverableType?: 'code' | 'document' | 'analysis' | 'presentation' | 'plan' | 'mixed';
  domainHint?: 'software' | 'research' | 'creative' | 'security' | 'business' | 'ideation';
}
```

### 2B — Agent Prompt Injection

In `packages/orchestrator/src/adapters/base-adapter.ts`, the `injectBrief()` method adds a `[COMPETITION RULES]` section. Extend it to include deliverable type guidance:

```ts
// Added to [COMPETITION RULES] block:
const deliverableGuide = {
  code:         'Produce runnable code files. The output should be executable.',
  document:     'Produce written documents (.md, .txt). Do NOT write code files unless explicitly required.',
  analysis:     'Produce data analysis output (.csv, .md tables, charts). Focus on data, not code.',
  presentation: 'Produce a presentation outline or slide content. Written format preferred.',
  plan:         'Produce a strategic plan, roadmap, or architecture document in Markdown.',
  mixed:        'Produce whichever combination of code and documents best addresses the brief.',
}[brief.deliverableType ?? 'code'];

// Injected into brief prompt:
`[DELIVERABLE FORMAT] ${deliverableGuide}`
```

### 2C — Forge Domain Signal

In `packages/orchestrator/src/forge/forge-orchestrator.ts`, update `selectDomainArtifacts()` to prioritize explicit signal:

Sprint 1D must also define `DOMAIN_TYPE_DEFAULTS` in `forge-orchestrator.ts` (a new constant parallel to `FORMAT_DOMAIN_DEFAULTS`, keyed by `ForgeDomain` rather than `brief.format`):

```ts
// New constant to add in Sprint 1D alongside FORMAT_DOMAIN_DEFAULTS:
const DOMAIN_TYPE_DEFAULTS: Record<ForgeDomain, ForgeArtifactType[]> = {
  software:  ['roadmap', 'task_graph', 'repo_blueprint', 'decision_log'],
  research:  ['evaluation_matrix', 'vendor_scorecard', 'decision_framework', 'decision_log'],
  creative:  ['presentation_structure', 'messaging_guide', 'content_outline', 'concept_canvas'],
  security:  ['threat_model', 'attack_surface', 'remediation_plan', 'risk_register'],
  business:  ['business_case', 'go_to_market', 'stakeholder_map', 'decision_framework'],
  ideation:  ['concept_canvas', 'mvp_definition', 'hypothesis_backlog', 'decision_framework'],
};
```

```ts
async function selectDomainArtifacts(brief: Brief): Promise<{ domain: ForgeDomain; types: ForgeArtifactType[] }> {
  // 1. Explicit domainHint wins immediately — no AI call needed
  if (brief.domainHint) {
    const types = DOMAIN_TYPE_DEFAULTS[brief.domainHint] ?? GENERIC_DEFAULT.types;
    return { domain: brief.domainHint, types };
  }
  // 2. deliverableType maps to domain hint
  const typeToDomainhint: Record<string, ForgeDomain> = {
    code: 'software', document: 'creative', analysis: 'research',
    presentation: 'creative', plan: 'business',
  };
  if (brief.deliverableType && brief.deliverableType !== 'mixed') {
    // Still run AI selection but seed the prompt with the hint
  }
  // 3. Fall through to existing AI selection...
}
```

### 2D — Brief Creation UI

In `packages/web/app/competitions/new/page.tsx`, add a "Deliverable Type" selector in Step 2 (Brief Definition):

- Displayed as icon-pills: `</> Code` · `📄 Document` · `📊 Analysis` · `🎨 Presentation` · `🗺 Plan` · `⚡ Mixed`
- Selecting "Document" updates the deliverables placeholder: `"e.g., analysis.md, findings.pdf"`
- Selecting "Code" keeps existing placeholder: `"e.g., solution.py, main.ts"`
- `domainHint` is optional, exposed as an "Advanced" collapsed section

### Sprint 2 — Acceptance Criteria

- [ ] `deliverableType` field exists in Brief schema with backward-compat default of `'code'`
- [ ] `domainHint` field exists (optional)
- [ ] `injectBrief()` includes deliverable format guidance in agent prompt
- [ ] Forge domain selection respects `domainHint` and `deliverableType` signals
- [ ] Brief creation UI has deliverable type picker in Step 2
- [ ] YAML brief files can include `deliverableType:` field (parser updated)
- [ ] Existing tests pass; new tests cover prompt injection and domain selection

---

## Sprint 3 — Agent Armory

### Goals
- Replace the localStorage-only `/personas` page with a DB-backed Agent Armory
- Migrate existing localStorage personas automatically on first visit
- Seed all built-in system personas (architect, speedrunner, etc.) as DB records
- Enable emoji avatars colored by model (Claude orange, Codex blue, Gemini cyan)
- Show win/loss stats and avg score on agent cards, auto-populated from competition results
- Support fork, retire, tags, and model variant selection

### 3A — Data Model

**New table: `agent_profiles`**

```sql
CREATE TABLE agent_profiles (
  id                  TEXT PRIMARY KEY,              -- 'agent-{uuid}'
  name                TEXT NOT NULL,                 -- "The Architect"
  description         TEXT,                          -- short bio
  provider            TEXT NOT NULL                  -- 'claude' | 'codex' | 'gemini'
    CHECK (provider IN ('claude', 'codex', 'gemini')),
  model_variant       TEXT NOT NULL,                 -- 'claude-sonnet-4-5', 'codex-standard', etc.
  system_prompt       TEXT NOT NULL,
  avatar              TEXT,                          -- emoji character e.g. '🧠'
  tags                JSONB,                         -- ["fast", "testing"]
  retired             BOOLEAN DEFAULT FALSE,
  created_by          TEXT NOT NULL,                 -- 'system' | user-id
  forked_from_id      TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
  -- Denormalized stats (refreshed after each competition SCORED event)
  stats_wins          INTEGER DEFAULT 0,
  stats_losses        INTEGER DEFAULT 0,
  stats_total         INTEGER DEFAULT 0,
  stats_avg_score     NUMERIC,
  stats_last_used_at  TIMESTAMP WITH TIME ZONE,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_agent_profiles_provider ON agent_profiles(provider);
CREATE INDEX idx_agent_profiles_retired  ON agent_profiles(retired);
```

**Seed data (built-in system personas):**
- pragmatist, architect, researcher, speedrunner, adversarial, defender, pioneer (Claude)
- standard (Codex)
- standard (Gemini)

All seeded with `created_by = 'system'`, `retired = false`, stats at zero.

### 3B — API Endpoints

Added to `packages/orchestrator/src/app.ts`:

| Method | Path | Action |
|--------|------|--------|
| `GET` | `/agent-profiles` | List all (filter: `?provider=claude&tags=fast&retired=false`) |
| `POST` | `/agent-profiles` | Create custom profile |
| `GET` | `/agent-profiles/:id` | Fetch one |
| `PATCH` | `/agent-profiles/:id` | Update (name, description, systemPrompt, avatar, tags, modelVariant) |
| `DELETE` | `/agent-profiles/:id` | Soft delete (sets `retired = true`) |
| `POST` | `/agent-profiles/:id/fork` | Fork → creates new profile with `forkedFromId` set |

Stats are updated automatically — no dedicated stats endpoint needed (they're on the profile object).

**Web proxy routes** (Next.js `app/api/agent-profiles/`):
- `route.ts` — GET list + POST create
- `[id]/route.ts` — GET one + PATCH update + DELETE retire
- `[id]/fork/route.ts` — POST fork

### 3C — UI — `/agent-armory` Page

**Layout:** Card gallery (same pattern as competition gallery — chosen for consistency).

**Card anatomy:**
```
┌─────────────────────────────────────┐
│  🧠  (emoji, model-colored circle)  │
│  The Architect          [CLAUDE]    │
│  claude · sonnet-4-5 · ⟨fork badge⟩│
│  ─────────────────────────────────  │
│  "fast", "design", "architecture"   │
│  ─────────────────────────────────  │
│  12W / 4L   ·   0.87 avg   ·  SPRINT│
│  ─────────────────────────────────  │
│  [⚔ Use in Battle] [Edit] [Fork]    │
└─────────────────────────────────────┘
```

- Avatar: emoji in a circle, circle color = model color (Claude `#ff6600`, Codex `#0066ff`, Gemini `#00f0ff`)
- Model badge: pill with model brand color (existing `getModelColor()`)
- Tags: small chips in muted cyan
- Stats: wins/losses/avg score auto-populated; grayed out with "—" if no competitions yet
- System personas: show a `SYSTEM` badge; can be forked but not deleted or edited
- Retired agents: shown in a collapsed "Retired" section at page bottom

**Filter bar:** All · claude · codex · gemini · [tag chips] · Show retired toggle

**Create/Edit form fields:**
- Name (required)
- Provider pill selector (claude / codex / gemini)
- Model variant dropdown (claude-sonnet-4-5, claude-opus-4, claude-haiku, codex-standard, gemini-2-flash, gemini-1-5-pro)
- Avatar emoji picker (emoji grid, colored by selected provider)
- Description
- Tags (free-form chips)
- System prompt (textarea, required)

### 3D — LocalStorage Migration

On first load of `/agent-armory`, if `localStorage.getItem('arena4ai:personas')` returns data:
- Show a non-blocking banner: `"Found X saved personas. Import them to the Armory? [Import] [Dismiss]"`
- On "Import": POST each persona to `/agent-profiles`, clear localStorage key, dismiss banner
- On "Dismiss": set a `arena4ai:personas-migrated` flag so banner never shows again

### 3D.5 — model_variant Routing

`model_variant` is stored on `AgentProfile` and shown in the UI. At competition runtime, the adapter receives a resolved `systemPrompt` string but currently ignores variant. For Sprint 3 MVP, `model_variant` is **display-only** — the adapters continue to use their default model version. Full variant routing (passing `--model claude-opus-4` to the CLI) is deferred to Sprint 3 stretch / v4. The competition runner will pass `agentProfile.systemPrompt` to the adapter; `model_variant` is stored in the snapshot for future use.

**Stats lookup matching key:** When a competition reaches `SCORED`, look up `agent_profiles` using `(provider, name)` where `provider` = parsed model prefix and `name` = parsed persona from the `team.model` string (e.g. `claude:architect` → `provider='claude', name='architect'`). For custom agents created through the Armory and used via the Armory picker, the competition team record will store `agentProfileId` directly — use that for an exact-ID lookup. Both paths must be handled in the stats update logic.

### 3E — Stats Auto-Population

In `packages/orchestrator/src/engine/competition-runner.ts`, after state transitions to `SCORED`:
- For each team in the competition, look up `agent_profiles` by `model:persona` string
- Increment `stats_wins` or `stats_losses`, update `stats_avg_score`, set `stats_last_used_at`
- This is a fire-and-forget update (don't block competition flow)

### 3F — Competition Creation Update

In `packages/web/app/competitions/new/page.tsx`, Step 3 (Teams):
- Replace the current "model + built-in persona dropdown" with an **Agent Armory picker**
- Search/filter by name, model, tags
- Show mini-card with avatar, stats, tags
- Still allows typing `claude:architect` directly (backward compat)
- "Go to Armory" link if user wants to create a new profile first

### Sprint 3 — Acceptance Criteria

- [ ] `agent_profiles` table created with migration; all 9 system personas seeded
- [ ] API: all 6 endpoints working (list, create, get, update, retire, fork)
- [ ] `/agent-armory` page renders card gallery with filter bar
- [ ] Agent cards show emoji avatar (colored by model), name, provider badge, tags, stats
- [ ] Create/edit form works with all fields including emoji picker and model variant
- [ ] Fork creates new profile with `forkedFromId` set; UI shows fork lineage badge
- [ ] System personas show `SYSTEM` badge; cannot be edited or deleted (fork only)
- [ ] Retired agents collapsed at page bottom, not shown in battle picker
- [ ] LocalStorage migration banner appears if legacy personas exist; import works
- [ ] `/personas` redirects to `/agent-armory` (301)
- [ ] Competition creation Step 3 uses Armory picker
- [ ] Stats update after competition reaches `SCORED` state
- [ ] All existing tests pass; new tests for AgentProfileRepository and stats update logic

---

## Sprint 4 — Forge as Product Factory (planned, post-Armory)

**Depends on:** Sprint 1 (catalog pattern + `DOMAIN_TYPE_DEFAULTS`) and Sprint 2 (`deliverableType` + `domainHint` signals)

### Goals
With reliable domain signals from Sprint 2 and the catalog pattern established in Sprint 1, Sprint 4 focuses entirely on making Forge output genuinely human-usable products — not just markdown planning docs.

### Scope (to be fully specced before Sprint 4 begins)

- **Structured artifact outputs per domain:**
  - Software: `.sql` schema files, `.env.example`, Dockerfile, GitHub Actions YAML (runnable, not markdown)
  - Creative: slide deck outlines with actual copy per slide, brand guidelines with color/font specs
  - Research: `.csv` comparison matrices importable to Google Sheets, bibliography with live URLs
  - Business: financial model template (formula-ready), Gantt timeline data, org chart (Mermaid)

- **Forge output format routing:** Each artifact spec declares its `outputFormat: 'markdown' | 'sql' | 'json' | 'csv' | 'yaml'`; the ZIP organizes by format and the UI renders/previews accordingly

- **Forge consuming code files more deeply:** For software briefs, Forge reads the winning team's actual code and produces a cleaned reference implementation + test suite template based on it (currently code is included in context but the artifacts don't reference it meaningfully)

- **Per-artifact download:** UI adds individual download buttons per artifact (not just "Download All") with correct file extensions (`.sql`, `.csv`, `.md`)

### Dependencies
```
Sprint 1 — establishes DOMAIN_TYPE_DEFAULTS, catalog pattern, 4 new types
    ↓
Sprint 2 — adds deliverableType + domainHint signals; Forge knows its domain reliably
    ↓
Sprint 4 — builds structured output types on top of reliable domain routing
```

Sprint 3 (Armory) is independent and can run before or after Sprint 4.

---

## Cross-Sprint Dependencies

```
Sprint 1 ──────────────────────────────▶ independent
Sprint 2 ──────────────────────────────▶ independent (can run in parallel with S1)
Sprint 3 ──────────────────────────────▶ independent (builds on existing personas page)
Sprint 4 ──────────────────────────────▶ requires Sprint 1 + Sprint 2 complete first
```

Recommended execution order: S1 → S2 → S3 → S4  (or S1+S2 in parallel, then S3, then S4)

---

## Files Changed — Master List

### Sprint 1
- `packages/shared/src/types/forge.ts` — extend `ForgeArtifactType` union with 4 new types
- `packages/web/lib/design-tokens.ts` — BODY_FONT token, size fixes
- `packages/web/app/layout.tsx` — footer
- `packages/web/components/TopBar.tsx` — kicker pattern
- `packages/web/app/globals.css` — ⚔ standardization, any inline font remnants
- `packages/web/app/page.tsx` — body font, empty state copy, kicker
- `packages/web/app/competitions/[id]/page.tsx` — event feed, presentation text
- `packages/web/app/briefs/page.tsx` — body font, empty state
- `packages/web/app/leaderboard/page.tsx` — body font, kicker
- `packages/web/app/analytics/page.tsx` — body font
- `packages/web/app/compare/page.tsx` — body font
- `packages/web/app/competitions/new/page.tsx` — body font for form helpers
- `packages/web/app/personas/page.tsx` — body font for system prompt, description
- `packages/web/app/tournaments/[id]/page.tsx` — body font
- `packages/orchestrator/src/utils/naming.ts` (new)
- `packages/orchestrator/src/server/routes/competitions.ts` — naming endpoints
- `packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts` — naming
- `packages/web/app/api/competitions/[id]/forge/download/route.ts` — naming fallback
- `packages/web/app/api/competitions/[id]/deliverables/[teamId]/download/route.ts` — verify Content-Disposition pass-through from orchestrator is forwarded correctly
- `packages/orchestrator/src/forge/forge-orchestrator.ts` — timeout, defaults, new artifacts

### Sprint 2
- `packages/shared/src/schemas/brief.schema.ts` — add deliverableType + domainHint fields
- `packages/orchestrator/src/brief/` (brief parser / YAML loader) — confirm Zod schema update covers YAML-loaded briefs; no separate change needed if the schema is the single validation point
- `packages/shared/src/types/index.ts`
- `packages/orchestrator/src/adapters/base-adapter.ts` — injectBrief()
- `packages/orchestrator/src/forge/forge-orchestrator.ts` — domain selection
- `packages/web/app/competitions/new/page.tsx` — deliverable type picker

### Sprint 3
- `packages/orchestrator/src/db/schema.ts` — agent_profiles table
- `packages/orchestrator/src/db/migrations/` — new migration file
- `packages/orchestrator/src/db/repository.ts` — AgentProfile CRUD
- `packages/orchestrator/src/app.ts` — 6 new endpoints
- `packages/orchestrator/src/engine/competition-runner.ts` — stats update on SCORED
- `packages/shared/src/types/index.ts` — AgentProfile type
- `packages/web/app/agent-armory/page.tsx` (new)
- `packages/web/app/personas/page.tsx` — redirect to /agent-armory
- `packages/web/components/TopBar.tsx` — update nav link label from "Personas" to "Armory" and href from `/personas` to `/agent-armory`
- `packages/web/app/api/agent-profiles/route.ts` (new)
- `packages/web/app/api/agent-profiles/[id]/route.ts` (new)
- `packages/web/app/api/agent-profiles/[id]/fork/route.ts` (new)
- `packages/web/components/AgentCard.tsx` (new)
- `packages/web/components/EmojiPicker.tsx` (new)
- `packages/web/app/competitions/new/page.tsx` — Armory picker in Step 3

---

## Design Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sprint structure | 3 sequential sprints | S1 = fast wins, S2 = schema, S3 = Armory; each independently shippable |
| Typography strategy | Two-font (Orbitron display, SF Mono body) | Orbitron illegible at small body sizes; SF Mono already in fallback chain |
| Font size floor | 0.65rem minimum | At 120% scale = 12.5px; meets WCAG AA |
| Armory storage | DB-backed (PostgreSQL) | localStorage is ephemeral; need stats, persistence, migration path |
| Armory layout | Card gallery | Consistent with gallery/briefs pages; cards scale well 5–50 agents |
| Avatar type | Emoji only, colored by model | Zero infrastructure; model colors already in design-tokens.ts |
| File naming | `arena4ai_{brief}_{qualifier}_{date}_{type}.zip` | Human-readable outside app; brief-slug gives context; date enables sorting |
| Forge timeout | 30s → 60s | Reduce software-domain fallback rate when Claude is slow |
| deliverableType default | `'code'` | Backward compat; all existing briefs effectively become code briefs |
| localStorage migration | One-click import banner | Non-blocking; user controls timing; clears after import |
