> **Historical design document, March 2026.** Model ids, APIs and file paths referenced below are as of that date and are **not current**. It is kept as a record of what was decided then, not as guidance. See `README.md` for current models and `CLAUDE.md` for current usage.

# Post-Judging Redesign Implementation Plan

> **Status: COMPLETE**

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all post-judging actions (presentations download/modal, files ZIP+preview, synthesis, forge) user-triggered and independent, plus improve global readability.

**Architecture:** Remove synthesis from the automatic run loop (competition ends at COMPLETE after scoring); expose on-demand `POST /synthesis` and updated `POST /forge` routes; change forge storage from a single object to an append-only array of runs; update the UI to match in the competition detail page and shared EventRow.

**Tech Stack:** TypeScript, Next.js 14 App Router, Express, Drizzle ORM + PostgreSQL, `archiver` (Node.js ZIP streaming), `@anthropic-ai/sdk` (synthesis/forge), Vitest

---

## File Map

| File | Role |
|------|------|
| `packages/shared/src/types/forge.ts` | Add `ForgeRun` type; keep `ForgeOutput` for backward compat |
| `packages/shared/src/types/index.ts` | Re-export `ForgeRun` and `ForgeSource` |
| `packages/orchestrator/src/db/repository.ts` | `saveForgeRun` (append), `getForgeRuns`, backward-compat `getResult` migration, `saveSynthesis` |
| `packages/orchestrator/src/engine/competition-runner.ts` | Remove SYNTHESIZING phase from auto-flow |
| `packages/orchestrator/src/engine/state-machine.ts` | Verify SYNTHESIZING state is optional (no required transition) |
| `packages/orchestrator/src/server/routes/competitions.ts` | Add `POST /:id/synthesis`; update forge route for source param + no-dedup guard; add `GET /:id/deliverables/:teamId/download` |
| `packages/orchestrator/src/forge/forge-orchestrator.ts` | Accept `source` + resolved context instead of always using winner |
| `packages/web/app/competitions/[id]/page.tsx` | Presentations modal+download; Files inline-preview+ZIP; Synthesis idle state+trigger; Forge source-picker+stacked-runs |
| `packages/web/lib/design-tokens.ts` | Update TEXT_PRIMARY/MUTED/DIM colors (+35% brightness) |
| `packages/web/app/globals.css` | Add `html { font-size: 120% }` |
| `packages/web/lib/EventRow.tsx` | Update hardcoded muted/dim color values |

---

## Chunk 1: Types, DB, and State Machine

### Task 1: Add `ForgeRun` type to shared package

**Files:**
- Modify: `packages/shared/src/types/forge.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Read the files**

  ```bash
  # Read both files before editing
  ```
  Read `packages/shared/src/types/forge.ts` and `packages/shared/src/index.ts`.

- [ ] **Step 2: Add `ForgeRun` to forge.ts**

  Append to `packages/shared/src/types/forge.ts`:
  ```typescript
  /** Source for a forge run — which team's work (or the synthesis) to base artifacts on. */
  export type ForgeSource = 'winner' | 'loser' | 'synthesis';

  /**
   * A single forge run. Multiple runs can exist per competition (stacked).
   * Replaces the single ForgeOutput stored in results.forge.
   */
  export interface ForgeRun {
    id: string;                        // uuid generated at run time
    source: ForgeSource;
    sourceTeamId?: string;             // set when source is 'winner' or 'loser'
    forgeModel: string;
    artifacts: ForgeArtifact[];
    generatedAt: string;               // ISO 8601
    domain?: ForgeDomain;
    selectedTypes?: ForgeArtifactType[];
  }
  ```

- [ ] **Step 3: Re-export ForgeRun from types index**

  The forge re-exports live in `packages/shared/src/types/index.ts` (NOT the root `packages/shared/src/index.ts`). Read that file first, then update the forge export line on line 6 to include `ForgeRun` and `ForgeSource`:
  ```typescript
  export type { ForgeArtifact, ForgeArtifactType, ForgeDomain, ForgeOutput, ForgeRun, ForgeSource } from './forge.js';
  ```

- [ ] **Step 4: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  npm run typecheck --workspace=packages/orchestrator
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/shared/src/types/forge.ts packages/shared/src/types/index.ts
  git commit -m "feat(shared): add ForgeRun and ForgeSource types"
  ```

---

### Task 2: Update repository — forge append + synthesis save

**Files:**
- Modify: `packages/orchestrator/src/db/repository.ts`

- [ ] **Step 1: Read the file**

  Read `packages/orchestrator/src/db/repository.ts` in full to understand existing patterns.

- [ ] **Step 2: Update `StoredResult` type and imports**

  In `repository.ts`, change the import and type:
  ```typescript
  // Old import
  import type { ArenaEvent, Brief, Team, TeamPresentation, ForgeOutput } from '@arena/shared';
  // New import — add ForgeRun
  import type { ArenaEvent, Brief, Team, TeamPresentation, ForgeOutput, ForgeRun } from '@arena/shared';
  ```

  Update `StoredResult`:
  ```typescript
  export interface StoredResult {
    scorecards: unknown[];
    winner: string | null;
    summary?: string;
    synthesis?: SynthesisResult | null;
    presentations?: TeamPresentation[];
    forge?: ForgeRun[] | null;       // changed from ForgeOutput | null
    deliverables?: TeamDeliverable[];
  }
  ```

- [ ] **Step 3: Add `saveSynthesis` method**

  After the existing `saveForge` method, add:
  ```typescript
  async saveSynthesis(competitionId: string, synthesis: SynthesisResult): Promise<void> {
    await this.db.update(results)
      .set({ synthesis: JSON.stringify(synthesis) })
      .where(eq(results.competitionId, competitionId));
  }
  ```

- [ ] **Step 4: Add `appendForgeRun` method**

  Replace `saveForge` (keep old method for backward compat on existing records) and add:
  ```typescript
  /** Append a new forge run to the runs array. */
  async appendForgeRun(competitionId: string, run: ForgeRun): Promise<void> {
    const existing = await this.getResult(competitionId);
    const currentRuns = (existing?.forge as ForgeRun[] | null) ?? [];
    // Backward compat: if existing forge is a plain ForgeOutput (not array), wrap it
    const normalizedRuns = Array.isArray(currentRuns)
      ? currentRuns
      : [{ ...(currentRuns as ForgeOutput), id: 'legacy', source: 'winner' as const }];
    await this.db.update(results)
      .set({ forge: [...normalizedRuns, run] })
      .where(eq(results.competitionId, competitionId));
  }
  ```

