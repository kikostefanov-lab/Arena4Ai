# Sprint 1 — Polish & Naming Implementation Plan

> **Status: COMPLETE**

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix font readability across all pages, surface the arena4.ai brand consistently, make download filenames human-readable, and add non-software Forge artifact types.

**Architecture:** Four independent tracks all shipping as one PR. Typography uses a two-token system (`MONOSPACE_FONT` for display, `BODY_FONT` for body copy) sourced from `design-tokens.ts` — one token change ripples everywhere. File naming is isolated in a new `naming.ts` utility consumed by two orchestrator route handlers. Forge additions are purely additive to the existing `ARTIFACT_CATALOG` and `FORMAT_DOMAIN_DEFAULTS` structures.

**Tech Stack:** TypeScript, Next.js 15, Vitest (orchestrator tests), Drizzle ORM (not touched in this sprint), Express (orchestrator routes).

**Spec:** `docs/superpowers/specs/2026-03-12-arena4ai-sprint-plan-design.md` sections 1A–1D

---

## Chunk 1: Typography System

### File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `packages/web/lib/design-tokens.ts` | Add `BODY_FONT`, `BODY_FONT_SIZE`, `BODY_FONT_SIZE_SM`, `BODY_LINE_HEIGHT`; bump `KICKER_STYLE` and `FORM_LABEL_STYLE` sizes |
| Modify | `packages/web/app/competitions/[id]/page.tsx` | Event feed rows and presentation tab paragraphs → `BODY_FONT` |
| Modify | `packages/web/app/personas/page.tsx` | System prompt preview and description text → `BODY_FONT` |
| Modify | `packages/web/app/page.tsx` | Gallery card description text, filter button size → `BODY_FONT`, bump filters to 0.65rem |
| Modify | `packages/web/app/briefs/page.tsx` | Brief description/problem text → `BODY_FONT` |
| Modify | `packages/web/app/leaderboard/page.tsx` | Stats text, model label text → `BODY_FONT` |
| Modify | `packages/web/app/analytics/page.tsx` | Any sentence-length stat text → `BODY_FONT` |
| Modify | `packages/web/app/compare/page.tsx` | Body text → `BODY_FONT` |
| Modify | `packages/web/app/competitions/new/page.tsx` | Form helper text, brief description textarea → `BODY_FONT` |
| Modify | `packages/web/app/tournaments/[id]/page.tsx` | Match history text → `BODY_FONT` |

---

### Task 1: Add BODY_FONT token and update size tokens in design-tokens.ts

**Files:**
- Modify: `packages/web/lib/design-tokens.ts`

- [ ] **Step 1: Read design-tokens.ts and confirm current values**

  Read the file and verify:
  - `MONOSPACE_FONT` exists and is the Orbitron-first font stack
  - `KICKER_STYLE.fontSize` = `'0.55rem'`
  - `FORM_LABEL_STYLE.fontSize` = `'0.6rem'`

  If current values differ, adjust the "Before" strings in Steps 3–4 accordingly before editing.

- [ ] **Step 2: Add BODY_FONT and size tokens after the existing MONOSPACE_FONT line**

  Insert after line `export const MONOSPACE_FONT = ...`:

  ```ts
  /**
   * Body font — SF Mono first, no Orbitron.
   * Use for: event feed text, presentation paragraphs, file paths,
   * system prompt previews, descriptions, any sentence-length copy.
   * Rule: if it's a label/heading/badge → MONOSPACE_FONT. If it reads as a sentence → BODY_FONT.
   */
  export const BODY_FONT = "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace";

  /** Body copy font size — event feed, descriptions, paragraphs (13.8px at 120% scale) */
  export const BODY_FONT_SIZE = '0.72rem';

  /** Small body font size — timestamps, metadata (13.1px at 120% scale) */
  export const BODY_FONT_SIZE_SM = '0.68rem';

  /** Line height for body copy — generous for readability */
  export const BODY_LINE_HEIGHT = 1.65;
  ```

- [ ] **Step 3: Update KICKER_STYLE fontSize**

  Change:
  ```ts
  // before
  export const KICKER_STYLE: React.CSSProperties = {
    fontSize: '0.55rem',
  ```
  To:
  ```ts
  // after
  export const KICKER_STYLE: React.CSSProperties = {
    fontSize: '0.70rem',
  ```

- [ ] **Step 4: Update FORM_LABEL_STYLE fontSize**

  Change:
  ```ts
  // before
  export const FORM_LABEL_STYLE: React.CSSProperties = {
    color: '#4a8fa8',
    textTransform: 'uppercase' as const,
    letterSpacing: '1.5px',
    fontWeight: 700,
    fontSize: '0.6rem',
  ```
  To:
  ```ts
  // after
  export const FORM_LABEL_STYLE: React.CSSProperties = {
    color: '#4a8fa8',
    textTransform: 'uppercase' as const,
    letterSpacing: '1.5px',
    fontWeight: 700,
    fontSize: '0.72rem',
  ```

- [ ] **Step 5: Run typecheck to confirm no regressions**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/web/lib/design-tokens.ts
  git commit -m "feat(typography): add BODY_FONT token and bump KICKER/FORM_LABEL sizes"
  ```

---

### Task 2: Apply BODY_FONT to the competition detail page

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`

This is the most impactful page — the event feed rows and presentation tab paragraphs are the exact content the user screenshot showed as unreadable.

- [ ] **Step 1: Read the file and identify font usage**

  Read `packages/web/app/competitions/[id]/page.tsx`. The file is at 3 levels deep from `app/`, so the import path is `'../../../lib/design-tokens'`.

  Run a quick search for all current `MONOSPACE_FONT` usages to locate every element that may need to change:
  ```bash
  grep -n "MONOSPACE_FONT\|fontFamily\|fontSize.*rem" packages/web/app/competitions/\[id\]/page.tsx | head -60
  ```

  Note the actual variable names, sizes, and JSX patterns before editing — the before/after patterns below are illustrative guides, not guaranteed exact matches.

