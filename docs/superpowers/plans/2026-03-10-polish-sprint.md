# Polish Sprint Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a shared EventRow component with Option-B expand, add replay keyboard shortcuts, add real per-artifact forge progress, and add a forge zip download + "Forged by" badge.

**Architecture:** Four independent tasks — each is self-contained and can be committed on its own. Task 1 (EventRow) is a prerequisite for nothing else; all tasks can proceed independently after it.

**Tech Stack:** TypeScript, React 18, Next.js 14 App Router, Express, Vitest (orchestrator tests), `archiver` npm package (Task 4 only).

> **Note:** Workdir cleanup is already implemented — `BaseAdapter.cleanupWorkdir()` exists at `packages/orchestrator/src/adapters/base-adapter.ts:164` and is called in `competition-runner.ts:402` in the `finally` block. No work needed there.

---

## Chunk 1: Shared EventRow + Replay Keyboard Shortcuts

### Task 1: Shared EventRow component

**Context:**
- `page.tsx` has `EventRow` at line 470 with per-row `useState(false)` expand (inline text toggle — NOT Option B yet)
- `replay/page.tsx` has `EventRow` at line 333 with NO expand at all
- Both have `classifyEvent`, `getToolIcon`, `toolCommentary` defined locally — they have drifted
- Both import `hexToRgb` from `../../../../lib/design-tokens`
- Goal: unified shared component with Option B expand (panel below row, left amber border), controlled from parent

**Files:**
- Create: `packages/web/lib/EventRow.tsx`
- Modify: `packages/web/app/competitions/[id]/page.tsx`
- Modify: `packages/web/app/competitions/[id]/replay/page.tsx`

---

- [ ] **Step 1.1: Create `packages/web/lib/EventRow.tsx`**

> **Note on types:** `page.tsx` uses `ArenaEvent.eventId` and `replay/page.tsx` uses `ArenaEvent.id` — these are local interface differences. `EventRow` only uses `type`, `payload`, and `timestamp`, so it defines its own minimal `EventRowEvent` interface that both local shapes satisfy. The parent component passes its own `key`.
>
> **Note on classifyEvent:** Use the richer implementation from the codebase (handles `p.raw.type` for Claude stream-json format). The simplified version in the original draft would be a regression for replay.

Create this file with the unified component and all helper functions:

```typescript
'use client';
import { hexToRgb } from './design-tokens';

// ─── Types ───────────────────────────────────────────────────────────────────

// Minimal event shape — works with both page.tsx (eventId) and replay/page.tsx (id) local types.
// Only the fields EventRow actually uses.
export interface EventRowEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface EventInfo {
  label: string;
  icon: string;
  color: string;
  bg: string;
  text: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getToolIcon(toolName: string): string {
  const n = toolName.toLowerCase();
  if (/bash|shell|run|exec|command/.test(n)) return '⚡';
  if (/write|create|save/.test(n)) return '✍️';
  if (/read|cat|view|open/.test(n)) return '👁️';
  if (/search|grep|find|glob/.test(n)) return '🔍';
  if (/python|py|node|js/.test(n)) return '🐍';
  if (/edit|replace|patch|str/.test(n)) return '✏️';
  if (/web|http|fetch|curl|url/.test(n)) return '🌐';
  if (/list|ls|dir/.test(n)) return '📂';
  if (/git/.test(n)) return '🔀';
  return '🔧';
}

export function toolCommentary(toolName: string, valStr: string): string {
  const n = toolName.toLowerCase();
  if (/bash|shell|run|exec/.test(n)) return `$ ${valStr}`;
  if (/write|create/.test(n)) return `Writing to ${valStr}`;
  if (/read|cat|view/.test(n)) return `Reading ${valStr}`;
  if (/search|grep|find/.test(n)) return `Searching: ${valStr}`;
  if (/edit|replace|patch|str/.test(n)) return `Patching ${valStr}`;
  return valStr;
}

// classifyEvent — taken from the richer page.tsx implementation which handles
// both plain events (p.text) and Claude stream-json raw envelope (p.raw).
// Copy the full classifyEvent from page.tsx lines ~78–175 verbatim here.
// Key cases to preserve:
//   TOOL_CALL: uses p.tool, p.input (command/code/path/query/content keys)
//   FILE_CREATE: regex-extracts filename from p.text or p.path
//   FILE_MODIFY: same extraction pattern
//   REASONING: checks p.text first, then p.raw.type for 'assistant'/'user'/'result'/'system'
//     - p.raw.type === 'assistant' → unwrap content blocks (thinking, tool_use, text)
//     - p.raw.type === 'user' → unwrap tool_result for RESULT/FAIL labels
//     - p.raw.type === 'result' → DONE label
//     - p.raw.type === 'system' | 'rate_limit_event' → return null (suppress)
//   ERROR: label FAIL or ERROR based on message
//   COMMENTARY: label CAST
//
// Do NOT use a simplified version — the replay page depends on the raw-envelope handling.
export function classifyEvent(type: string, payload: unknown): EventInfo | null {
  const p = payload as Record<string, unknown> | null;
  if (!p) return null;
  // --- paste full implementation from page.tsx classifyEvent here ---
}

export function getRelativeTime(timestamp: string, startTs: string | null): string {
  if (!startTs) return '';
  const diff = Math.max(0, new Date(timestamp).getTime() - new Date(startTs).getTime());
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${(s % 60).toString().padStart(2, '0')}s` : `${s}s`;
}

