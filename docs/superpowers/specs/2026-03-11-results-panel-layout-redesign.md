# Results Panel Layout Redesign

**Date:** 2026-03-11
**Status:** Approved
**Scope:** `packages/web/app/competitions/[id]/page.tsx` — ScoreDrawer component and all five tab layouts

---

## Problem

All five tabs in the results panel use narrow `maxWidth` constraints (700–760px) centered in the viewport, stacking content vertically. This forces excessive scrolling on content-rich competitions and wastes the full horizontal width, especially in maximized mode.

Root causes:
- `maxWidth: '700px', margin: '0 auto'` on Scores, Files, Presentations, Synthesis tabs
- Per-team content is stacked vertically rather than arranged in parallel columns
- Commentary/detail text is always fully expanded rather than on-demand

---

## Design

### Shared principle: full-width, parallel where teams are compared, detail on demand

Remove all `maxWidth` caps from tab content areas. Each tab uses the full panel width.

---

### Tab 1 — Scores

**Layout:** Criteria as rows, teams as columns (table). Click a row to expand commentary for all teams side-by-side beneath it.

- Table columns: Criterion | Weight | Team A | Team B | Team C | Winner
- Each score cell: mini progress bar + percentage
- Winner cell: colored chip (team color)
- Clicking a row toggles an inline `<tr>` detail row beneath it containing three commentary columns (one per team), color-coded by team
- Only one row expanded at a time
- Total score row pinned at bottom
- Commentary is hidden by default — zero vertical bloat until needed

**State:** `selectedCriterion: string | null` — tracks which row is expanded

---

### Tab 2 — Presentations

**Layout:** N equal-width columns (one per team), side-by-side. Each column is independently scrollable.

- Sticky column header: team name + model badge + Download MD button
- Always-visible sections per column: Approach (2–3 lines), Key Insight (callout box)
- Criterion findings: compact rows showing criterion tag + toggle arrow; click to expand finding, strength (+), gap (−) inline
- Multiple findings can be expanded simultaneously within a column

**State:** `expandedFindings: Set<string>` — `${teamId}:${criterionId}` keys

---

### Tab 3 — Files

**Layout:** N equal-width columns (one per team) for the file list, plus a resizable preview panel below separated by a drag handle.

- Column header: team name + file count + ZIP download button
- File rows: icon + filename + size; click to select
- Selected file is highlighted with team color left-border
- **Preview panel:** sits below the columns, separated by a drag handle (same mechanic as the score drawer resize handle)
  - Min height: 52px (shows filename strip only)
  - Default height: 180px
  - Max height: 420px
  - Panel header: filename, team badge (team color), file size, Download button, Full Screen button
  - Panel body: scrollable, syntax-tinted markdown rendering (existing `renderMarkdown` function)
  - Full Screen button opens the existing file modal

**State:**
- `selectedFile: { teamId, path } | null`
- `filePreviewHeight: number` (default 180, same drag mechanic as `scoreDrawerHeight`)

---

### Tab 4 — Synthesis

**Layout:** 2-column split. Left: criterion verdicts table (same V1 table pattern as Scores). Right: full synthesis document, always visible and scrollable.

- Left column (≈40% width):
  - Criterion verdicts table: Criterion | Winner | Weight
  - Click row to expand rationale + alternative text beneath it (same inline expand pattern)
  - Synthesis thesis shown above the table as a callout
- Right column (≈60% width):
  - Label: "FULL HYBRID SOLUTION"
  - Full synthesis markdown rendered and scrollable
  - Copy button in header
  - Existing expand/collapse toggle for the full-solution section preserved

**State:** `selectedSynthesisCriterion: string | null`

---

### Tab 5 — Forge

**Layout:** 2-column split. Left: run navigator sidebar. Right: artifact grid.

- Left sidebar (fixed ~200px):
  - Lists all forge runs (newest first) — run number, source label, model, timestamp
  - Active run highlighted
  - Source picker buttons at bottom (Winner / Loser / Synthesis) for new run trigger
- Right: artifact grid (3 columns of artifact cards)
  - Each card: emoji icon + artifact type name + content preview (first 3 lines, truncated)
  - Click card to open existing full-content modal

**State:** `activeForgeRun: string | null` (run ID) — defaults to newest run

---

## Files Modified

| File | Change |
|------|--------|
| `packages/web/app/competitions/[id]/page.tsx` | All five tab layouts inside `ScoreDrawer`; new state variables; file preview drag handle |

No new files required. All changes are within the existing `ScoreDrawer` function component and its tab rendering blocks.

---

## Implementation Notes

- Reuse the existing `scoreDrawerHeight` drag mechanic for `filePreviewHeight` — same `useRef`/`useEffect` pattern
- Reuse existing `renderMarkdown` for the file preview panel body
- The existing file modal (full-screen) is preserved — the Files tab preview panel "⤢ Full screen" button calls `setFileModalContent`
- All existing data flows unchanged — no API changes, no new props to `ScoreDrawer` beyond `filePreviewHeight` state being internal
- `selectedCriterion` and `selectedSynthesisCriterion` are local state within `ScoreDrawer`
- Remove `maxWidth` and `margin: '0 auto'` wrappers from all five tab content areas
- The `⤢`/`⤡` maximize button added in the previous session works better with these layouts — full width now means something

---

## Non-Goals

- No changes to the lane panels above the drawer
- No changes to scoring logic, data fetching, or API
- No changes to the modal components (file modal, presentation modal)
- No responsive/mobile layout changes in this pass
