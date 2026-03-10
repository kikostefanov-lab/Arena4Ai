# Polish Sprint Design

**Date:** 2026-03-10
**Status:** Approved

---

## Scope

Five improvements identified from a gap analysis against the original phase docs:

1. Workdir cleanup on terminal state
2. Shared `EventRow` component + click-to-expand (Option B — panel below row)
3. Per-artifact forge progress (Option A — checklist rows, real backend progress)
4. Forge zip download + "Forged by" badge
5. Replay keyboard shortcuts

---

## 1. Workdir Cleanup

**Files:** `packages/orchestrator/src/adapters/base-adapter.ts`

Each competition run with `--skip-sandbox` creates a temp workdir that is never deleted. Fix: `BaseAdapter.cleanupWorkdir()` (currently a no-op stub) calls `fs.rm(this.workdir, { recursive: true, force: true })`. The `competition-runner.ts` calls `cleanupWorkdir()` on both adapters when the competition reaches any terminal state (`COMPLETE`, `FORGE_COMPLETE`, `FAILED`, `CANCELLED`).

---

## 2. Shared EventRow Component + Click-to-Expand

**New file:** `packages/web/lib/EventRow.tsx`

Extract shared event rendering logic from the two drifted copies in `competitions/[id]/page.tsx` and `competitions/[id]/replay/page.tsx`:

- `classifyEvent(type, payload)` → `{ icon, label, color, expandable }`
- `EventRow` component — renders the row; accepts `expanded: boolean` and `onToggle: () => void`
- Only `REASONING` events are expandable (TOOL_CALL/FILE_CREATE are typically short)

**Expand behavior (Option B — panel below row):**
- Clicking a REASONING row renders a bordered panel directly below it with the full text
- The clicked row gains a left amber border highlight (`border-left: 2px solid #eab308`)
- Parent tracks `expandedEventId: string | null` — clicking a new row auto-collapses the previous one
- A "▲ collapse" affordance inside the panel closes it

**Both pages updated** to import from `lib/EventRow.tsx` and remove their local copies.

---

## 3. Per-Artifact Forge Progress

**Backend — new in-memory progress map:**

`forge-orchestrator.ts` exposes a `ForgeProgress` map keyed by `competitionId`:

```typescript
type ArtifactStatus = 'queued' | 'generating' | 'done' | 'error';
interface ForgeProgress {
  artifacts: Record<ForgeArtifactType, ArtifactStatus>;
  startedAt: string;
}
```

Each of the 6 parallel `runClaude()` calls updates the map: `queued → generating` before the call, `done` or `error` after. The map is cleaned up 5 minutes after forge completes.

**New endpoint:** `GET /competitions/:id/forge/progress` — returns the `ForgeProgress` object (or 404 if not forging).

**Frontend — checklist rows (Option A):**

While `forging === true`, the Forge tab shows 6 checklist rows:

```
⟳ Roadmap          generating…
⟳ Task Graph       generating…
✓ Repo Blueprint   done
○ API Contracts    queued
○ Risk Register    queued
○ Decision Log     queued
```

The existing 3s forge poll is extended: each tick hits `GET /forge/progress` (during forging) or `GET /forge` (for completion detection). When all 6 show `done`, the poll hits `GET /forge` to fetch the full results.

---

## 4. Forge Zip Download + "Forged by" Badge

**Server endpoint:** `GET /competitions/:id/forge/download`

Streams a zip archive of all 6 artifacts as `.md` files. Uses Node's `archiver` package (or hand-rolled zip with `fflate` — TBD by implementer, prefer whichever is already in the dep tree; add `archiver` if neither exists).

**Frontend:**
- "Download All" button in the Forge tab header triggers `GET /forge/download` via `window.location` or a hidden `<a>` element
- Small pill badge below the artifact sub-tabs: `⚒ Forged by claude-cli` — uses `result.forge.forgeModel`

---

## 5. Replay Keyboard Shortcuts

**File:** `packages/web/app/competitions/[id]/replay/page.tsx`

`useEffect` adds a `keydown` listener on mount, removes on unmount:

| Key | Action |
|-----|--------|
| `Space` | Toggle play/pause |
| `←` | Step back one event |
| `→` | Step forward one event |
| `0` / `Home` | Jump to start |
| `End` | Jump to end |

The listener is guarded so it doesn't fire when focus is on an input/textarea.

---

## Implementation Order

1. Workdir cleanup (isolated, no deps)
2. Shared EventRow extraction (touches 2 files, sets up clean foundation)
3. Replay keyboard shortcuts (isolated)
4. Per-artifact forge progress (backend then frontend)
5. Forge zip download + badge (backend then frontend)

---

## Files Changed

| File | Change |
|------|--------|
| `packages/orchestrator/src/adapters/base-adapter.ts` | Implement `cleanupWorkdir()` |
| `packages/orchestrator/src/engine/competition-runner.ts` | Call `cleanupWorkdir()` on terminal state |
| `packages/web/lib/EventRow.tsx` | New shared component |
| `packages/web/app/competitions/[id]/page.tsx` | Use shared EventRow, expandedEventId state |
| `packages/web/app/competitions/[id]/replay/page.tsx` | Use shared EventRow, keyboard shortcuts |
| `packages/orchestrator/src/forge/forge-orchestrator.ts` | ForgeProgress map, expose getter |
| `packages/orchestrator/src/server/routes/competitions.ts` | Add `/forge/progress` and `/forge/download` endpoints |
| `packages/web/app/competitions/[id]/page.tsx` | Checklist progress UI, zip download button, badge |