// ─── EventRow ─────────────────────────────────────────────────────────────────

const EXPAND_THRESHOLD = 120;

export function EventRow({
  event,
  startTs,
  expanded,
  onToggle,
  isNew,
}: {
  event: EventRowEvent;
  startTs: string | null;
  expanded: boolean;
  onToggle: () => void;
  isNew?: boolean;
}) {
  const info = classifyEvent(event.type, event.payload);
  if (!info) return null;

  const relTime = getRelativeTime(event.timestamp, startTs);
  const canExpand = info.text.length > EXPAND_THRESHOLD;

  return (
    <div
      className={isNew ? 'event-row event-appear' : 'event-row'}
      style={{
        borderRadius: '8px',
        fontSize: '0.88rem',
        lineHeight: 1.5,
        borderLeft: expanded ? '2px solid #eab308' : '2px solid transparent',
        transition: 'border-color 0.15s ease',
      }}
    >
      {/* Main row */}
      <div
        onClick={canExpand ? onToggle : undefined}
        style={{
          background: info.bg,
          borderRadius: expanded ? '8px 8px 0 0' : '8px',
          padding: '0.55rem 0.8rem',
          display: 'flex', gap: '0.55rem', alignItems: 'flex-start',
          cursor: canExpand ? 'pointer' : 'default',
        }}
      >
        <span style={{
          color: '#4a5568', fontSize: '0.75rem', fontFamily: 'monospace',
          flexShrink: 0, width: '2.8rem', textAlign: 'right',
          marginTop: '2px', letterSpacing: '-0.3px',
        }}>
          {relTime}
        </span>
        <span style={{ flexShrink: 0, fontSize: '1.0rem', lineHeight: 1.4 }}>{info.icon}</span>
        <span style={{
          color: info.color, fontWeight: 800, flexShrink: 0, fontSize: '0.72rem',
          letterSpacing: '0.5px',
          background: `rgba(${hexToRgb(info.color)},0.12)`,
          padding: '0.1rem 0.45rem', borderRadius: '4px', marginTop: '1px',
          whiteSpace: 'nowrap',
        }}>
          {info.label}
        </span>
        <span style={{
          color: '#c4d4e8', flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {info.text}
        </span>
        {canExpand && (
          <span style={{ fontSize: '0.6rem', color: '#2d4060', flexShrink: 0, marginLeft: '0.3rem' }}>
            {expanded ? '▲' : '▼'}
          </span>
        )}
      </div>

      {/* Expand panel (Option B — below row) */}
      {expanded && (
        <div style={{
          background: 'rgba(234,179,8,0.04)',
          border: '1px solid rgba(234,179,8,0.15)',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          padding: '0.6rem 0.8rem 0.6rem 4.6rem',
        }}>
          <span style={{
            color: '#c4d4e8', fontSize: '0.85rem', lineHeight: 1.65,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {info.text}
          </span>
          <div style={{ marginTop: '0.4rem' }}>
            <span
              onClick={onToggle}
              style={{ fontSize: '0.6rem', color: '#4a5568', cursor: 'pointer' }}
            >
              ▲ collapse
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 1.2: Update `page.tsx` to use shared EventRow**

In `packages/web/app/competitions/[id]/page.tsx`:

a) Add import at the top (replace the existing local definitions):
```typescript
import { EventRow, classifyEvent, getRelativeTime } from '../../../lib/EventRow';
```
(Note: `page.tsx` is at `app/competitions/[id]/page.tsx` — three levels up to `lib/`, not four.)

b) Remove the local definitions of `getToolIcon`, `toolCommentary`, `classifyEvent`, `EventInfo`, `getRelativeTime`, and the old `EventRow` function (lines ~44–531). Keep the local `ArenaEvent` interface — it has `eventId` which is used as the React `key` throughout the file.

c) Add `expandedEventId` state to `LanePanel` component:
```typescript
const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
```

d) Replace the `<EventRow>` call inside `LanePanel` (currently at line ~736):
```tsx
<EventRow
  key={ev.eventId}
  event={ev}
  startTs={competitionStartTime ? new Date(competitionStartTime).toISOString() : null}
  expanded={expandedEventId === ev.eventId}
  onToggle={() => setExpandedEventId(prev => prev === ev.eventId ? null : ev.eventId)}
/>
```

e) The `LanePanel` props interface already passes `competitionStartTime: number | null` — convert to ISO string for the shared component as shown above.

- [ ] **Step 1.3: Update `replay/page.tsx` to use shared EventRow**

In `packages/web/app/competitions/[id]/replay/page.tsx`:

a) Add import (replace local definitions):
```typescript
import { EventRow, classifyEvent, getRelativeTime } from '../../../../lib/EventRow';
```
(Replay is at `app/competitions/[id]/replay/page.tsx` — four levels up to `lib/`.)

b) Remove local `getToolIcon`, `toolCommentary`, `classifyEvent`, `EventInfo`, `formatRelativeTime`, and the old `EventRow` function (lines ~60–373). Keep the local `ArenaEvent` interface — it uses `id` (not `eventId`) which is used as `key={ev.id}` in the lane render loop.

c) Add `expandedEventId` state to `ReplayPage`:
```typescript
const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
```

