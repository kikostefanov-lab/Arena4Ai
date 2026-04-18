# design-handoff/

Reference materials for the Arena4Ai arena viewer + homepage redesign. See `../HANDOFF.md` at repo root for the actual handoff doc — this folder is the supporting source.

## Contents

| File | What it is |
|---|---|
| `Arena Prototype.html` | Runnable prototype. Open in a browser (no build). This is the visual source of truth. |
| `app.jsx` | Match loop, phase machine, camera, HUD layout. Port target: `packages/web/app/competitions/[id]/` + an `ArenaViewer` client component. |
| `gladiator.jsx` | `GladiatorV2` renderer class. Port target: `packages/web/lib/arena/gladiator.ts`. |
| `ring.jsx` | `ArenaRing` + `Shockwaves` particle system. Port target: `packages/web/lib/arena/ring.ts`. |
| `hud.jsx` | React HUD components (LaneHeader, MomentumMeter, WinnerBanner, PhaseChip). Port target: `packages/web/components/arena/`. |
| `eventstream.jsx` | **Throwaway** — synthetic event generator. Replace with the real websocket/SSE stream. The event shape is specified in `../HANDOFF.md` §3. |
| `Review.html` | Design critique of the current `/` homepage. Drives edits in §1 of HANDOFF.md. |
| `Arena Review.html` | Earlier critique of the v1 gladiator renderer. Historical; this prototype is the fix. Delete after port. |

## Do not commit

If you don't want the reference materials in version control, add to `.gitignore`:
```
design-handoff/
```
The HANDOFF.md file at the root is the only thing that needs to stay.