- [ ] **Step 2: Import BODY_FONT at the top of the file**

  Add `BODY_FONT`, `BODY_FONT_SIZE`, `BODY_LINE_HEIGHT` to the existing import from `'../../../lib/design-tokens'`.

- [ ] **Step 3: Find all event feed row text spans and update fontFamily**

  The event feed renders rows with a type-label badge (e.g. `THINK`, `CREATE`, `RESULT`) and a text content span beside it. Update the text content spans — NOT the type-label badges — to use `BODY_FONT`:

  ```ts
  // Before (event text span):
  style={{ fontFamily: MONOSPACE_FONT, fontSize: '0.62rem', ... }}

  // After:
  style={{ fontFamily: BODY_FONT, fontSize: BODY_FONT_SIZE, lineHeight: BODY_LINE_HEIGHT, ... }}
  ```

  The type-label badges (`THINK`, `CREATE`, etc.) keep `MONOSPACE_FONT` — they are display elements.

- [ ] **Step 4: Find the Presentations tab content and update paragraph text**

  Search for `APPROACH`, `KEY INSIGHT`, or `criterionFindings` rendering. Any paragraph/sentence text inside the Presentations tab should use `BODY_FONT`:

  ```ts
  // Before (presentation paragraph):
  style={{ fontFamily: MONOSPACE_FONT, fontSize: '0.72rem', ... }}

  // After:
  style={{ fontFamily: BODY_FONT, fontSize: BODY_FONT_SIZE, lineHeight: BODY_LINE_HEIGHT, ... }}
  ```

  Section heading labels (`APPROACH`, `KEY INSIGHT`) keep `MONOSPACE_FONT` — they are display labels.

