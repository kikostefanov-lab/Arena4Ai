# Results Panel Layout Redesign — Implementation Plan

> **Status: COMPLETE**

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all five narrow centered tab layouts in the ScoreDrawer with full-width designs that eliminate vertical scrolling and use horizontal space efficiently.

**Architecture:** All changes are inside the `ScoreDrawer` function in `packages/web/app/competitions/[id]/page.tsx` (lines ~733–1775). No new files, no API changes. New state variables for selected criterion/file/forge-run and a resizable file preview panel using the existing drag mechanic.

**Tech Stack:** React 18, TypeScript, Next.js 15 App Router, inline styles (no Tailwind in this file)

**Spec:** `docs/superpowers/specs/2026-03-11-results-panel-layout-redesign.md`

---

## Context for every task

The file is `packages/web/app/competitions/[id]/page.tsx`. The `ScoreDrawer` function starts at line ~733. All five tab renderings live inside a single scrollable `<div>` starting at line ~1066:

```tsx
<div className="arena-scrollbar" style={{ overflowY: 'auto', flex: 1, padding: '1.25rem 1.5rem 1.5rem' }}>
```

The five tab blocks are:
- **SCORES TAB** — lines ~1068–1166 — card grid with `maxWidth: '700px', margin: '0 auto'`
- **PRESENTATIONS TAB** — lines ~1168–1299 — stacked cards with `maxWidth: '760px', margin: '0 auto'`
- **FILES TAB (deliverables)** — lines ~1301–1417 — stacked team blocks with `maxWidth: '700px', margin: '0 auto'`
- **FILES TAB (fallback)** — lines ~1419–1496 — already columnar but with `maxWidth: '900px', margin: '0 auto'`
- **SYNTHESIS TAB** — lines ~1498–1636 — stacked sections with `maxWidth: '760px', margin: '0 auto'`
- **FORGE TAB** — lines ~1638–1773 — stacked runs with `maxWidth: '760px', margin: '0 auto'`

Existing state in ScoreDrawer (do NOT remove):
- `activeTab`, `activeFileIdx`, `expandedFile`, `fileModalContent`, `presentationModal`
- `isExpanded`, `winnerLabel`, `teamDisplays`, `scoreSummary`
- `totalFileCount`, `hasFiles`, `renderedSynthesis`, `hasPresentations`, `hasForge`
- `synthRunning`, `synthError`, `scoreProgress`, `showWinnerBanner`

TRON color palette (use these — don't invent new colors):
- Backgrounds: `#000408`, `#050f1e`, `#020b14`, `#010810`
- Borders: `#0a2235`, `#0e3050`
- Text: `#c8eef8` (primary), `#7cc6db` (body), `#4a8fa8` (muted), `#1e4a5a` (dim), `#3d7d94` (label)
- Accent: `#00f0ff` (cyan), `#ff6600` (orange/Claude), `#0066ff` (blue/Codex)
- Winner: `#eab308` (gold)
- Model colors via `LANE_COLORS[i]` and `getModelColor(model)`

After every task: run `npx tsc --noEmit -p packages/web/tsconfig.json` — must produce zero errors.

---

## Task 1: Add new state variables and tab content container

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx` — ScoreDrawer function, state declarations (~lines 754–760) and tab content div (~line 1066)

This task adds the state needed by Tasks 2–6 and reduces the tab content area padding so full-width layouts breathe properly.

- [ ] **Step 1: Add new state variables inside ScoreDrawer**

Find the existing state block (around line 757–760):
```tsx
const [activeFileIdx, setActiveFileIdx] = useState<Record<string, number>>({});
const [expandedFile, setExpandedFile] = useState<{ teamId: string; path: string } | null>(null);
const [fileModalContent, setFileModalContent] = useState<{ path: string; content: string } | null>(null);
const [presentationModal, setPresentationModal] = useState<TeamPresentation | null>(null);
```

Add these four new state variables immediately after that block:
```tsx
// Layout redesign state
const [selectedCriterionId, setSelectedCriterionId] = useState<string | null>(null);
const [selectedSynthCriterionId, setSelectedSynthCriterionId] = useState<string | null>(null);
const [selectedFileKey, setSelectedFileKey] = useState<{ teamId: string; path: string } | null>(null);
const [filePreviewHeight, setFilePreviewHeight] = useState(180);
const [activeForgeRunId, setActiveForgeRunId] = useState<string | null>(
  result.forge && result.forge.length > 0 ? result.forge[result.forge.length - 1].id : null
);
const isDraggingFilePreview = useRef(false);
const dragFilePreviewStartY = useRef(0);
const dragFilePreviewStartH = useRef(0);
```

**Note:** `activeForgeRunId` and `setActiveForgeRunId` already exist in the outer `CompetitionPage` component scope — check if they are passed into ScoreDrawer or declared inside it. Search the file for `activeForgeRunId` before adding this. If already declared inside ScoreDrawer, skip adding it again.

- [ ] **Step 2: Add file preview drag handler inside ScoreDrawer**

After the state block, add the drag effect (same pattern as the existing `handleResizeStart` for the score drawer):
```tsx
useEffect(() => {
  const handleMove = (e: MouseEvent) => {
    if (!isDraggingFilePreview.current) return;
    const delta = dragFilePreviewStartY.current - e.clientY;
    const newH = Math.max(52, Math.min(420, dragFilePreviewStartH.current + delta));
    setFilePreviewHeight(newH);
  };
  const handleUp = () => { isDraggingFilePreview.current = false; };
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleUp);
  return () => {
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', handleUp);
  };
}, []);
```

- [ ] **Step 3: Reduce tab content container padding**

Find the tab content wrapper (around line 1066):
```tsx
<div className="arena-scrollbar" style={{ overflowY: 'auto', flex: 1, padding: '1.25rem 1.5rem 1.5rem' }}>
```

Change its padding so full-width layouts don't get squeezed. The padding should be small on sides for full-width tabs but tabs themselves control their own internal padding:
```tsx
<div className="arena-scrollbar" style={{ overflowY: 'auto', flex: 1, padding: 0 }}>
```

- [ ] **Step 4: Typecheck**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
npx tsc --noEmit -p packages/web/tsconfig.json
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add "packages/web/app/competitions/[id]/page.tsx"
git commit -m "feat(ui): add layout state vars for results panel redesign"
```

