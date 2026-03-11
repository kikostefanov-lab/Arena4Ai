# Arena4Ai — Remotion Video Reels

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Competition recap video reels using Remotion, rendered on-demand from the competition detail page

---

## Overview

Add a "🎬 Generate Reel" button to the competition detail page that renders an ESPN-style, 9:16 vertical recap video (~42 seconds) for any completed competition. Videos are rendered server-side using `@remotion/renderer` and returned as a downloadable MP4.

**Three reel types planned long-term:**
1. **Competition recap** ← this spec (build first)
2. **Marketing promo** — cinematic trailer for Arena4Ai (future)
3. **Platform demo** — how-it-works walkthrough (future)

---

## Reel Structure

9:16 vertical format (1080×1920), 30fps, ~42 seconds = **1,260 frames** total.

All `<Sequence>` components use explicit `from` and `durationInFrames` (seconds × 30). Use `<Sequence>` throughout — not `<Series>`.

| Scene | Timing | from (frames) | durationInFrames | Content |
|-------|--------|--------------|-----------------|---------|
| IntroBumper | 0–3s | 0 | 90 | Arena4Ai logo on TRON grid, "COMPETITION RECAP" flashes in |
| Matchup | 3–7s | 90 | 120 | Team A vs Team B, model names, personas, color-matched glow, brief title |
| TheBrief | 7–11s | 210 | 120 | Challenge title + 1-line description + rubric criteria listed one by one |
| KeyMoments | 11–19s | 330 | 240 | 3–5 auto-selected highlights (color-coded by team, timestamped, narrative) |
| ScoreReveal | 19–30s | 570 | 330 | Criterion-by-criterion animated dual bars + judge commentary, builds to total |
| Winner | 30–33s | 900 | 90 | Winner name glows, TRON flash effect, final score %, synthesis quote |
| GoDeeper | 33–39s | 990 | 180 | Premium feature cards: ◈ Synthesis + ⚡ Forge — gold accent, "Available on arena4.ai" |
| Outro | 39–42s | 1170 | 90 | Arena4Ai logo + arena4.ai + "Watch more battles" |

The `<Composition>` in `Root.tsx` must set `durationInFrames={1260}` and `fps={30}`.

**Key moments auto-selection logic** (from `GET /competitions/:id/events` — returns `ArenaEvent[]` directly):
- First `FILE_CREATE` event per team
- Largest `TOOL_CALL` burst (highest event density in any 10s window)
- Any `ERROR` events
- De-duplicated and sorted by timestamp, capped at 5

---

## Architecture

### New package: `packages/video/`

```
packages/video/
├── package.json
├── remotion.config.ts
├── tsconfig.json
└── src/
    ├── index.ts                   — Package entry point: exports ReelData type + COMPOSITION_ID constant
    ├── Root.tsx                   — Remotion Root + composition registry
    ├── types.ts                   — ReelData type (serializable Remotion input props)
    ├── tokens.ts                  — Standalone copy of design tokens (no Next.js imports)
    ├── compositions/
    │   └── CompetitionRecap.tsx   — Main composition, sequences all 8 scenes via <Sequence>
    ├── scenes/
    │   ├── IntroBumper.tsx
    │   ├── Matchup.tsx
    │   ├── TheBrief.tsx
    │   ├── KeyMoments.tsx
    │   ├── ScoreReveal.tsx
    │   ├── Winner.tsx
    │   ├── GoDeeper.tsx
    │   └── Outro.tsx
    └── components/
        ├── TronGrid.tsx           — Animated TRON grid background (shared across scenes)
        ├── ModelBadge.tsx         — Color-matched model name badge
        ├── ScoreBar.tsx           — Animated dual score bar (both teams side-by-side)
        └── EventRow.tsx           — Single key moment highlight row
```

**Note:** `data-transformer.ts` is NOT in this package — data fetching and transformation lives entirely in the Next.js POST handler, which has access to `orchestratorUrl()`/`orchestratorHeaders()` and env vars. The video package only contains Remotion components and the `ReelData` type.

`src/index.ts` exports:
```ts
export type { ReelData } from './types';
export const COMPOSITION_ID = 'CompetitionRecap';
```

