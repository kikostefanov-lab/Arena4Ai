# Post-Judging Redesign — Design Spec
**Date:** 2026-03-10
**Status:** Approved

---

## Overview

Four improvements to the post-judging experience in Arena4Ai, plus a global readability upgrade. The core philosophy shift: post-judging actions are **independent and additive** — users decide what they want, nothing is forced.

---

## 1. Presentations Tab — Download + Modal

### What changes
Each team's presentation card gets two new actions:
- **↓ Download** — saves the full presentation as a markdown file (`presentation-{model}-{persona}.md`) using a client-side Blob download (no new API endpoint needed; data is already in the page)
- **⤢ Expand** — opens a modal showing the complete TeamPresentation: approach, all criterion findings (label, finding, strength, gap), key insight, deliverable summary

### Modal design
- Overlay with `#000408` backdrop at 85% opacity
- Card: `#050f1e`, `border: 1px solid #0a2235`, `border-radius: 10px`, `max-height: 80vh`, scrollable body
- Header: model badge + persona, download button, close (✕)
- Body: sections with dim uppercase labels, cyan-tinted text

### Data
No API changes — `TeamPresentation[]` is already fetched as part of `result.presentations`.

---

## 2. Files Tab — Inline Preview + ZIP Download

### What changes

**Per-file inline preview:**
- Each file row is clickable; click toggles an inline expanded panel below the row
- Panel: scrollable (`max-height: 240px`, `overflow-y: auto`), monospace, syntax-tinted with basic keyword coloring
- Shows first ~50 lines; "Open full file" link at bottom opens a full-file modal
- Full-file modal: complete content, copy-to-clipboard button, same modal style as presentations

**Per-team ZIP download:**
- New button per team column header: `📦 ZIP`
- New API endpoint: `GET /competitions/:id/deliverables/:teamId/download`
- Streams a ZIP of all files for that team (using `archiver` or `jszip` server-side)
- Filename: `{model}-{persona}-files.zip`

### API change
```
GET /competitions/:id/deliverables/:teamId/download
→ Content-Type: application/zip
→ Content-Disposition: attachment; filename="claude-architect-files.zip"
```

---

## 3. Synthesis Tab — Manual Trigger (Not Automatic)

### State machine change
**Before:** `SCORED → SYNTHESIZING → COMPLETE` (automatic)
**After:** `SCORED → COMPLETE` (synthesis removed from auto-flow)

The `skipSynthesis` option is removed — synthesis is always manual now.

### New endpoint
```
POST /competitions/:id/synthesis
→ 202 Accepted (runs async, same pattern as forge)
→ Requires COMPLETE state
→ Updates result.synthesis when done; emits SYNTHESIS_COMPLETE event
```

### UI — idle state
When `result.synthesis === null`, the Synthesis tab shows:
```
🔮  (large emoji)
Synthesize a Hybrid Solution
[description of what synthesis does]
[🔮 Run Synthesis]  ← primary button
Not interested — skip this step  ← small muted link (just dismisses the prompt visually)
```

### UI — result state
Existing synthesis rendering unchanged — shows `overallRationale`, per-criterion breakdown, full markdown synthesis.

Can be re-run (replaces previous synthesis result; no stacking needed for synthesis).

---

## 4. Forge Tab — Source Picker + Stacked Runs

### Source picker
Before forging, user selects source:
- **🏆 Winner** — uses winner's deliverables + presentation as context
- **📋 Loser** — uses loser's deliverables + presentation as context
- **🔮 Synthesis** — uses synthesis result as context (disabled/dimmed if synthesis not yet run)

### Stacked runs
Each forge run is **appended**, not replaced. The tab shows:
1. **Source picker + "⚒ Forge This" button** always visible at top
2. **Previous runs list** below, newest first, each showing:
   - Source badge (🏆 Winner / 📋 Loser / 🔮 Synthesis) + run number
   - Artifact chips (universal vs domain)
   - Timestamp
   - `↓ ZIP` and `View` buttons

### API change
`POST /competitions/:id/forge` — add `source` body param:
```json
{ "source": "winner" | "loser" | "synthesis" }
```

`GET /competitions/:id/forge` — returns `ForgeRun[]` instead of `ForgeOutput | null`

### DB schema change
`results.forge` column changes from `ForgeOutput | null` to `ForgeRun[] | null`

New `ForgeRun` shape:
```ts
interface ForgeRun {
  id: string;                          // uuid, generated at run time
  source: 'winner' | 'loser' | 'synthesis';
  sourceTeamId?: string;               // set when source is 'winner' or 'loser'
  artifacts: ForgeArtifact[];
  forgeModel: string;
  generatedAt: string;
  domain?: ForgeDomain;
}
```

**Migration:** existing single `ForgeOutput` records wrapped into a 1-element array on read (backward-compat adapter in the repository layer).

---

## 5. Global Readability Upgrade

### Font size — +20%
Add to `packages/web/app/globals.css`:
```css
html {
  font-size: 120%;
}
```
All `rem`-based sizes scale automatically. No component changes needed.

### Text colors — +35% brightness (Option C)
Update `packages/web/lib/design-tokens.ts`:

| Token | Old | New |
|-------|-----|-----|
| `TEXT_PRIMARY` | `#c8eef8` | `#e4f8ff` |
| `TEXT_MUTED` | `#4a8fa8` | `#7cc6db` |
| `TEXT_DIM` | `#1e4a5a` | `#3d7d94` |

Also update hardcoded instances of these colors throughout page files (same sweep pattern as the TRON rebrand).

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `packages/web/lib/design-tokens.ts` | Update TEXT_PRIMARY/MUTED/DIM |
| `packages/web/app/globals.css` | Add `html { font-size: 120% }` |
| `packages/web/lib/EventRow.tsx` | Update hardcoded muted colors |
| `packages/web/app/competitions/[id]/page.tsx` | Presentations modal + download; Files inline preview + ZIP buttons; Synthesis idle state + trigger; Forge source picker + stacked runs UI |
| `packages/shared/src/types/forge.ts` | Add `ForgeRun` type, update `ForgeOutput` |
| `packages/orchestrator/src/engine/competition-runner.ts` | Remove auto-synthesis from run loop |
| `packages/orchestrator/src/routes/competitions.ts` | Add `POST /synthesis` route; update `POST /forge` to accept source; update `GET /forge` to return array; add `GET /deliverables/:teamId/download` |
| `packages/orchestrator/src/forge/forge-orchestrator.ts` | Accept source + context selection |
| `packages/orchestrator/src/db/repository.ts` | `saveForgeRun(append)`, `getForgeRuns`, backward-compat migration adapter for existing single-object forge records |
| `packages/orchestrator/src/synthesis/` | Extract synthesis into on-demand service callable from route |

---

## Out of Scope

- Synthesis does not offer winner-only / loser-only modes (just "run AI synthesis" or skip)
- No per-artifact forge regeneration (re-run replaces the whole set for that run)
- No comparison view between forge runs (view one at a time)