---

## Task 2: Scores tab — criterion table with expandable commentary

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx` — SCORES TAB block (~lines 1068–1166)

Replace the card grid with a full-width table where criteria are rows, teams are columns, and clicking a row expands all team commentary side-by-side beneath it.

- [ ] **Step 1: Replace the SCORES TAB block**

Delete everything between `{/* SCORES TAB */}` and its closing `)}` (lines ~1068–1166) and replace with:

```tsx
{/* SCORES TAB */}
{activeTab === 'scores' && (
  <div style={{ padding: '0' }}>
    {/* Total score header row */}
    <div style={{
      display: 'grid',
      gridTemplateColumns: `200px repeat(${teamDisplays.length}, 1fr) 120px`,
      background: '#020b14',
      borderBottom: '2px solid #0e3050',
      padding: '0.5rem 1rem',
      position: 'sticky', top: 0, zIndex: 2,
    }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px', display: 'flex', alignItems: 'center' }}>
        CRITERION
      </div>
      {teamDisplays.map(({ result: tr, label, color, isWinner }, i) => (
        <div key={tr.teamId} style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', marginBottom: '0.2rem' }}>
            {isWinner && <span style={{ fontSize: '0.8rem' }}>🏆</span>}
            <ModelBadge model={label.split(':')[0]} />
          </div>
          <div style={{ fontSize: '0.65rem', color, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 900, color: isWinner ? '#eab308' : '#c8eef8', fontFamily: 'monospace', marginTop: '0.1rem' }}>
            {Math.round(tr.totalScore * 100 * scoreProgress)}%
          </div>
        </div>
      ))}
      <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        WINNER
      </div>
    </div>

    {/* Criterion rows */}
    {(() => {
      // Build per-criterion data: for each criterion, collect all team scores
      const criteria = teamDisplays[0]?.result.criteriaScores ?? [];
      return criteria.map((cs) => {
        const isOpen = selectedCriterionId === cs.criterionId;
        // Find winner for this criterion (highest score)
        const scoresForCrit = teamDisplays.map((td) => ({
          ...td,
          cs: td.result.criteriaScores.find(c => c.criterionId === cs.criterionId),
        }));
        const winnerForCrit = scoresForCrit.reduce((best, cur) =>
          (cur.cs?.score ?? 0) > (best.cs?.score ?? 0) ? cur : best
        );
        return (
          <div key={cs.criterionId}>
            {/* Criterion row */}
            <div
              onClick={() => setSelectedCriterionId(isOpen ? null : cs.criterionId)}
              style={{
                display: 'grid',
                gridTemplateColumns: `200px repeat(${teamDisplays.length}, 1fr) 120px`,
                padding: '0.55rem 1rem',
                borderBottom: '1px solid rgba(10,34,53,0.5)',
                cursor: 'pointer',
                background: isOpen ? 'rgba(0,240,255,0.05)' : 'transparent',
                transition: 'background 0.1s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.62rem', color: isOpen ? '#00f0ff' : '#3d7d94', flexShrink: 0 }}>
                  {isOpen ? '▼' : '▶'}
                </span>
                <span style={{ fontSize: '0.72rem', color: isOpen ? '#7cc6db' : '#4a8fa8', fontWeight: isOpen ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cs.criterionId}
                </span>
              </div>
              {scoresForCrit.map(({ result: tr, color, isWinner, cs: crit }) => {
                const maxScore = crit?.maxScore ?? 10;
                const pct = maxScore > 0 && crit ? (crit.score / maxScore) * 100 : 0;
                return (
                  <div key={tr.teamId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '50px', height: '4px', background: '#0a2235', borderRadius: '2px', overflow: 'hidden' }}>
                      <div
                        className="arena-progress-bar"
                        style={{ height: '100%', width: `${pct * scoreProgress}%`, background: isWinner ? '#eab308' : color, borderRadius: '2px' }}
                      />
                    </div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, fontFamily: 'monospace', color: isWinner ? '#eab308' : '#c8eef8', flexShrink: 0 }}>
                      {crit ? Math.round((crit.score / maxScore) * 100 * scoreProgress) : 0}%
                    </span>
                  </div>
                );
              })}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{
                  fontSize: '0.65rem', fontWeight: 800, padding: '0.15rem 0.5rem', borderRadius: '3px',
                  letterSpacing: '0.5px', color: winnerForCrit.color,
                  background: `rgba(${hexToRgb(winnerForCrit.color)},0.12)`,
                  border: `1px solid rgba(${hexToRgb(winnerForCrit.color)},0.3)`,
                }}>
                  {winnerForCrit.label.split(':')[0].toUpperCase()}
                </span>
              </div>
            </div>

            {/* Expandable commentary row */}
            {isOpen && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${teamDisplays.length}, 1fr)`,
                gap: 0,
                background: '#020b14',
                borderBottom: '1px solid #0a2235',
              }}>
                {scoresForCrit.map(({ result: tr, label, color, cs: crit }, colIdx) => (
                  <div
                    key={tr.teamId}
                    style={{
                      padding: '0.75rem 1rem',
                      borderRight: colIdx < teamDisplays.length - 1 ? '1px solid #0a2235' : 'none',
                      borderLeft: `2px solid rgba(${hexToRgb(color)},0.4)`,
                    }}
                  >
                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color, letterSpacing: '0.5px', marginBottom: '0.35rem' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#4a8fa8', lineHeight: 1.6, fontStyle: 'italic' }}>
                      {crit?.commentary || <span style={{ color: '#1e4a5a' }}>No commentary</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      });
    })()}

    {result.summary && (
      <div style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#4a8fa8', lineHeight: 1.7, borderTop: '1px solid #0a2235' }}>
        {result.summary}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 2: Typecheck**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
npx tsc --noEmit -p packages/web/tsconfig.json
```
Expected: zero errors.

- [ ] **Step 3: Visual check**

Start or reload the web UI (`cd packages/web && npm run dev`). Open a completed competition. The Scores tab should show a table with criteria as rows, team scores as columns. Clicking a row should expand commentary side-by-side below. No horizontal scrollbar on full-width view.

- [ ] **Step 4: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add "packages/web/app/competitions/[id]/page.tsx"
git commit -m "feat(ui): scores tab — criterion table with expandable commentary"
```

---

## Task 3: Presentations tab — parallel team columns

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx` — PRESENTATIONS TAB block (~lines 1168–1299)

Replace the single stacked column (`maxWidth: '760px'`) with N side-by-side columns, one per team. Each column is independently scrollable. Criterion findings are click-to-expand inline.

- [ ] **Step 1: Replace the PRESENTATIONS TAB block**

Delete everything between `{/* PRESENTATIONS TAB */}` and its closing `)}` (lines ~1168–1299) and replace with:

```tsx
{/* PRESENTATIONS TAB */}
{activeTab === 'presentations' && hasPresentations && (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    {/* Column grid — one column per team */}
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${result.presentations!.length}, 1fr)`,
      flex: 1, minHeight: 0,
    }}>
      {result.presentations!.map((pres, presIdx) => {
        const label = resolveLabel(teams, pres.teamId, pres.teamId);
        const color = LANE_COLORS[presIdx] ?? '#4a8fa8';
        const rgb = hexToRgb(color);
        const isWinner = pres.teamId === result.winnerId;

        return (
          <div
            key={pres.teamId}
            className="arena-scrollbar"
            style={{
              borderRight: presIdx < result.presentations!.length - 1 ? '1px solid #0a2235' : 'none',
              overflowY: 'auto',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Sticky column header */}
            <div style={{
              position: 'sticky', top: 0, zIndex: 2,
              background: `rgba(${rgb},0.08)`,
              borderBottom: `1px solid rgba(${rgb},0.2)`,
              padding: '0.6rem 1rem',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              flexShrink: 0,
            }}>
              {isWinner && <span style={{ fontSize: '0.85rem' }}>🏆</span>}
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: isWinner ? '#eab308' : color, letterSpacing: '1px', textTransform: 'uppercase', flex: 1 }}>
                {label}
              </span>
              <span style={{ fontSize: '0.6rem', color: '#1e4a5a', fontStyle: 'italic' }}>({pres.model})</span>
              <button
                onClick={() => setPresentationModal(pres)}
                style={{ fontSize: '0.58rem', padding: '0.15rem 0.45rem', borderRadius: '3px', background: 'transparent', border: '1px solid #0a2235', color: '#7cc6db', cursor: 'pointer', fontFamily: 'monospace' }}
              >⤢</button>
              <button
                onClick={() => downloadPresentation(pres)}
                style={{ fontSize: '0.58rem', padding: '0.15rem 0.45rem', borderRadius: '3px', background: 'rgba(0,240,255,0.08)', border: '1px solid rgba(0,240,255,0.3)', color: '#00f0ff', cursor: 'pointer', fontFamily: 'monospace' }}
              >↓ MD</button>
            </div>

            {/* Approach */}
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(10,34,53,0.4)' }}>
              <div style={{ fontSize: '0.58rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Approach</div>
              <div style={{ fontSize: '0.75rem', color: '#7cc6db', lineHeight: 1.6 }}>{pres.approach}</div>
            </div>

            {/* Key insight */}
            <div style={{ padding: '0.65rem 1rem', borderBottom: '1px solid rgba(10,34,53,0.4)', background: 'rgba(0,240,255,0.03)' }}>
              <div style={{ fontSize: '0.58rem', fontWeight: 800, color: '#00f0ff', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Key Insight</div>
              <div style={{ fontSize: '0.72rem', color: '#c8eef8', lineHeight: 1.6, fontStyle: 'italic' }}>{pres.keyInsight}</div>
            </div>

            {/* Criterion findings — click each to expand */}
            {pres.criterionFindings.map((cf) => {
              const cfKey = `${pres.teamId}:${cf.criterionId}`;
              const isOpen = selectedCriterionId === cfKey;
              return (
                <div
                  key={cf.criterionId}
                  onClick={() => setSelectedCriterionId(isOpen ? null : cfKey)}
                  style={{
                    padding: '0.5rem 1rem',
                    borderBottom: '1px solid rgba(10,34,53,0.35)',
                    cursor: 'pointer',
                    background: isOpen ? 'rgba(0,240,255,0.04)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.58rem', color: isOpen ? '#00f0ff' : '#3d7d94' }}>{isOpen ? '▼' : '▶'}</span>
                    <code style={{ fontSize: '0.6rem', color: '#4a6080', background: '#000408', padding: '0.1rem 0.35rem', borderRadius: '3px', border: '1px solid #0a2235' }}>{cf.criterionId}</code>
                  </div>
                  {isOpen && (
                    <div style={{ marginTop: '0.4rem', paddingLeft: '0.9rem' }}>
                      <div style={{ fontSize: '0.72rem', color: '#7cc6db', lineHeight: 1.6, marginBottom: '0.3rem' }}>{cf.finding}</div>
                      {cf.strength && (
                        <div style={{ fontSize: '0.65rem', color: '#00f0ff', marginBottom: '0.15rem' }}>
                          <span style={{ fontWeight: 700 }}>+</span> {cf.strength}
                        </div>
                      )}
                      {cf.gap && (
                        <div style={{ fontSize: '0.65rem', color: '#ef444488' }}>
                          <span style={{ fontWeight: 700 }}>−</span> {cf.gap}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Deliverable summary */}
            <div style={{ padding: '0.65rem 1rem', marginTop: 'auto' }}>
              <div style={{ fontSize: '0.58rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Deliverables</div>
              <div style={{ fontSize: '0.68rem', color: '#4a8fa8', lineHeight: 1.6 }}>{pres.deliverableSummary}</div>
            </div>
          </div>
        );
      })}
    </div>
  </div>
)}

{activeTab === 'presentations' && !hasPresentations && (
  <div style={{ padding: '3rem', textAlign: 'center', color: '#1e4a5a', fontSize: '0.8rem', fontStyle: 'italic' }}>
    Presentations not available for this competition.
  </div>
)}
```

**Note:** `downloadPresentation` is a function already defined inside `ScoreDrawer` — verify it exists by searching the file for `function downloadPresentation` or `const downloadPresentation`. If it doesn't exist in scope, check if it's passed as a prop or defined at module level.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add "packages/web/app/competitions/[id]/page.tsx"
git commit -m "feat(ui): presentations tab — parallel team columns with expandable findings"
```

---

## Task 4: Files tab — parallel columns + resizable preview panel

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx` — both FILES TAB blocks (~lines 1301–1496)

The Files tab has two code paths: deliverables (primary) and event-file fallback. Both get the parallel column layout. The primary path also gets the resizable preview panel at the bottom.

**Important:** The Files tab content area needs to be `display: flex; flex-direction: column; height: 100%` so the preview panel sits at the bottom. The tab content container (changed to `padding: 0` in Task 1) must allow this.

- [ ] **Step 1: Replace BOTH Files tab blocks**

Delete lines ~1301–1496 (both `{activeTab === 'files' && hasFiles && ...}` and `{activeTab === 'files' && !hasFiles && ...}`) and replace with a single unified block:

```tsx
{/* FILES TAB */}
{activeTab === 'files' && (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

    {/* ── Primary: deliverable files ── */}
    {hasFiles && (
      <>
        {/* Column grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${result.deliverables!.length}, 1fr)`,
          flex: 1, minHeight: 0, overflow: 'hidden',
        }}>
          {result.deliverables!.map((td, tdIdx) => {
            const label = resolveLabel(teams, td.teamId, td.teamId);
            const color = LANE_COLORS[tdIdx] ?? '#4a8fa8';
            const rgb = hexToRgb(color);
            return (
              <div
                key={td.teamId}
                className="arena-scrollbar"
                style={{
                  borderRight: tdIdx < result.deliverables!.length - 1 ? '1px solid #0a2235' : 'none',
                  overflowY: 'auto', display: 'flex', flexDirection: 'column',
                }}
              >
                {/* Sticky column header */}
                <div style={{
                  position: 'sticky', top: 0, zIndex: 2,
                  background: `rgba(${rgb},0.08)`,
                  borderBottom: `1px solid rgba(${rgb},0.2)`,
                  padding: '0.55rem 0.85rem',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  flexShrink: 0,
                }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color, letterSpacing: '1px', textTransform: 'uppercase', flex: 1 }}>
                    {label}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: '#1e4a5a' }}>{td.files.length} files</span>
                  <a
                    href={`/api/competitions/${competitionId}/deliverables/${td.teamId}/download`}
                    download
                    style={{
                      fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.5rem',
                      borderRadius: '4px', background: 'rgba(0,240,255,0.08)',
                      border: '1px solid rgba(0,240,255,0.3)', color: '#00f0ff',
                      textDecoration: 'none', letterSpacing: '0.5px',
                    }}
                  >
                    📦 ZIP
                  </a>
                </div>

                {td.files.length === 0 && (
                  <div style={{ padding: '0.75rem 0.85rem', fontSize: '0.72rem', color: '#1e4a5a', fontStyle: 'italic' }}>
                    No files submitted
                  </div>
                )}

                {td.files.map((file) => {
                  const key = `${td.teamId}:${file.path}`;
                  const isSelected = selectedFileKey?.teamId === td.teamId && selectedFileKey?.path === file.path;
                  return (
                    <div
                      key={file.path}
                      onClick={() => setSelectedFileKey(isSelected ? null : { teamId: td.teamId, path: file.path })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.4rem 0.85rem',
                        borderBottom: '1px solid rgba(10,34,53,0.4)',
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(0,240,255,0.07)' : 'transparent',
                        borderLeft: isSelected ? `2px solid #00f0ff` : '2px solid transparent',
                      }}
                    >
                      <span style={{ fontSize: '0.7rem', flexShrink: 0 }}>📄</span>
                      <span style={{ fontSize: '0.72rem', color: isSelected ? '#e4f8ff' : '#7cc6db', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {file.path}
                      </span>
                      <span style={{ fontSize: '0.6rem', color: '#1e4a5a', flexShrink: 0 }}>
                        {(file.content.length / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* File preview panel — only shown when a file is selected */}
        {selectedFileKey && (() => {
          const teamDel = result.deliverables!.find(td => td.teamId === selectedFileKey.teamId);
          const file = teamDel?.files.find(f => f.path === selectedFileKey.path);
          if (!file) return null;
          const teamIdx = result.deliverables!.findIndex(td => td.teamId === selectedFileKey.teamId);
          const color = LANE_COLORS[teamIdx] ?? '#4a8fa8';
          const rgb = hexToRgb(color);
          const label = resolveLabel(teams, selectedFileKey.teamId, selectedFileKey.teamId);
          return (
            <>
              {/* Resize handle */}
              <div
                style={{
                  flexShrink: 0, height: '5px', background: '#0a2235',
                  cursor: 'ns-resize', position: 'relative', transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,240,255,0.5)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#0a2235'; }}
                onMouseDown={(e) => {
                  isDraggingFilePreview.current = true;
                  dragFilePreviewStartY.current = e.clientY;
                  dragFilePreviewStartH.current = filePreviewHeight;
                  e.preventDefault();
                }}
              >
                <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '40px', height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.12)' }} />
              </div>

              {/* Preview panel */}
              <div style={{
                flexShrink: 0, height: `${filePreviewHeight}px`,
                borderTop: '2px solid rgba(0,240,255,0.3)',
                background: '#020b14', display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}>
                {/* Preview header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem',
                  padding: '0.4rem 0.85rem', borderBottom: '1px solid #0a2235',
                  background: '#010810', flexShrink: 0,
                }}>
                  <span style={{ fontSize: '0.7rem' }}>📄</span>
                  <span style={{ fontSize: '0.72rem', color: '#00f0ff', fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.path}
                  </span>
                  <span style={{ fontSize: '0.65rem', fontWeight: 800, padding: '0.15rem 0.45rem', borderRadius: '3px', background: `rgba(${rgb},0.12)`, color, flexShrink: 0 }}>
                    {label}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: '#3d7d94', flexShrink: 0 }}>
                    {(file.content.length / 1024).toFixed(1)} KB
                  </span>
                  <a
                    href={`/api/competitions/${competitionId}/deliverables/${selectedFileKey.teamId}/download`}
                    download
                    style={{ fontSize: '0.6rem', padding: '0.15rem 0.45rem', borderRadius: '3px', background: 'transparent', border: '1px solid #0a2235', color: '#4a8fa8', textDecoration: 'none' }}
                  >
                    ↓
                  </a>
                  <button
                    onClick={() => setFileModalContent({ path: file.path, content: file.content })}
                    style={{ fontSize: '0.6rem', padding: '0.15rem 0.45rem', borderRadius: '3px', background: 'transparent', border: '1px solid #0a2235', color: '#4a8fa8', cursor: 'pointer', fontFamily: 'monospace' }}
                  >
                    ⤢ Full
                  </button>
                </div>

                {/* Scrollable file content */}
                <div
                  className="arena-scrollbar"
                  style={{
                    flex: 1, overflowY: 'auto', padding: '0.65rem 1rem',
                    fontFamily: "'SF Mono', 'Fira Code', monospace",
                    fontSize: '0.7rem', color: '#7cc6db', lineHeight: 1.6,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}
                >
                  {file.content}
                </div>
              </div>
            </>
          );
        })()}
      </>
    )}

    {/* ── Fallback: event-captured files ── */}
    {!hasFiles && (
      <>
        {!fileEventsByTeam || fileEventsByTeam.every((t) => t.files.length === 0) ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#1e4a5a', fontSize: '0.78rem', fontStyle: 'italic' }}>
            No files recorded for this competition.
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(fileEventsByTeam.length, 3)}, 1fr)`,
            flex: 1, minHeight: 0, overflow: 'hidden',
          }}>
            {fileEventsByTeam.map((teamFiles, tdIdx) => {
              const label = resolveLabel(teams, teamFiles.teamId, teamFiles.teamId);
              const color = LANE_COLORS[tdIdx] ?? '#4a8fa8';
              const rgb = hexToRgb(color);
              return (
                <div key={teamFiles.teamId} className="arena-scrollbar" style={{ borderRight: tdIdx < fileEventsByTeam.length - 1 ? '1px solid #0a2235' : 'none', overflowY: 'auto' }}>
                  <div style={{ position: 'sticky', top: 0, zIndex: 2, background: `rgba(${rgb},0.08)`, borderBottom: `1px solid rgba(${rgb},0.2)`, padding: '0.55rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 800, color, letterSpacing: '1px', textTransform: 'uppercase', flex: 1 }}>{label}</span>
                    <span style={{ fontSize: '0.6rem', color: '#1e4a5a' }}>{teamFiles.files.length} files</span>
                  </div>
                  {teamFiles.files.length === 0 ? (
                    <div style={{ padding: '0.75rem', fontSize: '0.72rem', color: '#1e4a5a', fontStyle: 'italic' }}>No files recorded</div>
                  ) : (
                    teamFiles.files.map((f, fIdx) => (
                      <div key={fIdx} style={{ borderBottom: fIdx < teamFiles.files.length - 1 ? '1px solid #0a2235' : 'none' }}>
                        <div style={{ padding: '0.3rem 0.85rem', background: '#000408', fontSize: '0.68rem', color: '#4a8fa8', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ color: '#00f0ff' }}>📄</span>
                          <span>{f.path}</span>
                        </div>
                        <pre style={{ fontSize: '0.72rem', color: f.content ? '#d8f0fa' : '#1e4a5a', whiteSpace: 'pre-wrap', fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1.6, margin: 0, padding: '0.65rem 1rem', background: '#010810', overflowX: 'auto', fontStyle: f.content ? 'normal' : 'italic' }}>
                          {f.content ? (f.content.length > 3000 ? `${f.content.slice(0, 3000)}\n\n… (truncated)` : f.content) : '(no content captured)'}
                        </pre>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        )}
      </>
    )}
  </div>
)}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

- [ ] **Step 3: Visual check**

Open a competition with deliverables. Files tab should show team columns side-by-side. Click a file — preview panel appears at the bottom. Drag the handle to resize it. Click ⤢ Full — existing modal opens. Switching to another file updates the preview.

- [ ] **Step 4: Commit**

```bash
git add "packages/web/app/competitions/[id]/page.tsx"
git commit -m "feat(ui): files tab — parallel columns with resizable preview panel"
```

---

## Task 5: Synthesis tab — 2-column split

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx` — SYNTHESIS TAB block (~lines 1498–1636)

Split into left panel (criterion verdicts table, same click-to-expand pattern as Scores) and right panel (full synthesis document, always visible).

- [ ] **Step 1: Replace the SYNTHESIS TAB block**

Delete lines ~1498–1636 and replace with:

```tsx
{/* SYNTHESIS TAB */}
{activeTab === 'synthesis' && (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    {result.synthesis ? (
      <div style={{ display: 'grid', gridTemplateColumns: '42% 1fr', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Left: criterion verdicts table */}
        <div className="arena-scrollbar" style={{ borderRight: '1px solid #0a2235', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Thesis callout */}
          {result.synthesis.overallRationale && (
            <div style={{ padding: '0.85rem 1rem', background: 'rgba(0,240,255,0.04)', borderBottom: '1px solid rgba(0,240,255,0.15)', flexShrink: 0 }}>
              <div style={{ fontSize: '0.58rem', fontWeight: 800, color: '#00f0ff', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Synthesis Thesis</div>
              <div style={{ fontSize: '0.72rem', color: '#c8eef8', lineHeight: 1.6 }}>{result.synthesis.overallRationale}</div>
            </div>
          )}

          {/* Column header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 40px', padding: '0.4rem 1rem', background: '#020b14', borderBottom: '1px solid #0a2235', position: 'sticky', top: 0, zIndex: 2, flexShrink: 0 }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px' }}>CRITERION</div>
            <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px', textAlign: 'center' }}>WINNER</div>
            <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px', textAlign: 'center' }}>WT</div>
          </div>

          {/* Criterion rows */}
          {(result.synthesis.perCriterion ?? []).map((entry, i) => {
            const winnerTeam = teams.find(t => t.id === entry.teamId);
            const teamColor = winnerTeam ? getModelColor(winnerTeam.model) : '#4a8fa8';
            const wLabel = resolveLabel(teams, entry.teamId, entry.teamId);
            const isOpen = selectedSynthCriterionId === entry.criterionId;
            // Find weight from brief rubric if available
            const brief = (comp as unknown as { brief?: { rubric?: { criteria?: Array<{ id: string; weight: number }> } } })?.brief;
            const criterionWeight = brief?.rubric?.criteria?.find((c) => c.id === entry.criterionId)?.weight;

            return (
              <div key={entry.criterionId}>
                <div
                  onClick={() => setSelectedSynthCriterionId(isOpen ? null : entry.criterionId)}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 100px 40px',
                    padding: '0.5rem 1rem',
                    borderBottom: '1px solid rgba(10,34,53,0.5)',
                    cursor: 'pointer',
                    background: isOpen ? 'rgba(0,240,255,0.05)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span style={{ fontSize: '0.58rem', color: isOpen ? '#00f0ff' : '#3d7d94' }}>{isOpen ? '▼' : '▶'}</span>
                    <span style={{ fontSize: '0.7rem', color: isOpen ? '#7cc6db' : '#4a8fa8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.criterionId}
                    </span>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{
                      fontSize: '0.62rem', fontWeight: 800, padding: '0.12rem 0.4rem', borderRadius: '3px',
                      color: teamColor, background: `rgba(${hexToRgb(teamColor)},0.12)`,
                    }}>
                      {wLabel.split(':')[0].toUpperCase()}
                    </span>
                  </div>
                  <div style={{ textAlign: 'center', fontSize: '0.6rem', color: '#1e4a5a' }}>
                    {criterionWeight != null ? `${Math.round(criterionWeight * 100)}%` : '—'}
                  </div>
                </div>
                {isOpen && (
                  <div style={{ padding: '0.6rem 1rem', background: '#020b14', borderBottom: '1px solid #0a2235' }}>
                    {entry.winningApproach && (
                      <div style={{ fontSize: '0.7rem', color: '#7cc6db', lineHeight: 1.5, marginBottom: '0.35rem' }}>
                        <span style={{ color: '#00f0ff', fontWeight: 700 }}>Selected: </span>{entry.winningApproach}
                      </div>
                    )}
                    {entry.losingApproach && (
                      <div style={{ fontSize: '0.68rem', color: '#4a8fa8', lineHeight: 1.5, marginBottom: '0.3rem' }}>
                        <span style={{ color: '#1e4a5a', fontWeight: 700 }}>Alternative: </span>{entry.losingApproach}
                      </div>
                    )}
                    {entry.rationale && (
                      <div style={{ fontSize: '0.68rem', color: '#4a8fa8', fontStyle: 'italic', lineHeight: 1.5 }}>
                        {entry.rationale}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right: full synthesis document */}
        <div className="arena-scrollbar" style={{ overflowY: 'auto', padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexShrink: 0 }}>
            <div style={{ fontSize: '0.58rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px', textTransform: 'uppercase' }}>Full Hybrid Solution</div>
            <button
              onClick={() => navigator.clipboard.writeText(result.synthesis?.synthesis ?? '').catch(() => {})}
              style={{ fontSize: '0.6rem', color: '#4a6080', background: 'none', border: '1px solid #0a2235', borderRadius: '4px', padding: '0.15rem 0.5rem', cursor: 'pointer', fontFamily: 'monospace' }}
            >
              📋 copy
            </button>
          </div>
          <div style={{ fontFamily: "-apple-system, 'Segoe UI', sans-serif", fontSize: '0.78rem', lineHeight: 1.7, color: '#d8f0fa' }}>
            {renderedSynthesis}
          </div>
        </div>
      </div>
    ) : (
      /* No synthesis yet — centered CTA */
      <div style={{ textAlign: 'center', padding: '4rem 2rem', background: '#050f1e', border: '1px solid #0a2235', borderRadius: '8px', margin: '1rem' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔮</div>
        <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#e4f8ff', marginBottom: '0.5rem' }}>Synthesize a Hybrid Solution</div>
        <div style={{ fontSize: '0.75rem', color: '#7cc6db', maxWidth: '400px', margin: '0 auto 1.5rem', lineHeight: 1.7 }}>
          Ask AI to merge the best elements from all teams into a single unified deliverable, with per-criterion attribution showing what came from whom.
        </div>
        {synthError && <div style={{ fontSize: '0.68rem', color: '#ef4444', marginBottom: '1rem' }}>{synthError}</div>}
        <button
          onClick={runSynthesis}
          disabled={synthRunning}
          style={{ fontSize: '0.72rem', fontWeight: 800, padding: '0.6rem 1.5rem', borderRadius: '6px', background: 'rgba(0,240,255,0.12)', border: '1px solid rgba(0,240,255,0.4)', color: '#00f0ff', cursor: synthRunning ? 'not-allowed' : 'pointer', fontFamily: 'monospace', letterSpacing: '1.5px', textTransform: 'uppercase', opacity: synthRunning ? 0.6 : 1 }}
        >
          {synthRunning ? '🔮 Running…' : '🔮 Run Synthesis'}
        </button>
      </div>
    )}
  </div>
)}
```

**Note:** The `comp` prop only has `{ state: string }`. The weight lookup via `comp?.brief?.rubric` won't work — remove it and just show `—` for weight, or pass the brief down. Simplest: just omit weight display (show `—`). Remove the `brief` variable and `criterionWeight` lookup entirely, always render `—`.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add "packages/web/app/competitions/[id]/page.tsx"
git commit -m "feat(ui): synthesis tab — 2-col split with verdicts table and full document"
```

---

## Task 6: Forge tab — sidebar navigator + artifact grid

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx` — FORGE TAB block (~lines 1638–1773)

Replace the stacked vertical list with a 2-column layout: left sidebar lists all runs with source picker, right shows the active run's artifacts in a 3-column card grid.

- [ ] **Step 1: Check existing forge state variables**

Search the file for `forgeSource`, `forgeRunning`, `forgeError`, `forgeRuns`, `activeForgeRunId`, `triggerForge`, `winnerTeam`, `loserTeam`. These are used in the current FORGE TAB block. They may be defined in the outer `CompetitionPage` component (not in `ScoreDrawer`). Confirm their scope before writing the replacement.

If `activeForgeRunId` / `setActiveForgeRunId` are defined in `CompetitionPage` scope, remove the duplicate declaration added in Task 1. If they are not yet defined anywhere (i.e., the current forge tab uses a different variable name), adapt accordingly.

- [ ] **Step 2: Replace the FORGE TAB block**

Delete lines ~1638–1773 and replace with:

```tsx
{/* FORGE TAB */}
{activeTab === 'forge' && (
  <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', height: '100%', overflow: 'hidden' }}>

    {/* Left: run navigator + source picker */}
    <div className="arena-scrollbar" style={{ borderRight: '1px solid #0a2235', overflowY: 'auto', background: '#020b14', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '0.5rem 0.85rem', fontSize: '0.58rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid #0a2235', flexShrink: 0 }}>
        Forge Runs
      </div>

      {/* Run list — newest first */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {forgeRuns.length === 0 && (
          <div style={{ padding: '1rem 0.85rem', fontSize: '0.7rem', color: '#1e4a5a', fontStyle: 'italic' }}>
            No runs yet
          </div>
        )}
        {[...forgeRuns].reverse().map((run, idx) => {
          const runNum = forgeRuns.length - idx;
          const sourceLabel = run.source === 'winner' ? '🏆 Winner' : run.source === 'loser' ? '📋 Loser' : '🔮 Synthesis';
          const isActive = activeForgeRunId === run.id;
          return (
            <div
              key={run.id}
              onClick={() => setActiveForgeRunId(run.id)}
              style={{
                padding: '0.6rem 0.85rem',
                borderBottom: '1px solid rgba(10,34,53,0.4)',
                cursor: 'pointer',
                background: isActive ? 'rgba(0,240,255,0.07)' : 'transparent',
                borderLeft: isActive ? '2px solid #00f0ff' : '2px solid transparent',
              }}
            >
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: isActive ? '#c8eef8' : '#7cc6db', marginBottom: '0.15rem' }}>
                {sourceLabel} — #{runNum}
              </div>
              <div style={{ fontSize: '0.6rem', color: '#3d7d94' }}>
                {run.forgeModel?.split('-').slice(0,3).join('-') ?? 'claude'} · {run.artifacts.length} artifacts
              </div>
            </div>
          );
        })}
      </div>

      {/* Source picker + trigger */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #0a2235', padding: '0.75rem 0.85rem', background: '#010810' }}>
        <div style={{ fontSize: '0.55rem', color: '#3d7d94', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '0.5rem' }}>New Run</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.6rem' }}>
          {([
            { value: 'winner' as ForgeSource, label: `🏆 Winner`, disabled: false },
            { value: 'loser' as ForgeSource, label: `📋 Loser`, disabled: false },
            { value: 'synthesis' as ForgeSource, label: '🔮 Synthesis', disabled: !result.synthesis },
          ] as const).map(({ value, label, disabled }) => (
            <button
              key={value}
              disabled={disabled}
              onClick={() => setForgeSource(value)}
              style={{
                padding: '0.35rem 0.65rem', borderRadius: '4px', textAlign: 'left',
                border: `1px solid ${forgeSource === value ? (value === 'winner' ? 'rgba(255,102,0,0.5)' : '#00f0ff') : '#0a2235'}`,
                background: forgeSource === value ? (value === 'winner' ? 'rgba(255,102,0,0.1)' : 'rgba(0,240,255,0.08)') : 'transparent',
                color: disabled ? '#1e4a5a' : forgeSource === value ? (value === 'winner' ? '#ff6600' : '#00f0ff') : '#7cc6db',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 700,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {forgeError && <div style={{ fontSize: '0.6rem', color: '#ef4444', marginBottom: '0.4rem' }}>{forgeError}</div>}
        <button
          onClick={triggerForge}
          disabled={forgeRunning || comp?.state === 'FORGING'}
          style={{
            width: '100%', padding: '0.45rem', borderRadius: '5px',
            background: 'rgba(0,240,255,0.12)', border: '1px solid rgba(0,240,255,0.4)',
            color: '#00f0ff', cursor: forgeRunning ? 'not-allowed' : 'pointer',
            fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 800,
            letterSpacing: '1px', textTransform: 'uppercase',
            opacity: forgeRunning ? 0.6 : 1,
          }}
        >
          {forgeRunning || comp?.state === 'FORGING' ? '⚒ Forging…' : '⚒ Forge'}
        </button>
      </div>
    </div>

    {/* Right: artifact grid for active run */}
    <div className="arena-scrollbar" style={{ overflowY: 'auto', padding: '0.85rem 1rem' }}>
      {(() => {
        const activeRun = forgeRuns.find(r => r.id === activeForgeRunId);
        if (!activeRun) return (
          <div style={{ color: '#1e4a5a', fontSize: '0.78rem', fontStyle: 'italic', textAlign: 'center', paddingTop: '2rem' }}>
            Select a run from the sidebar, or forge a new one.
          </div>
        );

        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.85rem', flexShrink: 0 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#c8eef8' }}>
                {activeRun.source === 'winner' ? '🏆 Winner' : activeRun.source === 'loser' ? '📋 Loser' : '🔮 Synthesis'} — Run #{forgeRuns.indexOf(activeRun) + 1}
              </div>
              <a
                href={`/api/competitions/${competitionId}/forge/${activeRun.id}/download`}
                download
                style={{ fontSize: '0.6rem', padding: '0.2rem 0.55rem', borderRadius: '4px', background: 'transparent', border: '1px solid #0a2235', color: '#7cc6db', textDecoration: 'none', fontFamily: 'monospace', fontWeight: 700 }}
              >
                ↓ ZIP
              </a>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '0.65rem',
            }}>
              {activeRun.artifacts.map((artifact) => (
                <div
                  key={artifact.type}
                  onClick={() => setFileModalContent({ path: artifact.title, content: artifact.content })}
                  style={{
                    background: '#050f1e', border: '1px solid #0a2235', borderRadius: '6px',
                    padding: '0.75rem 0.85rem', cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(0,240,255,0.25)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#0a2235'; }}
                >
                  <div style={{ fontSize: '1.1rem', marginBottom: '0.35rem' }}>
                    {ARTIFACT_EMOJI[artifact.type] ?? '📄'}
                  </div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 800, color: artifact.universal ? '#00d4ff' : '#7cc6db', marginBottom: '0.3rem', letterSpacing: '0.3px' }}>
                    {artifact.title}
                  </div>
                  <div style={{
                    fontSize: '0.65rem', color: '#3d7d94', lineHeight: 1.5,
                    overflow: 'hidden', display: '-webkit-box',
                    WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                  }}>
                    {artifact.content.slice(0, 200)}
                  </div>
                </div>
              ))}
            </div>
          </>
        );
      })()}
    </div>
  </div>
)}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add "packages/web/app/competitions/[id]/page.tsx"
git commit -m "feat(ui): forge tab — sidebar run navigator + artifact grid"
```

---

## Task 7: Final typecheck, push, and cleanup

- [ ] **Step 1: Full typecheck**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
npx tsc --noEmit -p packages/web/tsconfig.json
npm run test --workspace=packages/orchestrator
```
Expected: zero TS errors, all 159 orchestrator tests pass (no UI tests to run).

- [ ] **Step 2: Visual smoke test**

Load the app (`cd packages/web && npm run dev`). Open a completed 3-team competition. Verify:
1. **Scores**: table with criterion rows, teams as columns, click to expand commentary ✓
2. **Presentations**: 3 columns side-by-side, click findings to expand ✓
3. **Files**: 3 columns, click file → preview panel appears, drag handle resizes it, ⤢ opens modal ✓
4. **Synthesis**: left verdicts table (click to expand), right full document scrollable ✓
5. **Forge**: left run sidebar, right 3-col artifact grid, click artifact → modal ✓
6. **Maximize button (⤢)**: hitting it still works — lanes collapse, results panel fills viewport ✓

- [ ] **Step 3: Push**

```bash
git push
```

- [ ] **Step 4: Stop brainstorm server**

```bash
/Users/kstefano/.claude/plugins/cache/superpowers-marketplace/superpowers/5.0.0/lib/brainstorm-server/stop-server.sh "/Users/kstefano/Personal Projects/agentarena/.superpowers/brainstorm/36463-1773219646"
```