- [ ] **Step 5: Update `getResult` to normalize legacy forge records**

  In the existing `getResult` method, after the synthesis deserialization, add forge normalization:
  ```typescript
  // Normalize forge: old records stored a single ForgeOutput object, new ones are ForgeRun[]
  let parsedForge: ForgeRun[] | null = null;
  if (row.forge) {
    const raw = row.forge as unknown;
    if (Array.isArray(raw)) {
      parsedForge = raw as ForgeRun[];
    } else if (raw && typeof raw === 'object') {
      // Legacy single ForgeOutput — wrap in array
      parsedForge = [{ ...(raw as ForgeOutput), id: 'legacy', source: 'winner' as const }];
    }
  }
  return { ...row, synthesis: parsedSynthesis, forge: parsedForge };
  ```

- [ ] **Step 6: Typecheck**

  ```bash
  npm run typecheck --workspace=packages/orchestrator
  ```
  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add packages/orchestrator/src/db/repository.ts
  git commit -m "feat(db): appendForgeRun, saveSynthesis, backward-compat forge normalization"
  ```

---

### Task 3: Remove auto-synthesis from competition runner

**Files:**
- Modify: `packages/orchestrator/src/engine/competition-runner.ts`
- Modify: `packages/orchestrator/src/engine/competition-runner.test.ts` (update any test that expects SYNTHESIZING state)

- [ ] **Step 1: Read competition-runner.ts lines 340–400**

  Look at the SYNTHESIZING block (around line 353–364).

- [ ] **Step 2: Remove SYNTHESIZING phase**

  Delete these lines from `competition-runner.ts`:
  ```typescript
  // ── SYNTHESIZING ─────────────────────────────────────────────────────
  this.advance(CompetitionState.SYNTHESIZING);
  let synthesis: SynthesisResult | null = null;
  if (!this.options.skipSynthesis) {
    console.log('[arena] synthesizing deliverables...');
    synthesis = await synthesizeDeliverables(brief, deliverables, {
      claudeBin: this.options.claudeBin,
    }, presentations);
  }
  ```

  Replace with:
  ```typescript
  const synthesis: SynthesisResult | null = null; // synthesis is now on-demand via POST /synthesis
  ```

- [ ] **Step 3: Remove `skipSynthesis` option**

  In the `RunOptions` interface (around line 55–56), remove:
  ```typescript
  /** Skip synthesis phase (useful in tests or when Claude is unavailable). */
  skipSynthesis?: boolean;
  ```

  And remove the reference at line ~115: `skipSynthesis: options.skipSynthesis ?? false,`

- [ ] **Step 4: Remove unused import**

  Remove the import of `synthesizeDeliverables` from `competition-runner.ts` (it will be used by the route instead).

- [ ] **Step 5: Run tests**

  ```bash
  npm run test --workspace=packages/orchestrator 2>&1 | tail -20
  ```

  Fix any test failures caused by:
  - Tests checking for SYNTHESIZING state transition — remove those assertions or update to expect COMPLETE directly after SCORED
  - Tests passing `skipSynthesis: true` — remove that option from test calls

- [ ] **Step 6: Typecheck**

  ```bash
  npm run typecheck --workspace=packages/orchestrator
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add packages/orchestrator/src/engine/competition-runner.ts \
          packages/orchestrator/src/engine/competition-runner.test.ts
  git commit -m "feat(runner): remove auto-synthesis — synthesis is now on-demand"
  ```

---

## Chunk 2: Backend Routes

### Task 4: POST /competitions/:id/synthesis route

**Files:**
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`

- [ ] **Step 1: Read the competitions route file**

  Read `packages/orchestrator/src/server/routes/competitions.ts` in full to understand the import list and the forge route pattern (the new synthesis route mirrors it).

- [ ] **Step 2: Add synthesis route**

  After the existing forge routes, add:
  ```typescript
  // In-memory guard to prevent concurrent synthesis runs
  const synthesisInProgress = new Set<string>();

  // POST /competitions/:id/synthesis — trigger on-demand synthesis
  competitionsRouter.post('/:id/synthesis', requireApiKey, async (req: Request, res: Response) => {
    const id = String(req.params.id);

    if (synthesisInProgress.has(id)) {
      res.status(409).json({ error: 'Synthesis is already in progress' });
      return;
    }

    const [comp, result] = await Promise.all([repo.getCompetition(id), repo.getResult(id)]);
    if (!comp) { res.status(404).json({ error: 'Competition not found' }); return; }
    if (!result) { res.status(409).json({ error: 'No results found' }); return; }

    const allowedStates = [
      CompetitionState.COMPLETE,
      CompetitionState.FORGE_COMPLETE,
      CompetitionState.FORGING,
    ];
    if (!allowedStates.includes(comp.state as CompetitionState)) {
      res.status(409).json({ error: `Cannot synthesize in ${comp.state} state` });
      return;
    }

    synthesisInProgress.add(id);

    const deliverables = (result.deliverables as TeamDeliverable[]) ?? [];
    const presentations = (result.presentations as TeamPresentation[]) ?? [];
    const brief = comp.brief as Brief;

    synthesizeDeliverables(brief, deliverables, { claudeBin: process.env.CLAUDE_BIN }, presentations)
      .then(async (synthesis) => {
        await repo.saveSynthesis(id, synthesis);
        console.log(`[arena] synthesis complete for ${id}`);
      })
      .catch((err: Error) => {
        console.error(`[arena] synthesis failed for ${id}:`, err.message);
      })
      .finally(() => synthesisInProgress.delete(id));

    res.status(202).json({ ok: true, message: 'Synthesis started' });
  });

  // GET /competitions/:id/synthesis — get synthesis result
  competitionsRouter.get('/:id/synthesis', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const result = await repo.getResult(id);
    if (!result) { res.status(404).json({ error: 'Competition not found' }); return; }
    const inProgress = synthesisInProgress.has(id);
    res.json({
      status: inProgress ? 'running' : result.synthesis ? 'complete' : 'idle',
      synthesis: result.synthesis ?? null,
    });
  });
  ```

  Add `synthesizeDeliverables` to the imports at the top of the file:
  ```typescript
  import { synthesizeDeliverables } from '../../synthesis/merge-engine.js';
  ```

  Add `TeamDeliverable` and `Brief` to the existing type imports at the top of the file — these are required and must be present.