`Root.tsx` registers the composition with:
```ts
<Composition id={COMPOSITION_ID} component={CompetitionRecap}
  durationInFrames={1260} fps={30} width={1080} height={1920}
  defaultProps={mockReelData} />
```

`src/mock.ts` provides `mockReelData: ReelData` — a static fixture used as `defaultProps` in Remotion Studio for development. Contains two teams (claude:architect vs codex:speedrunner), 3 criteria, 3 key moments, winner set to team-a.

### ReelData type

```ts
// packages/video/src/types.ts
interface ReelData {
  competitionId: string;
  briefTitle: string;
  briefDescription: string;
  criteria: string[];              // display names from brief.rubric.criteria[].description
  teams: {
    teamId: string;
    label: string;
    model: string;
    persona: string;
    color: string;                 // hex — from MODEL_COLORS
    score: number;                 // 0–1
    criteriaScores: {
      name: string;                // from brief.rubric.criteria[].description (joined by criterionId)
      score: number;               // 0–1
      commentary: string;
    }[];
  }[];
  winnerId: string | null;
  keyMoments: {
    relativeMs: number;            // ms from competition startedAt
    teamId: string;
    label: string;                 // e.g. "Created fizzbuzz.py"
    type: 'FILE_CREATE' | 'TOOL_CALL' | 'ERROR';
  }[];
  synthesisQuote?: string;         // first sentence of results.synthesis.synthesis markdown (undefined if null)
  hasSynthesis: boolean;           // results.synthesis !== null
  hasForge: boolean;               // results.forge !== null && results.forge.length > 0
}
```

**Criteria name join:** `result.scorecards[].criteriaScores[].criterionId` is joined to `brief.rubric.criteria[].description` by matching `criterionId === criterion.id`. Both are available in the single `GET /competitions/:id` response. `RubricCriterion.id` is a plain string slug (e.g., `"correctness"`, `"code_quality"`) from the brief YAML — see `packages/shared/src/types/competition.ts`.

**`synthesisQuote` extraction:** `result.synthesis.synthesis` is a markdown string. Before extracting, strip leading markdown syntax (`#`, `##`, `**`, `*`, `-`, `>`) and trim whitespace. Then take the first sentence (up to the first `. ` or 150 chars, whichever is shorter). If `result.synthesis` is null (synthesis not triggered), `synthesisQuote` is undefined and `hasSynthesis` is false.

### Web integration

#### Data fetching (in the POST handler)

`GET /competitions/:id` returns `{ id, state, brief, teams, startedAt, result }` — `result` includes scorecards, winnerId, synthesis, forge, deliverables. This single call provides all competition data.

`GET /competitions/:id/events` returns `ArenaEvent[]` directly (not wrapped). Used for key moment selection.

Both calls use `orchestratorUrl()` and `orchestratorHeaders()` from `packages/web/lib/orchestrator.ts`.

#### Remotion bundle (server startup)

`@remotion/renderer`'s `renderMedia` requires a pre-built Remotion bundle (`serveUrl`). Create the bundle once when the Next.js server starts (module-level singleton) and reuse it for all renders:

```ts
// packages/web/lib/remotion-bundle.ts
import { bundle } from '@remotion/bundler';
import path from 'path';

let bundleLocation: string | null = null;

let bundlePromise: Promise<string> | null = null;

export function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: path.resolve(__dirname, '../../video/src/index.ts'),
      // __dirname = packages/web/.next/server — resolves to packages/video/src/index.ts
      // Adjust path if using tsconfig path alias instead
    });
  }
  return bundlePromise;
}
```

The bundle is created on first POST request and cached for subsequent renders.

#### API routes

**`packages/web/app/api/competitions/[id]/reel/route.ts`** (POST + GET):

