# CLAUDE.md — @arena/video

Remotion 4.x package. Holds two things: the per-competition **recap reel** and the
**Arena4Ai sizzle** promo. The reel's render/API plumbing lives in `packages/web`, but
its gotchas are documented here because they only matter when you touch reels.

## Recap reels

On-demand ESPN-style recap video generated from completed competition pages.
1080×1920 @ 30fps, 65s (1950 frames).

**API routes (Next.js web):**
- `POST /api/competitions/:id/reel` — trigger render (202 async); atomic lock via `{ flag: 'wx' }` prevents double-renders; re-POSTing a done/error reel deletes old files and re-renders
- `GET /api/competitions/:id/reel` — poll render status → `{ status: 'idle'|'rendering'|'done'|'error', progress?, url?, message? }`
- `GET /api/competitions/:id/reel/download` — stream MP4 via `fs.createReadStream` + `Readable.toWeb()`

**Key implementation details:**
- Bundle singleton in `packages/web/lib/remotion-bundle.ts` — `bundle()` called once per process lifetime; uses `process.cwd()` (= `packages/web/`) NOT `__dirname` (resolves to `.next/server/` in compiled output)
- Bundle pre-warm: `packages/web/instrumentation.ts` calls `getBundle()` on server startup (Next.js `register()` hook, Node.js runtime only), so the first render isn't cold
- Entry point: `packages/video/src/Root.tsx` (must call `registerRoot()`) — NOT `index.ts`
- `publicDir: path.resolve(process.cwd(), '../video/public')` passed to `bundle()` for static assets (audio)
- webpack `externals` function in `packages/web/next.config.mjs` blocks `@remotion/*`, `@rspack/*`, `remotion`, `*.node` from being bundled by Next.js — `serverExternalPackages` alone is insufficient on Next.js 14
- `scorecard.finalScore` (not `totalScore`) holds the 0–1 score; criteria scores in `scorecard.judgeResults[0].scores` (not `scorecard.criteriaScores`)
- `team.persona` is a separate field on the team object; `team.model` is just the model prefix without `:persona`
- Brief rubric `description` is often a placeholder `">"` — fall back to formatting the `id` (kebab-case → Title Case)
- State files: `/tmp/arena-reels/<id>.json` + `/tmp/arena-reels/<id>.mp4`; stale renders (>10min) auto-detected by mtime

**Scene timing (65s total):**

| Scene | Frames | Duration |
|---|---|---|
| IntroBumper | 0–120 | 4s |
| Matchup | 120–300 | 6s |
| BattleHighlights | 300–480 | 6s |
| TheBrief | 480–660 | 6s |
| KeyMoments | 660–960 | 10s |
| ScoreReveal | 960–1380 | 14s |
| Winner | 1380–1500 | 4s |
| GoDeeper | 1500–1770 | 9s |
| Outro | 1770–1950 | 6s |

**Scene design:**
- **Matchup**: N-team support; each team swoops from unique direction (left/top/right by index); badge size adapts to team count
- **BattleHighlights**: Canvas arena with `VideoGladiator`; 4-6 key events from competition history drive gladiator animations; `ReelKeyEvent` carries `frameOffset`, `teamId`, `type`
- **TheBrief**: Description truncated to 130 chars; criteria as animated pip+icon rows
- **KeyMoments**: Per-agent directional swoop (agent 0=left, 1=right, 2=bottom, 3=top); card layout with team color stripe
- **ScoreReveal**: Full scores grid all N teams × all criteria with animated bars; Ken Burns pan+zoom; ranked final scores
- **Winner**: Radiating spokes, conic score ring, top-3 criteria, pulsing glow
- **GoDeeper**: Synthesis and Forge promo cards only render when `hasSynthesis`/`hasForge` are true in `ReelData` (set by the reel API route from competition results)

**Audio:** `public/arena4ai-theme.mp3` — Remotion `<Audio loop>` at 75% volume, 1.5s fade-in, 2s fade-out.

**Reel UI buttons:** competition detail page shows `🎬 Generate Reel` when idle/error; `⬇ Download Reel` + `🔄 Regenerate` when done. Regenerate re-POSTs and resets polling.

## VideoGladiator

`src/components/VideoGladiator.ts` — frame-based port of the live arena gladiator
(`packages/web/lib/arena/gladiator-v2.ts` + `poses-v2.ts`), so reels match the live arena.
Pure function: no mutable state, no rAF, and deterministic `Math.sin(frame * k)` instead of
`Math.random()` (Remotion renders frames out of order). Supports optional
`terminal: 'triumph' | 'kneel'` for the Winner scene. When the live armor or poses change,
update this file to match.

## Arena4Ai sizzle (promo video)

63s marketing sizzle reel in three aspect ratios.

- `src/sizzle/Sizzle.tsx` — top-level composition, 9-scene `<Series>` with theme audio
- `src/sizzle/scenes/` — `IntroBumper`, `TheQuestion`, `GladiatorReveal`, `TheBrief`, `BattleHighlights`, `TheVerdict`, `TheForge`, `ThreePillars`, `SizzleOutro`
- Three `<Composition>` variants in `Root.tsx`: `SizzleLandscape` (1920×1080), `SizzlePortrait` (1080×1920), `SizzleSquare` (1080×1080). Same scene graph — each scene uses `useVideoConfig()` to adapt layout.
- Source material is the real `arena4ai-launch-strategy-001` competition (`78c7452f-...`): scenes 4 (brief builder), 6 (scores tab) and 7 (forge artifacts) overlay actual product screengrabs dimmed behind animated text.
- Scenes 3 + 5 render gladiators via `VideoGladiator` in a canvas. **Critical:** the canvas must be `position: absolute, inset: 0` — inside an `<AbsoluteFill>` (which is `display: flex`), a flex-child canvas collapses to 0 height and the gladiators render off-screen. Use `useLayoutEffect` for the canvas draw to keep Remotion's snapshot timing deterministic.

**Asset capture (Playwright):**
```bash
# Requires web (3001) + orchestrator (3000) running, and launch-strategy comp in FORGE_COMPLETE
npm run sizzle:capture --workspace=packages/video
```
Captures ~10 PNGs to `public/sizzle-assets/` via `scripts/capture-sizzle-assets.ts`.

**Rendering:**
```bash
npm run sizzle:render --workspace=packages/video   # all three aspect ratios
npm run sizzle        --workspace=packages/video   # capture + render
npx tsx packages/video/scripts/inspect-sizzle.ts   # single-frame still per scene for fast QA
```
Output lands in `out/` (gitignored, because it is regenerable). It is NOT copied anywhere
inside this repository — publishing to arena4.ai happens in the separate site repository,
which content-hashes the asset URL so a corrected video reaches viewers who already have
the page cached.