- [ ] **Step 3: Typecheck**

  ```bash
  npm run typecheck --workspace=packages/orchestrator
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add packages/orchestrator/src/server/routes/competitions.ts
  git commit -m "feat(routes): POST /synthesis on-demand route"
  ```

---

### Task 5: Update forge route — source param + stacked runs

**Files:**
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`

- [ ] **Step 1: Read forge-orchestrator.ts**

  Read `packages/orchestrator/src/forge/forge-orchestrator.ts` to understand `ForgeInput` and `runForge`.

- [ ] **Step 2: Add `source` to ForgeInput**

  In `forge-orchestrator.ts`, find the `ForgeInput` interface and add:
  ```typescript
  source: ForgeSource;          // 'winner' | 'loser' | 'synthesis'
  sourceTeamId?: string;        // which team's deliverables to use
  ```

  Import `ForgeSource` and `ForgeRun` from `@arena/shared`.

- [ ] **Step 3: Use source to select context in forge-orchestrator**

  In `runForge`, change the context-building logic. Currently it always uses all deliverables + synthesis. Update so that:
  - When `source === 'winner'` or `source === 'loser'`: filter `input.deliverables` to only the matching `sourceTeamId`; ignore synthesis context
  - When `source === 'synthesis'`: use `input.synthesis` as primary context; include both teams' deliverables as background

  Find the section that builds the prompt context and add:
  ```typescript
  // Select primary deliverables based on source
  const primaryDeliverables = input.source === 'synthesis'
    ? input.deliverables  // all teams as background
    : input.deliverables.filter(d => d.teamId === input.sourceTeamId);

  const synthesisContext = input.source === 'synthesis' && input.synthesis
    ? `\n\n## Synthesis\n${input.synthesis.synthesis}`
    : '';
  ```

  Use `primaryDeliverables` and `synthesisContext` in prompt construction instead of the current variables.

- [ ] **Step 4: Return ForgeRun from runForge (not ForgeOutput)**

  Change `runForge` return type from `Promise<ForgeOutput>` to `Promise<ForgeRun>`:
  ```typescript
  import { randomUUID } from 'crypto'; // add at top of file

  // At the end of runForge, return a ForgeRun:
  // Note: exact variable names from forge-orchestrator.ts line 607/652/695:
  //   FORGE_MODEL_LABEL (not FORGE_MODEL), domain, selectedTypes
  return {
    id: randomUUID(),
    source: input.source,
    sourceTeamId: input.sourceTeamId,
    forgeModel: FORGE_MODEL_LABEL,
    artifacts,
    generatedAt: new Date().toISOString(),
    domain,
    selectedTypes,
  };
  ```

- [ ] **Step 5: Update the POST /forge route to accept source**

  In `competitions.ts`, update the forge route:

  ```typescript
  // POST /competitions/:id/forge
  competitionsRouter.post('/:id/forge', requireApiKey, async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const source: ForgeSource = req.body?.source ?? 'winner';

    if (!['winner', 'loser', 'synthesis'].includes(source)) {
      res.status(400).json({ error: 'source must be winner, loser, or synthesis' });
      return;
    }

    if (forgingInProgress.has(id)) {
      res.status(409).json({ error: 'Forge already in progress' });
      return;
    }

    const [comp, result] = await Promise.all([repo.getCompetition(id), repo.getResult(id)]);
    if (!comp) { res.status(404).json({ error: 'Competition not found' }); return; }
    if (!result) { res.status(409).json({ error: 'No results found' }); return; }

    // Allow forging from COMPLETE or FORGE_COMPLETE state
    if (comp.state !== CompetitionState.COMPLETE && comp.state !== CompetitionState.FORGE_COMPLETE) {
      res.status(409).json({ error: `Cannot forge in ${comp.state} state` });
      return;
    }

    if (source === 'synthesis' && !result.synthesis) {
      res.status(409).json({ error: 'No synthesis available — run synthesis first' });
      return;
    }

    const teams = (comp.teams as Team[]) ?? [];
    // Note: StoredResult has `winner: string | null` (not `winnerId`)
    const winnerId = result.winner;
    const winnerTeam = teams.find(t => t.id === winnerId) ?? teams[0];
    const loserTeam = teams.find(t => t.id !== winnerId) ?? teams[1];

    const sourceTeam = source === 'winner' ? winnerTeam
      : source === 'loser' ? loserTeam
      : undefined;

    forgingInProgress.add(id);
    await repo.updateState(id, CompetitionState.FORGING);

    const forgeInput: ForgeInput = {
      brief: comp.brief as ForgeInput['brief'],
      presentations: (result.presentations as TeamPresentation[]) ?? [],
      synthesis: result.synthesis as ForgeInput['synthesis'],
      winner: { teamId: winnerTeam.id, model: winnerTeam.model },
      deliverables: (result.deliverables as ForgeInput['deliverables']) ?? [],
      source,
      sourceTeamId: sourceTeam?.id,
    };

    runForge(forgeInput, id)
      .then(async (forgeRun) => {
        await repo.appendForgeRun(id, forgeRun);
        await repo.updateState(id, CompetitionState.FORGE_COMPLETE);
        console.log(`[arena] forge run complete for ${id} — source: ${source}`);
      })
      .catch(async (err: Error) => {
        console.error(`[arena] forge failed for ${id}:`, err.message);
        await repo.updateState(id, CompetitionState.COMPLETE).catch(console.error);
      })
      .finally(() => forgingInProgress.delete(id));

    res.status(202).json({ ok: true, message: 'Forge started', source });
  });
  ```

  Remove the old `if (result?.forge) { ... alreadyForged: true }` check — stacked runs means we never short-circuit.

- [ ] **Step 6: Update GET /forge to return runs array**

  ```typescript
  competitionsRouter.get('/:id/forge', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const [comp, result] = await Promise.all([repo.getCompetition(id), repo.getResult(id)]);
    if (!comp) { res.status(404).json({ error: 'Competition not found' }); return; }

    const runs = (result?.forge as ForgeRun[] | null) ?? [];
    const inProgress = forgingInProgress.has(id);

    res.json({
      status: inProgress ? 'forging' : runs.length > 0 ? 'complete' : 'idle',
      runs,
    });
  });
  ```

  Import `ForgeRun` and `ForgeSource` from `@arena/shared` at the top of the file.

- [ ] **Step 7: Typecheck + tests**

  ```bash
  npm run typecheck --workspace=packages/orchestrator
  npm run test --workspace=packages/orchestrator 2>&1 | tail -10
  ```
  Expected: 162 tests pass (or adjusted count if runner tests changed in Task 3).

- [ ] **Step 8: Commit**

  ```bash
  git add packages/orchestrator/src/server/routes/competitions.ts \
          packages/orchestrator/src/forge/forge-orchestrator.ts
  git commit -m "feat(forge): source picker, stacked runs, no dedup guard"
  ```

---

### Task 6: GET /deliverables/:teamId/download — ZIP endpoint

**Files:**
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`