- `POST`:
  1. Fetch competition via `orchestratorUrl('/competitions/:id')` with `orchestratorHeaders()`
  2. Check state is in `['COMPLETE', 'FORGING', 'FORGE_COMPLETE']` — else return `422 { error: 'Competition must be complete to generate a reel' }`
  3. `fs.mkdirSync('/tmp/arena-reels', { recursive: true })`
  4. **Atomic lock:** write `{ status: 'rendering', progress: 0 }` to `/tmp/arena-reels/<id>.json` using `fs.writeFileSync` with `{ flag: 'wx' }` (exclusive create). If `EEXIST`, read the file — if `status === 'rendering'` return `409 { error: 'Render already in progress' }`; if `status === 'done'` or `status === 'error'`, delete both `<id>.json` and `<id>.mp4` (if it exists), then retry the `wx` write to claim the lock.
  5. Fetch events via `orchestratorUrl('/competitions/:id/events')`
  6. Transform competition + events into `ReelData` (inline helper in route handler)
  7. Get bundle: `const serveUrl = await getBundle()`
  8. Fire-and-forget render:
     ```ts
     const outputLocation = `/tmp/arena-reels/${id}.mp4`;
     void renderMedia({
       composition: 'CompetitionRecap',
       serveUrl,
       codec: 'h264',
       outputLocation,
       inputProps: reelData,
       onProgress: ({ progress }) =>
         writeStateFile(id, { status: 'rendering', progress }),
     })
       .then(() => writeStateFile(id, { status: 'done', progress: 1 }))
       .catch(err => writeStateFile(id, { status: 'error', message: err.message }));
     ```
  9. Return `202 Accepted` with `{ status: 'rendering' }`

- `GET` — always returns HTTP `200`:
  - If state file doesn't exist → `{ status: 'idle' }`
  - If `status === 'done'` but `/tmp/arena-reels/<id>.mp4` is missing → `{ status: 'idle' }` (stale, MP4 cleaned up)
  - If `status === 'rendering'` and state file `mtime` > 10 minutes ago → `{ status: 'error', message: 'Render timed out' }` (stalled; user can POST again to reset)
  - Otherwise return file contents as-is:
    ```ts
    { status: 'idle' }
    { status: 'rendering', progress: number }               // 0–1
    { status: 'done', url: '/api/competitions/:id/reel/download' }
    { status: 'error', message: string }
    ```

**`packages/web/app/api/competitions/[id]/reel/download/route.ts`** (GET):
- Read `/tmp/arena-reels/<id>.mp4`; stream as `video/mp4` with `Content-Disposition: attachment; filename="arena-recap-<id>.mp4"`
- Return `404 { error: 'Reel not found' }` if file missing

#### Workspace dependency

Add to `packages/web/package.json`:
```json
"@arena/video": "workspace:*",
"@remotion/renderer": "^4.0.0",
"@remotion/bundler": "^4.0.0"
```
`@remotion/renderer` and `@remotion/bundler` are server-side Node.js packages used directly in the Next.js API route — they must be in the web package's dependencies, not just the video package's.

`packages/video/package.json` must define `"main": "dist/index.js"` and export `ReelData` type. Add a `build` script (`tsc -p tsconfig.json`). During development, configure `packages/video/tsconfig.json` with `"outDir": "dist"` and run `npm run build --workspace=packages/video` before starting the web dev server. For hot reloading, run `tsc --watch` in `packages/video/` in a separate terminal.

Alternatively, add a `tsconfig.json` path alias in `packages/web/tsconfig.json`:
```json
"paths": { "@arena/video/*": ["../video/src/*"] }
```
This avoids the build step in development (Next.js resolves source directly).

#### Font loading in Remotion (server-side SSR)

When rendering server-side via `renderMedia`, Remotion uses headless Chromium. `@remotion/google-fonts` must be called inside the React component tree so Chromium fetches the font during frame rendering. This differs from browser use — `delayRender`/`continueRender` work correctly in SSR because Remotion's renderer waits for all `delayRender` handles before capturing each frame.

```ts
// In Root.tsx or a shared layout component:
import { loadFont } from '@remotion/google-fonts/Orbitron';

const { waitUntilDone } = loadFont();

export const FontLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender('Loading Orbitron font'));
  useEffect(() => {
    waitUntilDone().then(() => continueRender(handle));
  }, [handle]);
  return <>{children}</>;
};
// useEffect + useState ensures delayRender is called once and continueRender fires after font loads.
```

Wrap all compositions in `<FontLoader>` in `Root.tsx`. This ensures Orbitron is loaded before any scene captures frames.

#### Competition detail page changes

File: `packages/web/app/competitions/[id]/page.tsx`