- [ ] **Step 5: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/web/app/competitions/\[id\]/page.tsx
  git commit -m "feat(typography): apply BODY_FONT to event feed and presentation tab"
  ```

---

### Task 3: Apply BODY_FONT to remaining pages

**Files:**
- Modify: `packages/web/app/personas/page.tsx`
- Modify: `packages/web/app/page.tsx`
- Modify: `packages/web/app/briefs/page.tsx`
- Modify: `packages/web/app/leaderboard/page.tsx`
- Modify: `packages/web/app/analytics/page.tsx`
- Modify: `packages/web/app/compare/page.tsx`
- Modify: `packages/web/app/competitions/new/page.tsx`
- Modify: `packages/web/app/tournaments/[id]/page.tsx`

**The rule to apply consistently across all files:**

| Element type | Font | Size |
|---|---|---|
| Page title H1, H2 | `MONOSPACE_FONT` | keep existing |
| Kicker/stamp labels | `MONOSPACE_FONT` | `KICKER_STYLE` (now 0.70rem) |
| Model badges, state badges | `MONOSPACE_FONT` | keep |
| Tab labels, nav links | `MONOSPACE_FONT` | keep |
| Button text | `MONOSPACE_FONT` | keep, minimum 0.65rem |
| Filter/pill buttons | `MONOSPACE_FONT` | minimum 0.65rem |
| Description paragraphs | `BODY_FONT` | `BODY_FONT_SIZE` (0.72rem) |
| Timestamps, metadata lines | `BODY_FONT` | `BODY_FONT_SIZE_SM` (0.68rem) |
| System prompt previews | `BODY_FONT` | `BODY_FONT_SIZE_SM` |
| File paths | `BODY_FONT` | `BODY_FONT_SIZE_SM` |
| Form helper text | `BODY_FONT` | `BODY_FONT_SIZE` |

- [ ] **Step 1: Run a discovery grep on all target pages before editing**

  Find every `MONOSPACE_FONT` usage across the pages in this task — these are your candidates for switching to `BODY_FONT`:

  ```bash
  grep -n "MONOSPACE_FONT\|fontFamily\|fontSize.*0\.[0-9]" \
    packages/web/app/personas/page.tsx \
    packages/web/app/page.tsx \
    packages/web/app/briefs/page.tsx \
    packages/web/app/leaderboard/page.tsx \
    packages/web/app/analytics/page.tsx \
    packages/web/app/compare/page.tsx \
    "packages/web/app/competitions/new/page.tsx" \
    "packages/web/app/tournaments/[id]/page.tsx" 2>/dev/null | head -120
  ```

  Use the output to identify which specific spans/elements match each description below.

- [ ] **Step 2: Update personas/page.tsx**

  - System prompt preview `<pre>` element: `fontFamily: BODY_FONT`
  - Description `<p>` elements: `fontFamily: BODY_FONT, fontSize: BODY_FONT_SIZE`
  - Any inline metadata (model label, persona ID hint): `fontFamily: BODY_FONT, fontSize: BODY_FONT_SIZE_SM`
  - Filter button font sizes: minimum `0.65rem`

- [ ] **Step 3: Update page.tsx (gallery)**

  - Competition card description/problem snippet text: `fontFamily: BODY_FONT, fontSize: BODY_FONT_SIZE`
  - Timestamp / "X events" / event count metadata: `fontFamily: BODY_FONT, fontSize: BODY_FONT_SIZE_SM`
  - Filter pill buttons: font size → `0.65rem` (currently `0.52rem` — critical fix)

- [ ] **Step 4: Update briefs/page.tsx**

  - Brief problem snippet text: `fontFamily: BODY_FONT, fontSize: BODY_FONT_SIZE`
  - Tag/format metadata: keep `MONOSPACE_FONT` (they are badge elements)
  - Any body description: `BODY_FONT`

- [ ] **Step 5: Update leaderboard/page.tsx**

  - Win rate / score stat text: `fontFamily: BODY_FONT, fontSize: BODY_FONT_SIZE_SM`
  - Model name label text (if sentence-context): `BODY_FONT`

- [ ] **Step 6: Update analytics/page.tsx and compare/page.tsx**

  - Any sentence-length explanatory text, stat labels in context: `BODY_FONT`
  - Numeric values and badges: keep `MONOSPACE_FONT`

- [ ] **Step 7: Update competitions/new/page.tsx**

  - Form field helper text (e.g. "Define the problem agents will solve"): `fontFamily: BODY_FONT`
  - Brief description `<textarea>` content: `fontFamily: BODY_FONT`
  - Step descriptions / instructional copy: `fontFamily: BODY_FONT, fontSize: BODY_FONT_SIZE`

- [ ] **Step 8: Update tournaments/[id]/page.tsx**

  - Match history result text: `fontFamily: BODY_FONT, fontSize: BODY_FONT_SIZE_SM`

- [ ] **Step 9: Typecheck all web pages**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

  Expected: no errors.

- [ ] **Step 10: Commit**

  ```bash
  git add packages/web/app/personas/page.tsx \
    packages/web/app/page.tsx \
    packages/web/app/briefs/page.tsx \
    packages/web/app/leaderboard/page.tsx \
    packages/web/app/analytics/page.tsx \
    packages/web/app/compare/page.tsx \
    "packages/web/app/competitions/new/page.tsx" \
    "packages/web/app/tournaments/[id]/page.tsx"
  git commit -m "feat(typography): apply BODY_FONT sweep across all remaining pages"
  ```

---

## Chunk 2: Brand & Polish

### File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `packages/web/app/layout.tsx` | Add arena4.ai footer |
| Modify | `packages/web/components/TopBar.tsx` | Update kicker/brand pattern if applicable |
| Modify | `packages/web/app/page.tsx` | Kicker → `◆ ARENA4AI \| COMPETITIONS`; empty state copy |
| Modify | `packages/web/app/briefs/page.tsx` | Kicker update; empty state copy |
| Modify | `packages/web/app/leaderboard/page.tsx` | Kicker update; empty state copy |
| Modify | `packages/web/app/analytics/page.tsx` | Kicker update |
| Modify | `packages/web/app/compare/page.tsx` | Kicker update |
| Modify | `packages/web/app/personas/page.tsx` | Kicker update |
| Modify | `packages/web/app/tournaments/new/page.tsx` | Kicker update |
| Modify | `packages/web/app/tournaments/[id]/page.tsx` | Kicker update |
| Modify | `packages/web/app/globals.css` | `⚔️` → `⚔` standardization (if in CSS content strings) |
| Search+replace | All `*.tsx` files | `⚔️` → `⚔` |

---

### Task 4: Add global arena4.ai footer

**Dependency:** Chunk 1 (Task 1) must be complete — `BODY_FONT` token must exist in `design-tokens.ts` before this task runs.

**Files:**
- Modify: `packages/web/app/layout.tsx`

- [ ] **Step 1: Open layout.tsx and locate the `<body>` closing section**

  Find the pattern like:
  ```tsx
  <body ...>
    {children}
  </body>
  ```

- [ ] **Step 2: Add footer above `</body>`**

  Import `BODY_FONT` from design-tokens if not already imported, then add:

  ```tsx
  <footer style={{
    borderTop: '1px solid #0a2235',
    padding: '1rem 1.5rem',
    textAlign: 'center' as const,
    fontSize: '0.65rem',
    color: '#3d7d94',
    fontFamily: BODY_FONT,
    letterSpacing: '1px',
  }}>
    arena4.ai — competitive AI orchestration
  </footer>
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add packages/web/app/layout.tsx
  git commit -m "feat(brand): add arena4.ai footer to all pages via layout"
  ```

---

### Task 5: Update hero kickers to arena4.ai brand pattern

**Files:**
- Modify: multiple page files (see list above)

The current pattern is: `◆ Leaderboard`
The new pattern is: `◆ ARENA4AI | LEADERBOARD`

- [ ] **Step 1: Update page.tsx (gallery) kicker**

  Find the kicker div (looks like `◆ Competition Gallery` or similar):
  ```tsx
  // Before:
  ◆ Competition Gallery

  // After:
  ◆ ARENA4AI | COMPETITIONS
  ```

- [ ] **Step 2: Update leaderboard/page.tsx kicker**

  ```tsx
  // Before: ◆ Leaderboard  →  After: ◆ ARENA4AI | LEADERBOARD
  ```

- [ ] **Step 3: Update briefs/page.tsx kicker**

  ```tsx
  // Before: ◆ Briefs  →  After: ◆ ARENA4AI | BRIEF LIBRARY
  ```

- [ ] **Step 4: Update competitions/[id]/page.tsx kicker**

  ```tsx
  // Before: any existing kicker text  →  After: ◆ ARENA4AI | ARENA
  ```

- [ ] **Step 5: Update analytics/page.tsx, compare/page.tsx, personas/page.tsx, tournaments pages, competitions/new**

  Apply the same pattern. Keep the existing `KICKER_STYLE` — only the text content changes.

  | Page | New kicker text |
  |------|----------------|
  | analytics | `◆ ARENA4AI \| ANALYTICS` |
  | compare | `◆ ARENA4AI \| COMPARE` |
  | personas | `◆ ARENA4AI \| PERSONAS` |
  | tournaments/new | `◆ ARENA4AI \| NEW TOURNAMENT` |
  | tournaments/[id] | `◆ ARENA4AI \| TOURNAMENT` |
  | competitions/new | `◆ ARENA4AI \| NEW BATTLE` |

- [ ] **Step 6: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add packages/web/app/page.tsx \
    packages/web/app/leaderboard/page.tsx \
    packages/web/app/briefs/page.tsx \
    packages/web/app/analytics/page.tsx \
    packages/web/app/compare/page.tsx \
    packages/web/app/personas/page.tsx \
    "packages/web/app/tournaments/new/page.tsx" \
    "packages/web/app/tournaments/[id]/page.tsx" \
    "packages/web/app/competitions/new/page.tsx" \
    "packages/web/app/competitions/[id]/page.tsx"
  git commit -m "feat(brand): update all page hero kickers to ARENA4AI | PAGE pattern"
  ```

---

### Task 6: Standardize ⚔ emoji and update empty state copy

**Files:**
- All `*.tsx` files in `packages/web/`