- [ ] **Step 1: Verify `archiver` is already installed**

  `archiver` is already imported at line 3 of `competitions.ts`. No install needed.
  Confirm by reading the top of `packages/orchestrator/src/server/routes/competitions.ts` and checking for `import archiver from 'archiver'`.

- [ ] **Step 2: Add the download route**

  Add to `competitions.ts` (after the forge routes — `archiver` is already imported at the top of the file, do NOT add a second import):
  ```typescript
  // GET /competitions/:id/deliverables/:teamId/download — ZIP of team files
  competitionsRouter.get('/:id/deliverables/:teamId/download', async (req: Request, res: Response) => {
    const { id, teamId } = req.params as { id: string; teamId: string };

    const [comp, result] = await Promise.all([repo.getCompetition(id), repo.getResult(id)]);
    if (!comp) { res.status(404).json({ error: 'Competition not found' }); return; }

    const deliverables = (result?.deliverables as TeamDeliverable[] | null) ?? [];
    const teamDel = deliverables.find(d => d.teamId === teamId);
    if (!teamDel || teamDel.files.length === 0) {
      res.status(404).json({ error: 'No deliverables found for team' });
      return;
    }

    const teams = (comp.teams as Team[]) ?? [];
    const team = teams.find(t => t.id === teamId);
    const label = team ? `${team.model.replace(':', '-')}-files` : `team-${teamId.slice(0, 8)}-files`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${label}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    for (const file of teamDel.files) {
      const safePath = file.path.replace(/^\//, '').replace(/\.\.\//g, '');
      archive.append(file.content, { name: safePath });
    }

    await archive.finalize();
  });
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  npm run typecheck --workspace=packages/orchestrator
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add packages/orchestrator/src/server/routes/competitions.ts \
          packages/orchestrator/package.json packages/orchestrator/package-lock.json \
          packages/orchestrator/node_modules/.package-lock.json 2>/dev/null || true
  git commit -m "feat(routes): GET /deliverables/:teamId/download — ZIP per team"
  ```

---

## Chunk 3: Frontend — Files + Presentations Tabs

### Task 7: Global readability — font scale + text colors

**Files:**
- Modify: `packages/web/app/globals.css`
- Modify: `packages/web/lib/design-tokens.ts`
- Modify: `packages/web/lib/EventRow.tsx`

- [ ] **Step 1: Add font scale to globals.css**

  Read `packages/web/app/globals.css`. After the `body { background-image: ... }` block, add:
  ```css
  html {
    font-size: 120%;
  }
  ```

- [ ] **Step 2: Update design tokens**

  Read `packages/web/lib/design-tokens.ts`. Update the three text tokens:
  ```typescript
  export const TEXT_PRIMARY = '#e4f8ff';   // was #c8eef8
  export const TEXT_MUTED   = '#7cc6db';   // was #4a8fa8
  export const TEXT_DIM     = '#3d7d94';   // was #1e4a5a
  ```

- [ ] **Step 3: Sweep hardcoded old values in EventRow.tsx**

  Read `packages/web/lib/EventRow.tsx`. Replace:
  - `color: '#4a5568'` (timestamp) → `color: '#3d7d94'`
  - `color: '#4a8fa8'` (collapse button) → `color: '#7cc6db'`

  (Other colors in EventRow are semantic label colors — leave them.)

- [ ] **Step 4: Sweep hardcoded text values in competition page**

  In `packages/web/app/competitions/[id]/page.tsx`, run replace-all for:
  - `#c4d4e8` → `#d8f0fa`  (used for event row body text — slightly brighter)
  - `#c4cdd9` → `#d8f0fa`  (used in brief panel body text)

  These are not in design-tokens but appear in the arena page inline styles.

- [ ] **Step 5: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add packages/web/app/globals.css \
          packages/web/lib/design-tokens.ts \
          packages/web/lib/EventRow.tsx \
          packages/web/app/competitions/[id]/page.tsx
  git commit -m "fix(ui): +20% font scale, +35% text brightness for readability"
  ```

---

### Task 8: Files tab — inline preview + ZIP download

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`
- Modify: `packages/web/app/api/competitions/[id]/deliverables/[teamId]/download/route.ts` *(new file)*

The download button needs a Next.js API route proxy (so the web app can forward the request to the orchestrator API without exposing the internal API URL to the browser directly).

- [ ] **Step 1: Create the Next.js proxy route**

  Create `packages/web/app/api/competitions/[id]/deliverables/[teamId]/download/route.ts`:
  ```typescript
  import { NextRequest, NextResponse } from 'next/server';

  // Next.js 15: params is a Promise — must be awaited
  export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string; teamId: string }> }
  ) {
    const { id, teamId } = await params;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
    const upstream = `${apiBase}/competitions/${id}/deliverables/${teamId}/download`;

    const res = await fetch(upstream);
    if (!res.ok) {
      return NextResponse.json({ error: 'Download failed' }, { status: res.status });
    }

    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? 'attachment; filename="files.zip"';

    return new NextResponse(blob, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': cd,
      },
    });
  }
  ```

- [ ] **Step 2: Locate the Files tab in page.tsx**

  Search for the Files tab rendering section (look for `deliverables`, `files`, `teamDel` or similar). Read that section carefully.

- [ ] **Step 3: Add expandedFile state**

  Near the top of the `GalleryPage` / `ArenaPage` component's state declarations, add:
  ```typescript
  const [expandedFile, setExpandedFile] = useState<{ teamId: string; path: string } | null>(null);
  const [fileModalContent, setFileModalContent] = useState<{ path: string; content: string } | null>(null);
  ```