d) Replace `<EventRow>` calls (line ~975):
```tsx
<EventRow
  key={ev.eventId}
  event={ev}
  startTs={startTs}
  expanded={expandedEventId === ev.eventId}
  onToggle={() => setExpandedEventId(prev => prev === ev.eventId ? null : ev.eventId)}
  isNew={idx === visibleEvents.length - 1 && playing}
/>
```

e) The hover tooltip in `TimelineScrubber` calls `classifyEvent` twice (line ~518–521). Fix it:
```tsx
{(() => {
  const info = classifyEvent(hoveredEvent.type, hoveredEvent.payload);
  return <>{info?.icon ?? '·'} {info?.label ?? hoveredEvent.type}</>;
})()}
```

- [ ] **Step 1.4: Typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 1.5: Commit**

```bash
git add packages/web/lib/EventRow.tsx \
        "packages/web/app/competitions/[id]/page.tsx" \
        "packages/web/app/competitions/[id]/replay/page.tsx"
git commit -m "refactor: extract shared EventRow with Option-B click-to-expand panel"
```

---

### Task 2: Replay keyboard shortcuts

**Files:**
- Modify: `packages/web/app/competitions/[id]/replay/page.tsx`

- [ ] **Step 2.1: Add keyboard shortcut `useEffect`**

In `ReplayPage`, after the existing state declarations, add:

```typescript
// Keyboard shortcuts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    // Don't fire when typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        setPlaying((p) => !p);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        setPlaying(false);
        setCursor((c) => Math.max(0, c - 1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        setPlaying(false);
        setCursor((c) => Math.min(allEvents.length, c + 1));
        break;
      case '0':
      case 'Home':
        e.preventDefault();
        setPlaying(false);
        setCursor(0);
        break;
      case 'End':
        e.preventDefault();
        setPlaying(false);
        setCursor(allEvents.length);
        break;
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [allEvents.length]);
```

- [ ] **Step 2.2: Add keyboard hint to the replay UI**

Find the speed buttons section (~line 841) and add a small hint below the controls:

```tsx
<div style={{ fontSize: '0.62rem', color: '#2d4060', marginTop: '0.5rem', textAlign: 'center', letterSpacing: '0.3px' }}>
  Space play/pause · ←→ step · 0 reset · End jump to end
</div>
```