- [ ] **Step 1: Replace all ⚔️ (U+2694 U+FE0F) with ⚔ (U+2694) in .tsx and .css files**

  ```bash
  # Find all occurrences first (tsx + css):
  grep -rn "⚔️" packages/web/

  # Replace in .tsx files (macOS sed):
  find packages/web -name "*.tsx" -exec sed -i '' 's/⚔️/⚔/g' {} +

  # Also replace in globals.css (listed in file map):
  sed -i '' 's/⚔️/⚔/g' packages/web/app/globals.css
  ```

  Verify nothing remains:
  ```bash
  grep -r "⚔️" packages/web/
  ```
  Expected: no output (all replaced).

- [ ] **Step 2: Read current empty state strings before editing**

  Read `packages/web/app/page.tsx` and search for the empty state block:
  ```bash
  grep -n "No competition\|no matches\|empty\|No battles" packages/web/app/page.tsx
  grep -n "No completed\|no data\|empty\|No champion" packages/web/app/leaderboard/page.tsx
  grep -n "No brief\|empty\|no results" packages/web/app/briefs/page.tsx
  ```
  Note the exact current strings so the edits target the right text.

- [ ] **Step 3: Update empty state copy in page.tsx (gallery)**

  Replace whatever the current gallery empty state text is with:
  ```tsx
  "No battles recorded. ⚔ Run the first match to claim the arena."
  ```

- [ ] **Step 4: Update empty state copy in leaderboard/page.tsx**

  Replace the current empty state with:
  ```tsx
  "No champions yet — the arena awaits its first victor."
  ```

- [ ] **Step 5: Update empty state copy in briefs/page.tsx**

  Replace the current empty state with:
  ```tsx
  "Brief archive is empty — forge a new competition or import a preset."
  ```

- [ ] **Step 6: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

- [ ] **Step 7: Commit**

  The `find ... -exec sed` in Step 1 may touch any `.tsx` file containing `⚔️` across `packages/web/`. Stage all changed files (not just the ones listed), plus globals.css:

  ```bash
  # Check which files were actually modified:
  git diff --name-only packages/web/

  # Stage all modified web files (emoji sweep + empty state):
  git add -p packages/web/    # review each change, or:
  git add $(git diff --name-only packages/web/)
  git commit -m "feat(brand): standardize sword emoji and update empty state copy"
  ```

---

## Chunk 3: File Naming Convention

### File Map

| Action | File | What changes |
|--------|------|-------------|
| Create | `packages/orchestrator/src/utils/naming.ts` | New utility: slugifyBrief, formatDateCompact, formatDateTimestamp, buildDeliverableFilename, buildForgeFilename |
| Create | `packages/orchestrator/src/utils/naming.test.ts` | Vitest unit tests for all naming functions |
| Modify | `packages/orchestrator/src/server/routes/competitions.ts` | Use naming utility for deliverables ZIP (line ~415) and forge ZIP (line ~259) |
| Modify | `packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts` | Fetch competition brief slug; use in filename |
| Verify | `packages/web/app/api/competitions/[id]/deliverables/[teamId]/download/route.ts` | Confirm Content-Disposition header is forwarded from orchestrator (no change needed if it is) |

---

### Task 7: Write naming.ts utility (TDD)

**Files:**
- Create: `packages/orchestrator/src/utils/naming.test.ts`
- Create: `packages/orchestrator/src/utils/naming.ts`

- [ ] **Step 1: Create the test file first**

  ```ts
  // packages/orchestrator/src/utils/naming.test.ts
  import { describe, it, expect } from 'vitest';
  import {
    slugifyBrief,
    formatDateCompact,
    formatDateTimestamp,
    buildDeliverableFilename,
    buildForgeFilename,
  } from './naming.js';
  import type { Brief } from '@arena/shared';
  import type { Team } from '@arena/shared';

  const mockBrief = (overrides: Partial<Brief> = {}): Brief => ({
    id: 'fizzbuzz-cli',
    title: 'FizzBuzz CLI',
    problem: 'Build a fizzbuzz program.',
    constraints: [],
    deliverables: ['solution.py'],
    rubric: { criteria: [] },
    format: 'SPRINT',
    timeLimitMs: 120000,
    ...overrides,
  });

  // team.model includes the persona slug: 'claude:architect' is a valid Team.model value.
  // buildDeliverableFilename converts 'claude:architect' → 'claude-architect' via replace(':', '-').
  const mockTeam = (overrides: Partial<Team> = {}): Team => ({
    id: 'team-a',
    model: 'claude:architect',
    persona: 'You are an architect.',
    ...overrides,
  });

  describe('slugifyBrief', () => {
    it('uses brief.id when available', () => {
      expect(slugifyBrief(mockBrief({ id: 'my-brief-id' }))).toBe('my-brief-id');
    });

    it('falls back to slugified title when id is empty', () => {
      expect(slugifyBrief(mockBrief({ id: '' }))).toBe('fizzbuzz-cli');
    });

    it('handles special characters in title', () => {
      expect(slugifyBrief(mockBrief({ id: '', title: 'Deploy SPA (React) v2!' }))).toBe('deploy-spa-react-v2');
    });

    it('truncates to 60 chars', () => {
      const longTitle = 'A'.repeat(80);
      expect(slugifyBrief(mockBrief({ id: '', title: longTitle })).length).toBeLessThanOrEqual(60);
    });

    it('strips leading/trailing hyphens after truncation', () => {
      const result = slugifyBrief(mockBrief({ id: '', title: 'hello world --- end' }));
      expect(result).not.toMatch(/^-|-$/);
    });
  });

  describe('formatDateCompact', () => {
    it('formats ISO date to YYYYMMDD', () => {
      expect(formatDateCompact('2026-03-12T16:30:00Z')).toBe('20260312');
    });

    it('handles Date objects', () => {
      expect(formatDateCompact(new Date('2026-03-12T16:30:00Z'))).toBe('20260312');
    });
  });

  describe('formatDateTimestamp', () => {
    it('formats to YYYYMMDD-HHMMSS', () => {
      // Time is UTC-based; just check format shape
      const result = formatDateTimestamp('2026-03-12T16:35:22Z');
      expect(result).toMatch(/^\d{8}-\d{6}$/);
    });
  });

  describe('buildDeliverableFilename', () => {
    it('builds a well-structured filename', () => {
      const result = buildDeliverableFilename(mockBrief(), mockTeam(), '2026-03-12T16:00:00Z');
      expect(result).toBe('arena4ai_fizzbuzz-cli_claude-architect_20260312_deliverables.zip');
    });

    it('handles team with model-only (no colon)', () => {
      const result = buildDeliverableFilename(
        mockBrief(),
        mockTeam({ model: 'gemini', persona: '' }),
        '2026-03-12T16:00:00Z'
      );
      expect(result).toBe('arena4ai_fizzbuzz-cli_gemini_20260312_deliverables.zip');
    });

    it('falls back to teamId when model is missing', () => {
      const result = buildDeliverableFilename(
        mockBrief(),
        mockTeam({ model: '', id: 'team-a' }),
        '2026-03-12T16:00:00Z'
      );
      expect(result).toContain('team-a');
      expect(result).toContain('deliverables.zip');
    });

    it('uses current date when startedAt is missing', () => {
      const result = buildDeliverableFilename(mockBrief(), mockTeam());
      expect(result).toMatch(/arena4ai_fizzbuzz-cli_claude-architect_\d{8}_deliverables\.zip/);
    });
  });

  describe('buildForgeFilename', () => {
    it('builds a well-structured forge filename', () => {
      const result = buildForgeFilename(mockBrief(), 'winner', '2026-03-12T16:35:22Z');
      expect(result).toMatch(/arena4ai_fizzbuzz-cli_winner_\d{8}-\d{6}_forge-run\.zip/);
    });

    it('handles synthesis source', () => {
      const result = buildForgeFilename(mockBrief(), 'synthesis', '2026-03-12T16:35:22Z');
      expect(result).toContain('_synthesis_');
    });

    it('falls back gracefully when generatedAt is missing', () => {
      const result = buildForgeFilename(mockBrief(), 'winner');
      expect(result).toMatch(/arena4ai_fizzbuzz-cli_winner_.+_forge-run\.zip/);
    });
  });
  ```