- [ ] **Step 4: Update file rows to be clickable with inline preview**

  In the Files tab, for each file row, replace the static `<div>` with:
  ```tsx
  {teamDel.files.map((file) => {
    const key = `${teamDel.teamId}::${file.path}`;
    const isExpanded = expandedFile?.teamId === teamDel.teamId && expandedFile?.path === file.path;
    const previewLines = file.content.split('\n').slice(0, 50).join('\n');
    const hasMore = file.content.split('\n').length > 50;

    return (
      <div key={file.path}>
        {/* File row */}
        <div
          onClick={() => setExpandedFile(isExpanded ? null : { teamId: teamDel.teamId, path: file.path })}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.35rem 0.6rem', borderRadius: '5px',
            background: isExpanded ? 'rgba(0,240,255,0.06)' : 'rgba(10,34,53,0.4)',
            cursor: 'pointer',
            borderLeft: isExpanded ? '2px solid #00f0ff' : '2px solid transparent',
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ fontSize: '0.7rem' }}>📄</span>
          <span style={{ fontSize: '0.72rem', color: '#e4f8ff', flex: 1 }}>{file.path}</span>
          <span style={{ fontSize: '0.6rem', color: '#3d7d94' }}>
            {(file.content.length / 1024).toFixed(1)} KB
          </span>
          <span style={{ fontSize: '0.6rem', color: isExpanded ? '#00f0ff' : '#3d7d94' }}>
            {isExpanded ? '▲' : '▾'}
          </span>
        </div>

        {/* Inline preview */}
        {isExpanded && (
          <div style={{
            background: '#000408', border: '1px solid #0a2235',
            borderTop: 'none', borderRadius: '0 0 6px 6px',
            padding: '0.65rem 0.8rem',
            maxHeight: '240px', overflowY: 'auto',
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: '0.68rem', color: '#7cc6db', lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {previewLines}
            {hasMore && (
              <div style={{ marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid #0a2235' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setFileModalContent({ path: file.path, content: file.content }); }}
                  style={{
                    background: 'none', border: 'none', color: '#00f0ff',
                    fontSize: '0.62rem', cursor: 'pointer', fontFamily: 'inherit', padding: 0,
                  }}
                >
                  Open full file ({file.content.split('\n').length} lines) →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  })}
  ```

- [ ] **Step 5: Add ZIP download button per team**

  In the Files tab header for each team column, add:
  ```tsx
  <a
    href={`/api/competitions/${id}/deliverables/${teamDel.teamId}/download`}
    download
    style={{
      fontSize: '0.62rem', fontWeight: 700, padding: '0.25rem 0.65rem',
      borderRadius: '5px', background: 'rgba(0,240,255,0.1)',
      border: '1px solid rgba(0,240,255,0.35)', color: '#00f0ff',
      textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
      letterSpacing: '0.5px',
    }}
  >
    📦 ZIP
  </a>
  ```

- [ ] **Step 6: Add full-file modal**

  Near the other modals (or at the end of the JSX return, before the closing `</div>`), add:
  ```tsx
  {/* Full-file modal */}
  {fileModalContent && (
    <div
      onClick={() => setFileModalContent(null)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,4,8,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#050f1e', border: '1px solid #0a2235', borderRadius: '10px',
          width: 'min(760px, 92vw)', maxHeight: '82vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          padding: '0.85rem 1.1rem', borderBottom: '1px solid #0a2235',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#e4f8ff', fontFamily: 'monospace' }}>
            {fileModalContent.path}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              onClick={() => navigator.clipboard.writeText(fileModalContent.content)}
              style={{
                fontSize: '0.6rem', padding: '0.2rem 0.55rem', borderRadius: '4px',
                background: 'rgba(0,240,255,0.08)', border: '1px solid rgba(0,240,255,0.3)',
                color: '#00f0ff', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700,
              }}
            >
              Copy
            </button>
            <button
              onClick={() => setFileModalContent(null)}
              style={{ background: 'none', border: 'none', color: '#3d7d94', cursor: 'pointer', fontSize: '1rem' }}
            >
              ✕
            </button>
          </div>
        </div>
        <div style={{
          padding: '0.85rem 1.1rem', overflowY: 'auto', flex: 1,
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: '0.68rem', color: '#7cc6db', lineHeight: 1.7,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {fileModalContent.content}
        </div>
      </div>
    </div>
  )}
  ```

- [ ] **Step 7: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add packages/web/app/competitions/[id]/page.tsx \
          packages/web/app/api/competitions/\[id\]/deliverables/
  git commit -m "feat(ui): files tab inline preview, scrollable, ZIP download per team"
  ```

---

### Task 9: Presentations tab — modal + download

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`

- [ ] **Step 1: Add presentation modal state**

  Add to component state:
  ```typescript
  const [presentationModal, setPresentationModal] = useState<TeamPresentation | null>(null);
  ```

- [ ] **Step 2: Add expand + download buttons to each presentation card**

  Find the Presentations tab rendering (look for `presentations`, `TeamPresentation`, `approach`, `criterionFindings`). For each team card header, add:
  ```tsx
  <div style={{ display: 'flex', gap: '0.5rem' }}>
    {/* Expand button */}
    <button
      onClick={() => setPresentationModal(pres)}
      style={{
        fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.5rem',
        borderRadius: '4px', background: 'transparent',
        border: '1px solid #0a2235', color: '#7cc6db',
        cursor: 'pointer', fontFamily: 'monospace', letterSpacing: '0.5px',
      }}
    >
      ⤢ Expand
    </button>
    {/* Download button */}
    <button
      onClick={() => downloadPresentation(pres)}
      style={{
        fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.5rem',
        borderRadius: '4px', background: 'rgba(0,240,255,0.08)',
        border: '1px solid rgba(0,240,255,0.35)', color: '#00f0ff',
        cursor: 'pointer', fontFamily: 'monospace', letterSpacing: '0.5px',
      }}
    >
      ↓ Download
    </button>
  </div>
  ```