- On mount, call `GET /api/competitions/:id/reel` to hydrate initial reel state (may be `done` from a prior render, or `rendering` if page was reloaded mid-render)
- "🎬 Generate Reel" button shown when state is in `['COMPLETE', 'FORGING', 'FORGE_COMPLETE']`
- Button states:
  - `idle` (no state file or 404): `🎬 Generate Reel` — triggers POST on click
  - `rendering`: `⟳ Rendering… 67%` — fill animation left-to-right (width = progress%), cyan border pulse; polls GET every 1.5s
  - `done`: `⬇ Download Reel` — orange styling, links to download route
  - `error`: `⚠ Reel Failed` — red border, error message in tooltip or below button
- TRON progress card (shown during `rendering` state, dismisses on done/error):
  - Cyan glow progress bar (real % from `onProgress`)
  - "~Xs remaining" estimated via `elapsed / progress * (1 - progress)` ms, converted to seconds — hidden if `progress < 0.05`
  - Dismisses automatically when status changes to `done` or `error`

---

## Design tokens

All scenes use `packages/video/src/tokens.ts` — a standalone copy of the required values from `packages/web/lib/design-tokens.ts`. Do not import from `packages/web` inside the video package (circular dependency risk; Next.js-specific imports will fail in Remotion's bundler).

---

## Dependencies

```json
// packages/video/package.json
{
  "name": "@arena/video",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "studio": "npx remotion studio"
  },
  "dependencies": {
    "remotion": "^4.0.0",
    "@remotion/renderer": "^4.0.0",
    "@remotion/bundler": "^4.0.0",
    "@remotion/google-fonts": "^4.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "@remotion/cli": "^4.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "typescript": "^5.0.0"
  }
}
```

`@remotion/renderer` requires Chromium. Run `npx remotion browser ensure` to install the bundled Chromium if system Chrome is not available.

---

## Build sequence

1. Scaffold `packages/video/` with Remotion boilerplate (`npx create-video --blank`)
2. Create `types.ts` (ReelData), `tokens.ts` (standalone design tokens), `mock.ts` (mockReelData fixture)
3. Set up `packages/video/tsconfig.json` with: `"jsx": "react"`, `"moduleResolution": "bundler"`, `"lib": ["ES2020", "DOM"]`, `"outDir": "dist"`. Add path alias `"@arena/video/*": ["../video/src/*"]` to `packages/web/tsconfig.json`.
4. Build shared components: `TronGrid`, `ModelBadge`, `ScoreBar`, `EventRow`
5. Build scenes in order: IntroBumper → Matchup → TheBrief → KeyMoments → ScoreReveal → Winner → GoDeeper → Outro
6. Wire up `CompetitionRecap.tsx` with `<Sequence from={N} durationInFrames={M}>` for each scene; composition `durationInFrames={1260}` `fps={30}`
7. Test in Remotion Studio (`npx remotion studio`) with mock `ReelData`
8. Add `@arena/video` workspace dependency to `packages/web/package.json`
9. Build render API routes:
   - `reel/route.ts` (POST + GET) with inline data transformer
   - `reel/download/route.ts` (GET) streaming MP4
10. Wire up initial state fetch on mount + progress polling + all button/card states in competition detail page
11. End-to-end test: generate a reel from a real COMPLETE competition, verify MP4 downloads correctly

---

## Error handling

| Scenario | Behavior |
|----------|----------|
| Competition not found | POST returns `404 { error: 'Not found' }` |
| Competition not in complete state | POST returns `422 { error: 'Competition must be complete to generate a reel' }` |
| Render already in progress | POST returns `409 { error: 'Render already in progress' }` |
| `/tmp/arena-reels/` doesn't exist | `fs.mkdirSync(..., { recursive: true })` before any write |
| Renderer crash / Chromium error | State file written with `{ status: 'error', message: err.message }`; UI shows `⚠ Reel Failed` |
| Stalled render (mtime > 10min) | GET returns `{ status: 'error', message: 'Render timed out' }`; POST will reset lock and restart |
| Download file missing | GET `/reel/download` returns `404 { error: 'Reel not found' }` |
| Page reload mid-render | On mount GET hydrates state — spinner resumes if still rendering |

---

## Out of scope (this iteration)

- Audio / music track
- Marketing promo reel
- Platform demo reel
- 16:9 / 1:1 aspect ratio variants
- Remotion Lambda (AWS) deployment
- Persistent storage for rendered reels (files are ephemeral in `/tmp`)
- Reel sharing / social embed links