- [ ] **Step 2.3: Typecheck and commit**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
git add "packages/web/app/competitions/[id]/replay/page.tsx"
git commit -m "feat: add keyboard shortcuts to replay viewer (Space, arrows, 0/Home, End)"
```

---

## Chunk 2: Forge Progress + Zip Download

### Task 3: Per-artifact forge progress

**Context:**
- `forge-orchestrator.ts`: `runForge()` does `Promise.all(ARTIFACT_SPECS.map(generateArtifact))` — all 6 in parallel
- `runForge` is called from `competitions.ts` route at `POST /competitions/:id/forge`
- The frontend currently polls `GET /forge` every 3s — extend this to also poll `GET /forge/progress`

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`
- Modify: `packages/web/app/competitions/[id]/page.tsx`

---

- [ ] **Step 3.1: Add progress map to `forge-orchestrator.ts`**

At the top of the file, after the imports, add:

```typescript
type ArtifactStatus = 'queued' | 'generating' | 'done' | 'error';
type ProgressMap = Record<string, ArtifactStatus>;

const forgeProgressStore = new Map<string, ProgressMap>();

export function getForgeProgress(competitionId: string): ProgressMap | null {
  return forgeProgressStore.get(competitionId) ?? null;
}
```

- [ ] **Step 3.2: Wire progress updates into `runForge`**

Change `runForge` signature to accept `competitionId` and update the map:

```typescript
export async function runForge(input: ForgeInput, competitionId: string): Promise<ForgeOutput> {
  const userPrompt = buildForgeUserPrompt(input);

  // Initialize all artifacts as queued
  const initial: ProgressMap = Object.fromEntries(
    ARTIFACT_SPECS.map((s) => [s.type, 'queued' as ArtifactStatus])
  ) as ProgressMap;
  forgeProgressStore.set(competitionId, initial);

  const generateArtifact = async (spec: ArtifactSpec): Promise<ForgeArtifact> => {
    // Mark as generating
    const prog = forgeProgressStore.get(competitionId);
    if (prog) prog[spec.type] = 'generating';

    try {
      const content = await runClaude(userPrompt, spec.systemPrompt);
      if (prog) prog[spec.type] = 'done';
      return { type: spec.type, title: spec.title, content, generatedAt: new Date().toISOString() };
    } catch (err) {
      if (prog) prog[spec.type] = 'error';
      throw err;
    }
  };

  try {
    const artifacts = await Promise.all(ARTIFACT_SPECS.map(generateArtifact));
    return { forgeModel: FORGE_MODEL_LABEL, artifacts, generatedAt: new Date().toISOString() };
  } finally {
    // Clean up after 5 minutes
    setTimeout(() => forgeProgressStore.delete(competitionId), 5 * 60 * 1000);
  }
}
```

- [ ] **Step 3.3: Update the call site in `competitions.ts`**

The full call at line ~204 is a chained promise. Replace just `runForge(forgeInput)` with `runForge(forgeInput, id)`, keeping the rest of the chain intact:

```typescript
runForge(forgeInput, id)
  .then(async (forgeOutput) => {
    await repo.saveForge(id, forgeOutput);
    await repo.updateState(id, CompetitionState.FORGE_COMPLETE);
    console.log(`[arena] forge complete for ${id} — ${forgeOutput.artifacts.length} artifacts`);
  })
  .catch(async (err: Error) => {
    console.error(`[arena] forge failed for ${id}:`, err.message);
    await repo.updateState(id, CompetitionState.COMPLETE).catch(console.error);
  })
  .finally(() => {
    forgingInProgress.delete(id);
  });
```

- [ ] **Step 3.4: Add `GET /competitions/:id/forge/progress` endpoint**

In `competitions.ts`, add after the existing forge endpoints:

```typescript
// GET /competitions/:id/forge/progress — per-artifact progress during forging
competitionsRouter.get('/:id/forge/progress', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const progress = getForgeProgress(id);
  if (!progress) {
    res.status(404).json({ error: 'No forge in progress for this competition' });
    return;
  }
  res.json({ progress });
});
```

Update the existing import at line 11 of `competitions.ts` to add `getForgeProgress`. Keep the separate type import on line 12 untouched:

```typescript
// Line 11 — change from:
import { runForge } from '../../forge/forge-orchestrator.js';
// to:
import { runForge, getForgeProgress } from '../../forge/forge-orchestrator.js';

// Line 12 — leave unchanged:
import type { ForgeInput } from '../../forge/forge-orchestrator.js';
```

- [ ] **Step 3.5: Update forge polling in `page.tsx` to show checklist**

In `ScoreDrawer`, find the `forging` state section (~line 981). Add a progress state:

```typescript
const [forgeProgress, setForgeProgress] = useState<Record<string, string> | null>(null);
```

In the forge poll interval (inside the `onClick` handler), extend to fetch progress:

```typescript
forgePollRef.current = setInterval(async () => {
  attempts++;
  try {
    // Poll progress (best-effort, don't fail if 404)
    const progRes = await fetch(`${apiBase}/competitions/${competitionId}/forge/progress`);
    if (progRes.ok) {
      const { progress } = await progRes.json();
      setForgeProgress(progress);
    }

    // Poll for completion
    const pollRes = await fetch(`${apiBase}/competitions/${competitionId}/forge`);
    if (pollRes.ok) {
      const data = await pollRes.json();
      if (data.status === 'complete' && data.forge) {
        clearInterval(forgePollRef.current!); forgePollRef.current = null;
        setForgeProgress(null);
        onForgeComplete?.(data.forge);
        setActiveTab('forge');
        setForging(false);
      }
    } else if (pollRes.status === 404) {
      clearInterval(forgePollRef.current!); forgePollRef.current = null;
      setForgeProgress(null);
      setForgeError('Forge failed server-side. Check the API server logs for details.');
      setForging(false);
    }
  } catch { /* network error, keep polling */ }
  if (attempts >= 60) {
    clearInterval(forgePollRef.current!); forgePollRef.current = null;
    setForgeProgress(null);
    setForgeError('Forge timed out after 3 minutes.');
    setForging(false);
  }
}, 3000);
```

- [ ] **Step 3.6: Render the checklist in the Forge tab while forging**

In `ScoreDrawer`, find the Forge tab content (the section showing the "Forge This Solution" button area). Add the checklist above the button, shown only when `forging === true`:

```tsx
{forging && (
  <div style={{ marginBottom: '1.5rem', textAlign: 'left', display: 'inline-block' }}>
    <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '2px', color: '#8896ab', marginBottom: '0.6rem' }}>
      FORGING ARTIFACTS
    </div>
    {[
      { type: 'roadmap', label: 'Roadmap' },
      { type: 'task_graph', label: 'Task Graph' },
      { type: 'repo_blueprint', label: 'Repo Blueprint' },
      { type: 'api_contracts', label: 'API Contracts' },
      { type: 'risk_register', label: 'Risk Register' },
      { type: 'decision_log', label: 'Decision Log' },
    ].map(({ type, label }) => {
      const status = forgeProgress?.[type] ?? 'queued';
      return (
        <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
          <span style={{ fontSize: '0.75rem', color: status === 'done' ? '#22c55e' : status === 'generating' ? '#eab308' : status === 'error' ? '#ef4444' : '#4a5568', flexShrink: 0, width: '1rem', textAlign: 'center' }}>
            {status === 'done' ? '✓' : status === 'generating' ? '⟳' : status === 'error' ? '✗' : '○'}
          </span>
          <span style={{ fontSize: '0.7rem', color: status === 'queued' ? '#4a5568' : '#e2e8f0', flex: 1 }}>{label}</span>
          <span style={{ fontSize: '0.62rem', color: status === 'done' ? '#22c55e' : status === 'generating' ? '#eab308' : status === 'error' ? '#ef4444' : '#2d4060' }}>
            {status === 'done' ? 'done' : status === 'generating' ? 'generating…' : status === 'error' ? 'error' : 'queued'}
          </span>
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 3.7: Typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
npm run typecheck --workspace=packages/orchestrator
```

Expected: no errors.

- [ ] **Step 3.8: Run tests**

```bash
npm run test --workspace=packages/orchestrator
```

Expected: 162 tests passing.

- [ ] **Step 3.9: Commit**

```bash
git add packages/orchestrator/src/forge/forge-orchestrator.ts \
        packages/orchestrator/src/server/routes/competitions.ts \
        "packages/web/app/competitions/[id]/page.tsx"
git commit -m "feat: add real per-artifact forge progress (checklist rows, GET /forge/progress)"
```

---

### Task 4: Forge zip download + "Forged by" badge