- [ ] **Step 3: Add `downloadPresentation` helper**

  Add this function inside the component (before the return):
  ```typescript
  function downloadPresentation(pres: TeamPresentation) {
    const lines = [
      `# Presentation — ${pres.model}`,
      '',
      `## Approach`,
      pres.approach,
      '',
      `## Key Insight`,
      pres.keyInsight,
      '',
      `## Deliverable Summary`,
      pres.deliverableSummary,
      '',
      `## Criteria Findings`,
      ...(pres.criterionFindings ?? []).flatMap((f) => [
        `### ${f.criterionId}`,
        f.finding,
        f.strength ? `**Strength:** ${f.strength}` : '',
        f.gap ? `**Gap:** ${f.gap}` : '',
        '',
      ]),
    ].join('\n');

    const blob = new Blob([lines], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `presentation-${pres.model.replace(':', '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }
  ```

- [ ] **Step 4: Add presentation modal JSX**

  Near the other modals (full-file modal from Task 8), add:
  ```tsx
  {/* Presentation modal */}
  {presentationModal && (
    <div
      onClick={() => setPresentationModal(null)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,4,8,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#050f1e', border: '1px solid #0a2235', borderRadius: '10px',
          width: 'min(680px, 92vw)', maxHeight: '82vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Modal header */}
        <div style={{
          padding: '0.9rem 1.2rem', borderBottom: '1px solid #0a2235',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#e4f8ff' }}>
            {presentationModal.model}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              onClick={() => downloadPresentation(presentationModal)}
              style={{
                fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.55rem',
                borderRadius: '4px', background: 'rgba(0,240,255,0.08)',
                border: '1px solid rgba(0,240,255,0.35)', color: '#00f0ff',
                cursor: 'pointer', fontFamily: 'monospace',
              }}
            >
              ↓ Download
            </button>
            <button
              onClick={() => setPresentationModal(null)}
              style={{ background: 'none', border: 'none', color: '#3d7d94', cursor: 'pointer', fontSize: '1rem' }}
            >
              ✕
            </button>
          </div>
        </div>
        {/* Modal body */}
        <div style={{ padding: '1.2rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          {[
            { label: 'APPROACH', content: presentationModal.approach },
            { label: 'KEY INSIGHT', content: presentationModal.keyInsight },
            { label: 'DELIVERABLE SUMMARY', content: presentationModal.deliverableSummary },
          ].map(({ label, content }) => (
            <div key={label}>
              <div style={{ fontSize: '0.58rem', color: '#3d7d94', letterSpacing: '1.5px', marginBottom: '0.35rem' }}>{label}</div>
              <div style={{ fontSize: '0.78rem', color: '#e4f8ff', lineHeight: 1.7 }}>{content}</div>
            </div>
          ))}
          {(presentationModal.criterionFindings ?? []).length > 0 && (
            <div>
              <div style={{ fontSize: '0.58rem', color: '#3d7d94', letterSpacing: '1.5px', marginBottom: '0.6rem' }}>CRITERIA FINDINGS</div>
              {presentationModal.criterionFindings.map((f) => (
                <div key={f.criterionId} style={{ marginBottom: '0.85rem', paddingLeft: '0.7rem', borderLeft: '2px solid #0a2235' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#00f0ff', marginBottom: '0.25rem' }}>{f.criterionId}</div>
                  <div style={{ fontSize: '0.72rem', color: '#e4f8ff', lineHeight: 1.6, marginBottom: '0.2rem' }}>{f.finding}</div>
                  {f.strength && <div style={{ fontSize: '0.65rem', color: '#7cc6db' }}>Strength: {f.strength}</div>}
                  {f.gap && <div style={{ fontSize: '0.65rem', color: '#7cc6db' }}>Gap: {f.gap}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )}
  ```

- [ ] **Step 5: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add packages/web/app/competitions/[id]/page.tsx
  git commit -m "feat(ui): presentations modal + markdown download"
  ```

---

## Chunk 4: Frontend — Synthesis + Forge Tabs

### Task 10: Synthesis tab — idle state + on-demand trigger

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`

- [ ] **Step 1: Add synthesis trigger state**

  Add to component state:
  ```typescript
  const [synthRunning, setSynthRunning] = useState(false);
  const [synthError, setSynthError] = useState<string | null>(null);
  ```

- [ ] **Step 2: Add `runSynthesis` handler**

  ```typescript
  async function runSynthesis() {
    setSynthRunning(true);
    setSynthError(null);
    try {
      const res = await fetch(`/api/competitions/${id}/synthesis`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setSynthError(body.error ?? 'Synthesis failed');
      }
      // Result will appear via polling (existing result polling loop or re-fetch)
    } catch {
      setSynthError('Network error — could not start synthesis');
    } finally {
      setSynthRunning(false);
    }
  }
  ```

  Also create the Next.js API proxy route at `packages/web/app/api/competitions/[id]/synthesis/route.ts` (this file does not exist yet — create it):
  ```typescript
  import { NextRequest, NextResponse } from 'next/server';

  // Next.js 15: params is a Promise — must be awaited
  export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
    const res = await fetch(`${apiBase}/competitions/${id}/synthesis`, { method: 'POST' });
    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  }
  ```

- [ ] **Step 3: Update Synthesis tab rendering**

  Find the Synthesis tab rendering section in `page.tsx` (search for `overallRationale` and `perCriterion` — the synthesis display is inline JSX around lines 1229–1340, NOT a separate component). The synthesis content **is not** a `<SynthesisContent>` component; do not create one.

  Locate the existing `activeTab === 'synthesis'` block. Restructure it to:
  1. Wrap the existing inline synthesis JSX in `{result?.synthesis ? ( ...existing JSX... ) : ( ...idle state... )}`
  2. Add the idle state as the `else` branch

  The idle state JSX to insert:
  ```tsx
  {/* Idle state — no synthesis yet */}
  <div style={{
    textAlign: 'center', padding: '4rem 2rem',
    background: '#050f1e', border: '1px solid #0a2235', borderRadius: '8px',
  }}>
    <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔮</div>
    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#e4f8ff', marginBottom: '0.5rem' }}>
      Synthesize a Hybrid Solution
    </div>
    <div style={{ fontSize: '0.75rem', color: '#7cc6db', maxWidth: '400px', margin: '0 auto 1.5rem', lineHeight: 1.7 }}>
      Ask AI to merge the best elements from both teams into a single unified deliverable,
      with per-criterion attribution showing what came from whom.
    </div>
    {synthError && (
      <div style={{ fontSize: '0.68rem', color: '#ef4444', marginBottom: '1rem' }}>{synthError}</div>
    )}
    <button
      onClick={runSynthesis}
      disabled={synthRunning}
      style={{
        fontSize: '0.72rem', fontWeight: 800, padding: '0.6rem 1.5rem',
        borderRadius: '6px', background: 'rgba(0,240,255,0.12)',
        border: '1px solid rgba(0,240,255,0.4)', color: '#00f0ff',
        cursor: synthRunning ? 'not-allowed' : 'pointer',
        fontFamily: 'monospace', letterSpacing: '1.5px', textTransform: 'uppercase',
        opacity: synthRunning ? 0.6 : 1,
      }}
    >
      {synthRunning ? '🔮 Running…' : '🔮 Run Synthesis'}
    </button>
  </div>
  ```

- [ ] **Step 4: Remove SYNTHESIZING from state machine display**

  In the competition header, if there is a status flow diagram or breadcrumb showing states, remove `SYNTHESIZING` from it.

- [ ] **Step 5: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add packages/web/app/competitions/[id]/page.tsx \
          packages/web/app/api/competitions/\[id\]/synthesis/
  git commit -m "feat(ui): synthesis tab idle state + on-demand trigger"
  ```

---

### Task 11: Forge tab — source picker + stacked runs

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`

- [ ] **Step 1: Add forge state**

  Update forge-related state to handle runs array and source selection:
  ```typescript
  const [forgeRuns, setForgeRuns] = useState<ForgeRun[]>([]);
  const [forgeRunning, setForgeRunning] = useState(false);
  const [forgeSource, setForgeSource] = useState<ForgeSource>('winner');
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [activeForgeRunId, setActiveForgeRunId] = useState<string | null>(null);
  ```

  Import `ForgeRun` and `ForgeSource` from `@arena/shared` at the top of the file.

- [ ] **Step 2: Update forge data fetching**

  Find the existing `useEffect` that fetches forge data (calls `/api/competitions/${id}/forge`). Update it to set `forgeRuns` from the response:
  ```typescript
  // Old: setForge(data.forge)
  // New:
  if (Array.isArray(data.runs)) {
    setForgeRuns(data.runs);
    if (data.runs.length > 0 && !activeForgeRunId) {
      setActiveForgeRunId(data.runs[data.runs.length - 1].id); // default to latest
    }
  }
  ```

- [ ] **Step 3: Add `triggerForge` handler**

  ```typescript
  async function triggerForge() {
    setForgeRunning(true);
    setForgeError(null);
    try {
      const res = await fetch(`/api/competitions/${id}/forge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: forgeSource }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setForgeError(body.error ?? 'Forge failed to start');
      }
      // Polling loop will pick up new run when done
    } catch {
      setForgeError('Network error');
    } finally {
      setForgeRunning(false);
    }
  }
  ```

  First check if `packages/web/app/api/competitions/[id]/forge/route.ts` already exists. It likely does NOT — create it. Add both GET (proxy to orchestrator) and POST handlers. Next.js 15 requires `params` as a Promise:
  ```typescript
  import { NextRequest, NextResponse } from 'next/server';

  const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

  // Next.js 15: params is a Promise — must be awaited
  export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const res = await fetch(`${apiBase()}/competitions/${id}/forge`);
    return NextResponse.json(await res.json(), { status: res.status });
  }

  export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    const { id } = await params;
    const body = await req.json();
    const res = await fetch(`${apiBase()}/competitions/${id}/forge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  }
  ```

- [ ] **Step 4: Render source picker**

  Find the Forge tab section. Replace the existing "Forge This Solution" button area with:
  ```tsx
  {/* Source picker */}
  <div style={{
    background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '8px',
    padding: '1.5rem', textAlign: 'center', marginBottom: '1rem',
  }}>
    <div style={{ fontSize: '0.62rem', color: '#3d7d94', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '0.85rem' }}>
      ⚒ Forge a new set of artifacts from
    </div>
    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
      {([
        { value: 'winner' as ForgeSource, label: `🏆 Winner (${winnerTeam?.model ?? '?'})` },
        { value: 'loser' as ForgeSource, label: `📋 Loser (${loserTeam?.model ?? '?'})` },
        { value: 'synthesis' as ForgeSource, label: '🔮 Synthesis', disabled: !result?.synthesis },
      ] as const).map(({ value, label, disabled }) => (
        <button
          key={value}
          disabled={disabled}
          onClick={() => setForgeSource(value)}
          style={{
            padding: '0.5rem 1rem', borderRadius: '6px',
            border: `1.5px solid ${forgeSource === value ? (value === 'winner' ? 'rgba(255,102,0,0.6)' : '#00f0ff') : '#0a2235'}`,
            background: forgeSource === value ? (value === 'winner' ? 'rgba(255,102,0,0.1)' : 'rgba(0,240,255,0.08)') : '#050f1e',
            color: disabled ? '#1e4a5a' : forgeSource === value ? (value === 'winner' ? '#ff6600' : '#00f0ff') : '#7cc6db',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: '0.68rem', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.5px',
          }}
        >
          {label}
          {disabled && ' (run synthesis first)'}
        </button>
      ))}
    </div>
    {forgeError && <div style={{ fontSize: '0.65rem', color: '#ef4444', marginBottom: '0.75rem' }}>{forgeError}</div>}
    <button
      onClick={triggerForge}
      disabled={forgeRunning || comp?.state === 'FORGING'}
      style={{
        fontSize: '0.72rem', fontWeight: 800, padding: '0.55rem 1.4rem',
        borderRadius: '6px', background: 'rgba(0,240,255,0.12)',
        border: '1px solid rgba(0,240,255,0.4)', color: '#00f0ff',
        cursor: forgeRunning ? 'not-allowed' : 'pointer',
        fontFamily: 'monospace', letterSpacing: '1.5px', textTransform: 'uppercase',
        opacity: forgeRunning ? 0.6 : 1,
      }}
    >
      {forgeRunning || comp?.state === 'FORGING' ? '⚒ Forging…' : '⚒ Forge This'}
    </button>
  </div>

  {/* Stacked runs list */}
  {forgeRuns.length > 0 && (
    <div>
      <div style={{ fontSize: '0.58rem', color: '#3d7d94', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
        Previous forge runs
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        {[...forgeRuns].reverse().map((run, idx) => {
          const sourceLabel = run.source === 'winner' ? `🏆 Winner` : run.source === 'loser' ? `📋 Loser` : `🔮 Synthesis`;
          const runNum = forgeRuns.length - idx;
          const isActive = activeForgeRunId === run.id;
          return (
            <div
              key={run.id}
              style={{
                background: '#050f1e',
                border: `1px solid ${isActive ? '#0e3050' : '#0a2235'}`,
                borderRadius: '8px', padding: '0.9rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#e4f8ff' }}>
                  {sourceLabel} — Run #{runNum}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.58rem', color: '#3d7d94' }}>
                    {run.artifacts.length} artifacts
                  </span>
                  <a
                    href={`/api/competitions/${id}/forge/${run.id}/download`}
                    download
                    style={{
                      fontSize: '0.6rem', padding: '0.18rem 0.5rem', borderRadius: '4px',
                      background: 'transparent', border: '1px solid #0a2235', color: '#7cc6db',
                      textDecoration: 'none', fontFamily: 'monospace', fontWeight: 700,
                    }}
                  >
                    ↓ ZIP
                  </a>
                  <button
                    onClick={() => setActiveForgeRunId(isActive ? null : run.id)}
                    style={{
                      fontSize: '0.6rem', padding: '0.18rem 0.5rem', borderRadius: '4px',
                      background: isActive ? 'rgba(0,240,255,0.1)' : 'transparent',
                      border: `1px solid ${isActive ? 'rgba(0,240,255,0.4)' : '#0a2235'}`,
                      color: isActive ? '#00f0ff' : '#7cc6db',
                      cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700,
                    }}
                  >
                    {isActive ? 'Hide' : 'View'}
                  </button>
                </div>
              </div>
              {/* Artifact chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: isActive ? '0.75rem' : 0 }}>
                {run.artifacts.map((a) => (
                  <span key={a.type} style={{
                    fontSize: '0.58rem', padding: '0.12rem 0.4rem', borderRadius: '3px', fontWeight: 700, letterSpacing: '0.5px',
                    background: a.universal ? 'rgba(0,212,255,0.1)' : 'rgba(0,102,255,0.1)',
                    color: a.universal ? '#00d4ff' : '#0066ff',
                  }}>
                    {a.title}
                  </span>
                ))}
              </div>
              {/* Expanded artifact view */}
              {isActive && run.artifacts.map((artifact) => (
                <div key={artifact.type} style={{ marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid #0a2235' }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#00f0ff', marginBottom: '0.4rem', letterSpacing: '0.5px' }}>
                    {artifact.title}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#7cc6db', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                    {artifact.content}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  )}
  ```

  Before adding `winnerTeam`/`loserTeam` declarations, search for them in `page.tsx`:
  ```bash
  grep -n "winnerTeam\|loserTeam\|winnerId" "packages/web/app/competitions/[id]/page.tsx"
  ```
  If these variables already exist elsewhere in the component, reuse them instead of re-declaring. If they don't exist, add near the top of the component body:
  ```typescript
  // Note: `result.winner` is the field name in StoredResult (not `winnerId`)
  const winnerId = result?.winner;
  const winnerTeam = teams?.find((t) => t.id === winnerId);
  const loserTeam = teams?.find((t) => t.id !== winnerId);
  ```

- [ ] **Step 5: Add per-run ZIP download proxy route**

  `archiver` is not available in `packages/web`. Instead, install `jszip` which works in Next.js App Router:
  ```bash
  npm install jszip --workspace=packages/web
  npm install --save-dev @types/jszip --workspace=packages/web
  ```

  Create `packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts`:
  ```typescript
  import { NextRequest, NextResponse } from 'next/server';
  import JSZip from 'jszip';

  // Next.js 15: params is a Promise — must be awaited
  export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string; runId: string }> }
  ) {
    const { id, runId } = await params;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

    const res = await fetch(`${apiBase}/competitions/${id}/forge`);
    if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const data = await res.json() as { runs: Array<{ id: string; artifacts: Array<{ title: string; content: string }> }> };
    const run = data.runs?.find((r) => r.id === runId);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

    const zip = new JSZip();
    for (const artifact of run.artifacts) {
      zip.file(`${artifact.title.replace(/\s+/g, '-').toLowerCase()}.md`, artifact.content);
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="forge-run-${runId.slice(0, 8)}.zip"`,
      },
    });
  }
  ```

- [ ] **Step 6: Remove old single-forge rendering block**

  Search `page.tsx` for the old forge rendering code (look for `result?.forge`, `forge?.artifacts`, or the old "Forge This Solution" button that triggered the single-run flow). Remove any block that:
  - Reads `result.forge` as a single `ForgeOutput` object
  - Shows a single "Forge This Solution" button with no source picker
  - Displays a flat list of artifacts without run grouping

  Keep only the new source picker + stacked runs JSX added in Step 4.

- [ ] **Step 7: Typecheck**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json
  ```