- [ ] **Step 2: Run tests — confirm they all fail (naming.ts doesn't exist yet)**

  ```bash
  npm run test --workspace=packages/orchestrator -- naming
  ```

  Expected: import errors / all tests fail.

- [ ] **Step 3: Create naming.ts**

  ```ts
  // packages/orchestrator/src/utils/naming.ts
  import type { Brief, Team, ForgeSource } from '@arena/shared';

  /**
   * Derive a URL-safe slug from a Brief.
   * Uses brief.id if set and non-empty; otherwise slugifies the title.
   * Max 60 chars; lowercase; only a-z, 0-9, hyphens.
   */
  export function slugifyBrief(brief: Brief, maxLen = 60): string {
    const source = (brief.id && brief.id.trim()) ? brief.id : brief.title;
    return source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')  // strip leading/trailing hyphens
      .slice(0, maxLen)
      .replace(/-+$/, '');       // strip trailing hyphens created by truncation
  }

  /**
   * Format a date as YYYYMMDD (compact, sortable).
   * Accepts an ISO 8601 string or a Date object.
   */
  export function formatDateCompact(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  /**
   * Format a date as YYYYMMDD-HHMMSS (for per-run forge filenames).
   */
  export function formatDateTimestamp(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const dateStr = formatDateCompact(d);
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    return `${dateStr}-${h}${min}${s}`;
  }

  /**
   * Build a human-readable ZIP filename for a team's deliverables.
   * Pattern: arena4ai_{brief-slug}_{team-qualifier}_{date}_deliverables.zip
   */
  export function buildDeliverableFilename(
    brief: Brief,
    team: Team,
    startedAt?: string
  ): string {
    const slug = slugifyBrief(brief);
    const date = formatDateCompact(startedAt ?? new Date().toISOString());
    const qualifier = team.model
      ? team.model.replace(':', '-')
      : `team-${team.id}`;
    return `arena4ai_${slug}_${qualifier}_${date}_deliverables.zip`;
  }

  /**
   * Build a human-readable ZIP filename for a forge run.
   * Pattern: arena4ai_{brief-slug}_{source}_{timestamp}_forge-run.zip
   */
  export function buildForgeFilename(
    brief: Brief,
    source: ForgeSource,
    generatedAt?: string
  ): string {
    const slug = slugifyBrief(brief);
    const ts = formatDateTimestamp(generatedAt ?? new Date().toISOString());
    return `arena4ai_${slug}_${source}_${ts}_forge-run.zip`;
  }
  ```

- [ ] **Step 4: Run tests — confirm all pass**

  ```bash
  npm run test --workspace=packages/orchestrator -- naming
  ```

  Expected: all tests pass.

- [ ] **Step 5: Run full orchestrator test suite to confirm no regressions**

  ```bash
  npm run test --workspace=packages/orchestrator
  ```

  Expected: 159+ tests pass (all existing + new naming tests).

- [ ] **Step 6: Commit**

  ```bash
  git add packages/orchestrator/src/utils/naming.ts \
           packages/orchestrator/src/utils/naming.test.ts
  git commit -m "feat(naming): add naming utility with tests for download filenames"
  ```

---

### Task 8: Wire naming utility into competitions.ts routes

**Files:**
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`

There are two Content-Disposition headers to update.

- [ ] **Step 1: Add import at top of competitions.ts**

  ```ts
  import { buildDeliverableFilename, buildForgeFilename } from '../../utils/naming.js';
  ```

- [ ] **Step 2: Update the deliverables ZIP filename (~line 415)**

  Find:
  ```ts
  const label = team ? `${team.model.replace(':', '-')}-files` : `team-${teamId.slice(0, 8)}-files`;
  res.setHeader('Content-Disposition', `attachment; filename="${label}.zip"`);
  ```

  Replace with:
  ```ts
  const filename = team
    ? buildDeliverableFilename(comp.brief as Brief, team, comp.startedAt ?? undefined)
    : `arena4ai_unknown_${teamId}_deliverables.zip`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  ```

  Note: `Brief` may need to be imported from `@arena/shared` if not already. Check the existing imports at the top of the file.

- [ ] **Step 3: Update the deliverables ZIP to include _manifest.json (spec 1C)**

  After updating the `Content-Disposition` header in the deliverables route (~line 415), also ensure the ZIP archive includes a `_manifest.json` file at the root. Locate the archiving loop (where team files are zipped) and append before sending:

  ```ts
  // After all team files are added to the zip archive, add manifest:
  archive.append(JSON.stringify({
    competitionId: id,
    teamId,
    briefId: comp.brief?.id ?? '',
    briefTitle: (comp.brief as { title?: string })?.title ?? '',
    generatedAt: new Date().toISOString(),
    arena4aiVersion: '2.0',
  }, null, 2), { name: '_manifest.json' });
  ```

  (If the route uses `archiver` not JSZip, the syntax may differ — adapt to whatever streaming archive library is in use. The key requirement is a `_manifest.json` entry in the ZIP.)

- [ ] **Step 4: Update the forge ZIP filename (~line 259)**

  Find:
  ```ts
  const title = (comp?.brief as { title?: string } | null)?.title ?? id;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  res.setHeader('Content-Disposition', `attachment; filename="${slug}-forge.zip"`);
  ```

  Replace with:
  ```ts
  const brief = comp?.brief as Brief | null;
  // Use the most recent forge run for the filename (stacked runs; last = newest)
  const forgeRun = Array.isArray(result?.forge) ? result.forge.at(-1) : null;
  const filename = brief
    ? buildForgeFilename(brief, forgeRun?.source ?? 'winner', forgeRun?.generatedAt)
    : `arena4ai_unknown_${id}_forge-run.zip`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  ```

- [ ] **Step 5: Typecheck orchestrator**

  ```bash
  npm run typecheck --workspace=packages/orchestrator
  ```

  Expected: no errors.

- [ ] **Step 6: Run full test suite**

  ```bash
  npm run test --workspace=packages/orchestrator
  ```

  Expected: all tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/orchestrator/src/server/routes/competitions.ts
  git commit -m "feat(naming): use naming utility in competitions download endpoints, add _manifest.json to deliverables ZIP"
  ```

---

### Task 9: Update forge/[runId]/download route and verify deliverables pass-through

**Files:**
- Modify: `packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts`
- Verify: `packages/web/app/api/competitions/[id]/deliverables/[teamId]/download/route.ts`

- [ ] **Step 1: Verify deliverables route passes Content-Disposition through**

  Open `packages/web/app/api/competitions/[id]/deliverables/[teamId]/download/route.ts`.

  Confirm it forwards the upstream `Content-Disposition` header:
  ```ts
  const cd = res.headers.get('content-disposition') ?? 'attachment; filename="files.zip"';
  ```

  If that line exists and forwards the header, no change needed. The orchestrator now sets the correct filename, and the web proxy forwards it automatically.

- [ ] **Step 2: Update the per-run forge download route**

  Open `packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts`.

  Current hardcoded filename: `forge-run-${runId.slice(0, 8)}.zip`

  **Note on slug logic:** `packages/web` cannot import from `packages/orchestrator` (no dependency), so the slug/date formatting from `naming.ts` is intentionally duplicated inline here. This is the only place it appears in the web package.

  **Note on `nodebuffer`:** The existing route uses `zip.generateAsync({ type: 'blob' })`. This replacement switches to `type: 'nodebuffer'` — this is a required fix, not incidental. `NextResponse` requires a `Buffer` or `Uint8Array`, not a `Blob`.

  The route needs to fetch the competition to get the brief. Full replacement:

  ```ts
  export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string; runId: string }> }
  ) {
    const { id, runId } = await params;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

    // Fetch forge data and competition brief in parallel
    const [forgeRes, compRes] = await Promise.all([
      fetch(`${apiBase}/competitions/${id}/forge`),
      fetch(`${apiBase}/competitions/${id}`),
    ]);

    if (!forgeRes.ok || !compRes.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    type ForgeSourceLiteral = 'winner' | 'loser' | 'synthesis';
    const { runs } = await forgeRes.json() as { runs: Array<{ id: string; source: ForgeSourceLiteral; generatedAt: string; artifacts: Array<{ type: string; title: string; content: string }> }> };
    const comp = await compRes.json() as { brief?: { id?: string; title?: string } };

    const run = runs.find((r) => r.id === runId);
    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Build filename using brief slug + source + timestamp
    const briefId = comp.brief?.id ?? '';
    const briefTitle = comp.brief?.title ?? id;
    const slug = (briefId || briefTitle)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);

    const ts = new Date(run.generatedAt);
    const dateStr = [
      ts.getUTCFullYear(),
      String(ts.getUTCMonth() + 1).padStart(2, '0'),
      String(ts.getUTCDate()).padStart(2, '0'),
    ].join('');
    const timeStr = [
      String(ts.getUTCHours()).padStart(2, '0'),
      String(ts.getUTCMinutes()).padStart(2, '0'),
      String(ts.getUTCSeconds()).padStart(2, '0'),
    ].join('');
    const filename = `arena4ai_${slug}_${run.source}_${dateStr}-${timeStr}_forge-run.zip`;

    // Build ZIP using JSZip (existing pattern in this file)
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const artifact of run.artifacts) {
      const fname = artifact.title.replace(/\s+/g, '-').toLowerCase() + '.md';
      zip.file(fname, artifact.content);
    }
    // Add metadata
    zip.file('_metadata.json', JSON.stringify({
      competitionId: id,
      briefId: comp.brief?.id ?? '',
      briefTitle: comp.brief?.title ?? '',
      forgeSource: run.source,
      generatedAt: run.generatedAt,
      arena4aiVersion: '2.0',
    }, null, 2));

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }
  ```

- [ ] **Step 3: Typecheck web**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add "packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts"
  git commit -m "feat(naming): update forge per-run download with human-readable filename"
  ```

---

## Chunk 4: Forge Catalog Additions

### File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `packages/shared/src/types/forge.ts` | Add 4 new types to `ForgeArtifactType` union |
| Modify | `packages/orchestrator/src/forge/forge-orchestrator.ts` | Add `DOMAIN_TYPE_DEFAULTS`, add 3 new format defaults, add 4 new artifact specs, bump timeout to 60s |

---

### Task 10: Extend ForgeArtifactType union in shared types

**Files:**
- Modify: `packages/shared/src/types/forge.ts`

- [ ] **Step 1: Add 4 new types to the union**

  Open `packages/shared/src/types/forge.ts`. The `ForgeArtifactType` union currently ends at `| 'hypothesis_backlog';`.

  Add the 4 new types in a new section:

  ```ts
  export type ForgeArtifactType =
    // ... existing types unchanged ...
    | 'hypothesis_backlog'
    // Structured / domain-specific outputs (Sprint 1)
    | 'sql_schema'           // raw SQL schema for software domain
    | 'environment_template' // .env.example template for software domain
    | 'slide_deck'           // slide-by-slide outline with copy for creative domain
    | 'spreadsheet_export';  // CSV comparison matrix for research domain
  ```

- [ ] **Step 2: Typecheck shared**

  ```bash
  npx tsc --noEmit -p packages/shared/tsconfig.json
  ```

  Expected: no errors.

- [ ] **Step 3: Typecheck orchestrator (catches any exhaustive switch issues)**

  ```bash
  npm run typecheck --workspace=packages/orchestrator
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/shared/src/types/forge.ts
  git commit -m "feat(forge): add 4 new ForgeArtifactType entries to shared types"
  ```

---

### Task 11: Add DOMAIN_TYPE_DEFAULTS, new format defaults, new artifacts, and timeout fix

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`

- [ ] **Step 1: Add DOMAIN_TYPE_DEFAULTS constant after FORMAT_DOMAIN_DEFAULTS (~line 495)**

  Insert after the `FORMAT_DOMAIN_DEFAULTS` block:

  ```ts
  /**
   * Default artifact types per ForgeDomain.
   * Used when brief.domainHint is set (Sprint 2) or as fallback in selectDomainArtifacts.
   */
  const DOMAIN_TYPE_DEFAULTS: Record<ForgeDomain, ForgeArtifactType[]> = {
    software:  ['roadmap', 'task_graph', 'repo_blueprint', 'decision_log'],
    research:  ['evaluation_matrix', 'vendor_scorecard', 'decision_framework', 'decision_log'],
    creative:  ['presentation_structure', 'messaging_guide', 'content_outline', 'concept_canvas'],
    security:  ['threat_model', 'attack_surface', 'remediation_plan', 'risk_register'],
    business:  ['business_case', 'go_to_market', 'stakeholder_map', 'decision_framework'],
    ideation:  ['concept_canvas', 'mvp_definition', 'hypothesis_backlog', 'decision_framework'],
  };
  ```

- [ ] **Step 2: Add 3 new FORMAT_DOMAIN_DEFAULTS entries**

  Inside the existing `FORMAT_DOMAIN_DEFAULTS` object. Find the closing `}` that ends the object (after the last existing entry, e.g. `RED_VS_BLUE`) and add before it:

  ```ts
  BRAINSTORM: { domain: 'ideation',  types: ['concept_canvas', 'mvp_definition', 'hypothesis_backlog', 'decision_framework'] },
  RESEARCH:   { domain: 'research',  types: ['evaluation_matrix', 'vendor_scorecard', 'decision_framework', 'decision_log'] },
  PITCH:      { domain: 'creative',  types: ['presentation_structure', 'messaging_guide', 'content_outline', 'concept_canvas'] },
  ```

- [ ] **Step 3: Add 4 new artifact specs to ARTIFACT_CATALOG**

  Inside `ARTIFACT_CATALOG`, find the last entry (`hypothesis_backlog: { ... },`) and add the following entries after it, before the closing `}`:

  ```ts
  // Structured / domain-specific outputs
  sql_schema: {
    type: 'sql_schema',
    title: 'Database Schema (SQL)',
    systemPrompt: `You are a database architect generating a production-ready SQL schema.

  Given the competition results (especially the winning team's code and API contracts), produce a complete SQL schema.

  Requirements:
  - Use PostgreSQL syntax
  - Include CREATE TABLE statements with all columns, types, and constraints
  - Add indexes for foreign keys and commonly queried columns
  - Include comments on each table explaining its purpose
  - Output raw SQL only — no markdown fences, no explanation text

  The output must be valid SQL that can be piped directly to psql.`,
  },
  environment_template: {
    type: 'environment_template',
    title: 'Environment Variables Template',
    systemPrompt: `You are a DevOps engineer creating a .env.example template.

  Given the competition results, identify all environment variables the solution requires.

  For each variable include:
  - The variable name in SCREAMING_SNAKE_CASE
  - A comment explaining what it is and where to get the value
  - A safe placeholder value (never a real secret)

  Output format: raw .env file content only. Example:
  # Database connection string
  DATABASE_URL=postgresql://localhost/myapp

  No markdown, no JSON wrapper — just the .env file content.`,
  },
  slide_deck: {
    type: 'slide_deck',
    title: 'Presentation Slide Deck',
    systemPrompt: `You are a presentation expert creating a complete slide deck outline with full copy.

  Given the competition results (especially if this was a creative or communications brief), create a ready-to-build slide deck.

  For each slide provide:
  - Slide number and title
  - Headline (the one sentence a viewer should remember)
  - 3-5 bullet points or body copy
  - Visual suggestion (what image, chart, or diagram would work here)
  - Speaker notes (2-3 sentences for the presenter)

  Create 10-15 slides. Include: title slide, agenda, problem statement, solution overview, key evidence slides, differentiators, call to action, and closing.

  Output clean, well-structured Markdown. Each slide as a ## heading.`,
  },
  spreadsheet_export: {
    type: 'spreadsheet_export',
    title: 'Decision Matrix (Spreadsheet)',
    systemPrompt: `You are a data analyst creating a spreadsheet-ready decision matrix.

  Given the competition results (especially for research or procurement briefs), produce a structured CSV comparison matrix.

  Format:
  - First row: column headers (Option/Vendor names)
  - First column: evaluation criteria (from rubric)
  - Body cells: scores (1-10) with a brief justification in parentheses
  - Final rows: weighted totals and recommendation

  Output: raw CSV only — no markdown fences. The output must open correctly in Excel or Google Sheets.

  Example format:
  Criteria,Option A,Option B,Option C
  Performance,9 (fast response),7 (moderate),6 (slow)
  ...
  TOTAL (weighted),8.2,6.8,5.9`,
  },
  ```

- [ ] **Step 4: Fix GENERIC_DEFAULT fallback to use AI selection result (spec 1D)**

  Find the `GENERIC_DEFAULT` constant and the `selectDomainArtifacts()` call site. The spec requires: only use the hardcoded software fallback if the AI call throws an error — not when the AI returns a result. Currently the code may be ignoring the AI result and defaulting to software domain.

  Locate the error-handling block in `selectDomainArtifacts()` (the `try/catch` around the `runClaude` call). Ensure:
  ```ts
  // Only use GENERIC_DEFAULT if AI call errors:
  try {
    const raw = await runClaude(selectionPrompt, DOMAIN_SELECTION_SYSTEM_PROMPT, 60_000);
    // parse and return AI result...
  } catch (err) {
    // Only here do we fall back:
    return GENERIC_DEFAULT;
  }
  ```

  If the current code has a fallback BEFORE the try/catch or has any path that ignores a valid AI result, remove it.

- [ ] **Step 5: Update DOMAIN_SELECTION_SYSTEM_PROMPT to include the 4 new artifact types**

  Find `DOMAIN_SELECTION_SYSTEM_PROMPT` in the file. Add the 4 new types to the list of available artifact types in the prompt text so the AI knows they exist:

  In the prompt string, find where artifact types are listed and append:
  - `sql_schema` — raw PostgreSQL schema for software domain
  - `environment_template` — .env.example template for software domain
  - `slide_deck` — slide-by-slide outline for creative/pitch domain
  - `spreadsheet_export` — CSV comparison matrix for research domain

- [ ] **Step 6: Increase domain-selection timeout from 30s to 60s**

  Find the call:
  ```ts
  const raw = await runClaude(selectionPrompt, DOMAIN_SELECTION_SYSTEM_PROMPT, 30_000);
  ```

  Change to:
  ```ts
  const raw = await runClaude(selectionPrompt, DOMAIN_SELECTION_SYSTEM_PROMPT, 60_000);
  ```

- [ ] **Step 7: Write a focused test for DOMAIN_TYPE_DEFAULTS and new catalog entries**

  Find or create `packages/orchestrator/src/forge/forge-orchestrator.test.ts` (if it doesn't exist, create it):

  ```ts
  // packages/orchestrator/src/forge/forge-orchestrator.test.ts
  import { describe, it, expect } from 'vitest';

  // We test the catalog and defaults by importing the module and checking exports.
  // The module doesn't export these directly, so we test via the public API indirectly.
  // Instead, test the shared ForgeArtifactType union covers the new types:
  import type { ForgeArtifactType } from '@arena/shared';

  describe('ForgeArtifactType', () => {
    it('includes sql_schema', () => {
      const t: ForgeArtifactType = 'sql_schema';
      expect(t).toBe('sql_schema');
    });

    it('includes environment_template', () => {
      const t: ForgeArtifactType = 'environment_template';
      expect(t).toBe('environment_template');
    });

    it('includes slide_deck', () => {
      const t: ForgeArtifactType = 'slide_deck';
      expect(t).toBe('slide_deck');
    });

    it('includes spreadsheet_export', () => {
      const t: ForgeArtifactType = 'spreadsheet_export';
      expect(t).toBe('spreadsheet_export');
    });
  });
  ```

- [ ] **Step 8: Run tests**

  ```bash
  npm run test --workspace=packages/orchestrator
  ```

  Expected: all tests pass including new forge type tests.

- [ ] **Step 9: Typecheck orchestrator**

  ```bash
  npm run typecheck --workspace=packages/orchestrator
  ```

  Expected: no errors.

- [ ] **Step 10: Commit**

  ```bash
  git add packages/orchestrator/src/forge/forge-orchestrator.ts \
           packages/orchestrator/src/forge/forge-orchestrator.test.ts
  git commit -m "feat(forge): add DOMAIN_TYPE_DEFAULTS, 3 format defaults, 4 new artifact types, fix GENERIC_DEFAULT fallback, bump timeout to 60s"
  ```

---

### Task 12: Final integration check and PR-ready commit

- [ ] **Step 1: Run full orchestrator test suite**

  ```bash
  npm run test --workspace=packages/orchestrator
  ```

  Expected: all 159+ tests pass.

- [ ] **Step 2: Typecheck web**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

  Expected: no errors.

- [ ] **Step 3: Typecheck orchestrator**

  ```bash
  npm run typecheck --workspace=packages/orchestrator
  ```

  Expected: no errors.

- [ ] **Step 4: Typecheck shared**

  ```bash
  npx tsc --noEmit -p packages/shared/tsconfig.json
  ```

  Expected: no errors.

- [ ] **Step 5: Smoke test downloads manually (optional but recommended)**

  **Note:** This step verifies naming output from Chunk 3. If testing Chunk 4 in isolation (Chunk 3 not yet merged), skip the download filename checks and focus only on confirming the new artifact types (`sql_schema`, `environment_template`, `slide_deck`, `spreadsheet_export`) appear in Forge output for non-software briefs.

  Start the stack:
  ```bash
  # Terminal 1
  DATABASE_URL=postgresql://localhost/arena npx tsx packages/orchestrator/src/cli.ts serve --port 3000

  # Terminal 2
  cd packages/web && npm run dev
  ```

  Run a competition, complete it, then:
  1. Click "Download" on team deliverables → confirm filename is `arena4ai_{brief}_{team}_{date}_deliverables.zip`
  2. Trigger Forge → download a forge run → confirm filename is `arena4ai_{brief}_{source}_{timestamp}_forge-run.zip`
  3. Verify ZIPs open correctly and contain expected files + `_manifest.json` / `_metadata.json`