**Files:**
- Modify: `packages/orchestrator/package.json` (add `archiver` dep)
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`
- Modify: `packages/web/app/competitions/[id]/page.tsx`

---

- [ ] **Step 4.1: Add `archiver` to the orchestrator package**

```bash
npm install archiver @types/archiver --workspace=packages/orchestrator
```

Verify it's in `packages/orchestrator/package.json` under `dependencies`.

- [ ] **Step 4.2: Add `GET /competitions/:id/forge/download` endpoint**

First, add `import archiver from 'archiver';` at the **top** of `competitions.ts` with the other imports (after line 12). ES module imports must be at file top level.

Then add the route after the `/forge/progress` endpoint:

```typescript
// GET /competitions/:id/forge/download — zip of all 6 forge artifacts
competitionsRouter.get('/:id/forge/download', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const result = await repo.getResult(id);
  if (!result?.forge) {
    res.status(404).json({ error: 'No forge results for this competition' });
    return;
  }

  const forge = result.forge as ForgeOutput;
  const comp = await repo.getCompetition(id);
  const title = (comp?.brief as { title?: string } | null)?.title ?? id;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}-forge.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => { res.destroy(err); });
  archive.pipe(res);

  for (const artifact of forge.artifacts) {
    archive.append(artifact.content, { name: `${artifact.type}.md` });
  }

  await archive.finalize();
});
```

Add `ForgeOutput` to the imports from `@arena/shared` at the top of `competitions.ts`.

- [ ] **Step 4.3: Add Next.js API proxy route for the download**

Create `packages/web/app/api/competitions/[id]/forge/download/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await fetch(`${API_BASE}/competitions/${id}/forge/download`);
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Download failed' }, { status: upstream.status });
  }
  const blob = await upstream.blob();
  const disposition = upstream.headers.get('Content-Disposition') ?? `attachment; filename="${id}-forge.zip"`;
  return new NextResponse(blob, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': disposition,
    },
  });
}
```

- [ ] **Step 4.4: Add "Download All" button and "Forged by" badge in the Forge tab**

In `ScoreDrawer` in `page.tsx`, find the Forge tab artifact rendering section (where the 6 sub-tabs are shown after forge completes). Add:

a) **"Forged by" badge** — immediately below the FORGE tab heading, shown when `result.forge` exists:

```tsx
{result.forge && (
  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem' }}>
    <span style={{
      fontSize: '0.6rem', fontWeight: 700, letterSpacing: '1px',
      color: '#eab308', background: 'rgba(234,179,8,0.1)',
      border: '1px solid rgba(234,179,8,0.25)', borderRadius: '4px',
      padding: '0.15rem 0.5rem',
    }}>
      ⚒ Forged by {result.forge.forgeModel}
    </span>
    <span style={{ fontSize: '0.6rem', color: '#4a5568' }}>
      {new Date(result.forge.generatedAt).toLocaleDateString()}
    </span>
  </div>
)}
```

b) **"Download All" button** — next to the artifact sub-tab row:

```tsx
<a
  href={`/api/competitions/${competitionId}/forge/download`}
  download
  style={{
    fontSize: '0.65rem', fontWeight: 700, color: '#8896ab',
    background: 'rgba(136,150,171,0.08)', border: '1px solid rgba(136,150,171,0.2)',
    borderRadius: '4px', padding: '0.3rem 0.7rem',
    textDecoration: 'none', letterSpacing: '0.5px',
    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
  }}
>
  ⬇ Download All (.zip)
</a>
```

- [ ] **Step 4.5: Typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
npm run typecheck --workspace=packages/orchestrator
```

Expected: no errors.

- [ ] **Step 4.6: Run tests**

```bash
npm run test --workspace=packages/orchestrator
```

Expected: 162 tests passing.

- [ ] **Step 4.7: Commit**

```bash
git add packages/orchestrator/package.json \
        packages/orchestrator/src/server/routes/competitions.ts \
        "packages/web/app/api/competitions/[id]/forge/download/route.ts" \
        "packages/web/app/competitions/[id]/page.tsx"
git commit -m "feat: add forge zip download endpoint and 'Forged by' badge"
```

---

## Verification

After all tasks are complete:

```bash
# Full typecheck
npx tsc --noEmit -p packages/web/tsconfig.json
npm run typecheck --workspace=packages/orchestrator

# Full test suite
npm run test --workspace=packages/orchestrator
# Expected: 162 tests, 0 failures

# Manual smoke test
# 1. Open a completed competition → verify EventRow click-to-expand works (panel below row)
# 2. Open replay → verify Space/arrows/0/End keyboard shortcuts work
# 3. Click "Forge This Solution" → verify checklist rows animate as artifacts complete
# 4. After forge completes → verify "⚒ Forged by" badge appears
# 5. Click "Download All" → verify zip downloads with 6 .md files
```