- [ ] **Step 8: Run all tests**

  ```bash
  npm run test --workspace=packages/orchestrator 2>&1 | tail -10
  ```
  Expected: all passing.

- [ ] **Step 9: Commit**

  ```bash
  git add packages/web/app/competitions/[id]/page.tsx \
          packages/web/app/api/ \
          packages/web/package.json packages/web/package-lock.json
  git commit -m "feat(ui): forge source picker, stacked runs, per-run ZIP download"
  ```

---

## Final Verification

- [ ] Start orchestrator: `DATABASE_URL=postgresql://localhost/arena npx tsx packages/orchestrator/src/cli.ts serve --port 3000`
- [ ] Start web: `cd packages/web && npm run dev`
- [ ] Visit `/competitions/:id` for a COMPLETE competition and verify:
  - [ ] Presentations tab: Expand opens modal with all fields; Download saves `.md` file
  - [ ] Files tab: Clicking a file expands preview (scrollable); ZIP button downloads correct team files
  - [ ] Synthesis tab: Shows idle state with 🔮; clicking Run Synthesis calls the API (202)
  - [ ] Forge tab: Source picker shows 3 options (Synthesis disabled if no synthesis); forging appends a run; View toggles expanded artifacts; ZIP downloads the run
  - [ ] Text is visibly larger and more readable across the UI
- [ ] `npx tsc --noEmit -p packages/web/tsconfig.json` — no errors
- [ ] `npm run test --workspace=packages/orchestrator` — all passing
