# HANDOFF — Arena4Ai

**Audience:** Claude Code (or any engineer with access to `packages/web/`).
**Source of truth for this handoff:** the files in this design project. **Target of work:** the real Next.js app in `packages/web/`.

This project contains two deliverables that now need to be ported into the codebase:

1. **Homepage review** — a design critique of the current `/` page with concrete fixes. Static HTML (`Review.html`), not code to ship.
2. **Arena battle prototype** — a runtime React+Canvas prototype (`Arena Prototype.html`) of the match-viewing experience. Vanilla React 18 via Babel standalone. Source split across `app.jsx`, `gladiator.jsx`, `ring.jsx`, `hud.jsx`, `eventstream.jsx`.

Everything below is oriented around **porting** these into `packages/web/`. The prototype's module boundaries were chosen to match the file layout I expect on the other side — see §4.

---

## 0 · File map

| File | Purpose | Port target |
|---|---|---|
| `Arena Prototype.html` | Self-contained runnable prototype. Inlined versions of the four JSX modules + React/Babel CDN tags. Use as the "does it still work?" reference. | n/a (bundle-only) |
| `app.jsx` | Top-level `ArenaApp` component. Owns the match loop, phase machine, camera, tweaks, HUD layout, transport controls. | `packages/web/app/competitions/[id]/page.tsx` + a new `ArenaViewer` client component |
| `gladiator.jsx` | `GladiatorV2` renderer class — poses, pose blending, flash states, energy, armor silhouette. | `packages/web/lib/arena/gladiator.ts` |
| `ring.jsx` | `ArenaRing` (floor grid, rings, phase tint, impact pulse) + `Shockwaves` particle system. | `packages/web/lib/arena/ring.ts` |
| `hud.jsx` | React chrome: `LaneHeader`, `MomentumMeter`, `WinnerBanner`, `PhaseChip`. | `packages/web/components/arena/*.tsx` |
| `eventstream.jsx` | Synthetic `EventStream` class. **Throwaway** — replace with the real websocket/SSE stream on port. | n/a |
| `Review.html` | Design review of the current `/` page. Structured as Keep / Critical / Major / Minor. | drives edits to `packages/web/app/page.tsx` + `layout.tsx` + `globals.css` |
| `Arena Review.html` | Earlier critique of the first gladiator renderer (clip-art problem). The prototype here is the fix. | historical, delete after port |

---

## 1 · Homepage review → concrete edits

Source: `Review.html`. The review has four severities — **Keep**, **Critical**, **Major**, **Minor**. Below is the TL;DR port list. Read `Review.html` for the full reasoning and side-by-side demos.

### Keep (do not touch)
- `layout.tsx` background stack (48px grid @ 0.025 opacity, CRT scanlines, corner brackets, cyan radial glow). This is the biggest reason the product feels like a product; don't regress it.
- `getModelColor()`, `getStateStyle()`, `FORMAT_BADGES`, `MONOSPACE_FONT` / `BODY_FONT` split.
- Live-state affordances: pulsing cyan border (`liveBorder 2s ease-in-out`), pulsing dot + `LIVE` chip, tinted card bg.
- API-status dot + retry-once fetch with 2s backoff.
- 10s auto-refresh tied to `visibilitychange`.

### Critical — fix before launch
1. **Hero hierarchy.** `fontSize: 1.8rem` on the H1 is subhead-sized. Push to `3–3.5rem` (56–65px), line-height `0.95`. Consider dropping the `◆ ARENA4AI | COMPETITIONS` kicker — the TopBar already brands. Replace with a single `BODY_FONT` subtitle (suggested copy in `Review.html` §03).
2. **Competition rows too dense.** Bump to `padding: 1.35rem 1.5rem`, inter-row gap `0.9rem`. Internal type unifies to two sizes (title 15px, meta 12.5px). Score bars on their own line. Drop matchup-chip icon prefixes — the colored pill is the identifier.
3. **Filter row.** Collapse 3-row State/Model/Category stack into a single horizontal toolbar: `[ search ] [ State segmented ] [ Model ▾ ] [ Category ▾ ]`. Mini-labels go; selected value is the label. State has 5 discrete values → segmented control; Model/Category → dropdowns.

### Major — this sprint
4. Type floor: nothing under `0.7rem` (≈13.5px) in body copy, `0.65rem` (≈12.5px) for badges, and only when paired with letter-spacing `1px`. Current `0.52–0.58rem` breaks apart at 120% root.
5. Zero-state is underused. Turn it into an onboarding panel: 3 example briefs from `briefs/` (fizzbuzz / roman-numerals / debate) with one-click launch, a 20s loop of an old run, or a "how this works" 3-step strip.
6. Missing product story. Homepage never says what the product *is*. Add a `BODY_FONT` subtitle under H1 (`"Two agents enter. A cross-judge scores their work..."` or similar) **or** promote the `⚔ New Battle` CTA into a hero button — currently only in TopBar.
7. Tournaments are half-surfaced. Either promote to a tab (`Competitions | Tournaments`) or add a compact "Active Tournaments" rail above the list showing only running/pending.

### Minor — polish
8. `#1e4a5a` (darkest muted) is overused for *informational* text (timestamps, run counts). Reserve it for non-informational glyphs (separators, inactive controls). Information text should step up to `#3d7d94` / `#4a8fa8`.
9. Icon language is inconsistent (emoji + unicode + HUD marks). Pick HUD glyphs (`◆ ● ▸ ⚔` uniform cyan) and drop emoji, or reserve emoji for state-change moments only.
10. `⚔ New Battle` CTA in TopBar is invisible at first glance. Match `#3d7d94` or reveal on card hover.

### What I did not review
`/competitions/[id]`, `/briefs`, the New Battle flow. Those have the highest depth-of-design and are where most of the TRON vocabulary should live — good follow-up.

---

## 2 · Arena prototype — what it is

A faithful mock of the match-viewing surface: two stylized "gladiator" figures on a grid-floor arena, fed by a timeline of events, with phase transitions (active → freeze → judging → reveal), a momentum meter, a scrubber, and tweakable look knobs. **No real data** — all events are synthesized by `EventStream`.

**Run it:** open `Arena Prototype.html`. Fonts load from Google, React/Babel from unpkg (integrity-pinned). No build step.

**Design system it speaks:**
- Colors come from the Arena4Ai model palette. Claude = `#ff6600`, Codex = `#0066ff`, Gemini = `#00f0ff`. The live map is `MODEL_COLORS` in `packages/video/src/tokens.ts`, with `getModelColor()` beside it — use it verbatim. There are three providers, not four; there is no separate GPT-5 entry.
- Type: Orbitron for HUD / state labels / titles; JetBrains Mono for values, log lines, code. Matches the existing `MONOSPACE_FONT` / `BODY_FONT` split.
- Background: same 48px grid @ 0.025 as the rest of the app; should inherit from `layout.tsx` on port.

**What's intentional and non-obvious:**
- **Figures are drawn every frame in Canvas**, not composed from SVG sprites. The armor silhouette, glow, and pose blending are cheap this way and allow per-frame energy/breath/flash interpolation.
- **Camera is part of the render, not CSS.** `cam.x` / `cam.zoom` ease toward targets, reset after 350ms. Strike events nudge the camera 8% toward the striker; winner reveal zooms 1.18× toward them.
- **Phase machine is time-normalized.** Match progress runs 0→1; phases trigger at hard cutoffs (see `MATCH_PHASES` at `app.jsx:28`). Scrubbing jumps to any frame. **The phase machine will need to become event-driven on port** — see §3.

---

## 3 · Event stream contract (this is the interface the backend needs to produce)

The prototype's `EventStream` is throwaway — replace with the real stream. **What the arena renderer needs from you:**

### 3.1 Event shape (target)

```ts
// packages/web/lib/arena/types.ts
export type ArenaEvent = {
  eventId: string;          // unique, stable per-event
  competitionId: string;    // scope
  t: number;                // ms since match start, monotonic
  teamId: 'a' | 'b' | string;  // which gladiator this event belongs to
  type: ArenaEventType;
  // Optional payload for richer UI; renderer doesn't need it
  meta?: {
    filePath?: string;
    toolName?: string;
    reasoningPreview?: string;  // first ~80 chars, for the lane "latest action" ticker
    tokens?: number;
  };
};

export type ArenaEventType =
  | 'REASONING'       // model is thinking → flash: thinking
  | 'TOOL_CALL'       // called a tool / ran exec → flash: power
  | 'FILE_CREATE'     // wrote new file → flash: strike
  | 'FILE_EDIT'       // edited file → flash: strike
  | 'HIT'             // synthetic — only use if backend explicitly wants to choreograph a counter-hit
  | 'PHASE_CHANGE'    // NEW — see §3.3
  | 'SCORE_UPDATE'    // NEW — see §3.4
  | 'MATCH_END';      // NEW — see §3.5
```

### 3.2 The `classifyEvent()` mapping

The prototype hardcodes the `type → flash` mapping in `EVENT_TYPES` at `eventstream.jsx:7`. On port, move this into a single function:

```ts
// packages/web/lib/arena/classify.ts
export function classifyEvent(ev: ArenaEvent): 'thinking' | 'strike' | 'power' | 'hit' | null {
  switch (ev.type) {
    case 'REASONING':   return 'thinking';
    case 'FILE_CREATE': return 'strike';
    case 'FILE_EDIT':   return 'strike';
    case 'TOOL_CALL':   return 'power';
    case 'HIT':         return 'hit';
    default:            return null;  // non-choreographed event (PHASE_CHANGE etc.)
  }
}
```

The renderer reads `classifyEvent()` and `teamId` only. Everything else (`meta`) is for the HUD ticker.

### 3.3 Phase transitions — backend-driven

**In the prototype, phases are time-normalized** (`active 0–80%, freeze 80–85%, judging 85–92%, reveal 92–100%`). This is wrong for production — real matches don't have fixed durations and judging is a real async step.

**Target contract:** backend emits `PHASE_CHANGE` events:

```ts
{ type: 'PHASE_CHANGE', meta: { phase: 'active' | 'freeze' | 'judging' | 'reveal' } }
```

On port, strip `MATCH_PHASES` / `phaseAt()` / `tNorm` from `app.jsx:28-37`. Replace with a `phase` state that updates on `PHASE_CHANGE` events. The scrubber becomes a playback-only control over already-received events, not a timeline that generates them.

### 3.4 Scoring

Scorecards need to animate in during the `reveal` phase. The prototype doesn't show scores yet — it only shows a winner banner. Backend should emit one or more `SCORE_UPDATE` events during `judging` with per-judge scores, then a final `MATCH_END` with the winner.

```ts
{ type: 'SCORE_UPDATE', meta: { judge: 'claude', scores: { a: 87, b: 62 } } }
{ type: 'MATCH_END',    meta: { winner: 'a', finalScores: { a: 87, b: 62 } } }
```

The `WinnerBanner` component (`hud.jsx:101`) already accepts `winner` and `color`; extend it to accept `scores` and render both bars.

### 3.5 Transport

Either websocket or SSE; both work. The renderer treats events as append-only. Late-arriving events (clock drift) are fine — sort by `t` on insert.

**What the frontend must handle:**
- **Replay:** loading a completed match means receiving all events at once, then replaying them on a scrubber. Prototype already models this — `stream.events` is the canonical list, `lastEventIdxRef` walks it.
- **Live tail:** for an in-progress match, the cursor should auto-advance to `now - 500ms` (half-second buffer) so the UI doesn't stutter on event gaps.
- **Seek:** scrubbing backward must reset renderer state (gladiators, particles, ring pulses). The prototype does this by rebuilding renderers in a `useEffect` on scrub; port may want a cheaper reset method on `GladiatorV2` / `ArenaRing` / `Shockwaves`.

---

## 4 · Arena renderer architecture

### 4.1 `GladiatorV2` (`gladiator.jsx:132`)

**Public API:**
```ts
const g = new GladiatorV2({ teamId, build, color, x, y, scale, facing });
g.setBase('idle' | 'thinking');                // steady-state pose
g.setTerminal('triumph' | 'kneel' | 'salute' | null);  // locks pose until cleared
g.flash('strike' | 'power' | 'hit', duration?);        // 400–500ms auto-clear
g.setEnergy(0..1);                             // affects stance aggression
g.update(dtMs, now);
g.draw(ctx);
```

**Pose blending:** 14-joint skeleton (`head, neck, shoulderL/R, elbowL/R, handL/R, hipL/R, kneeL/R, footL/R`). Each named pose is an array of `[x, y]` joints in figure-local space. On state change, `_updateTarget()` picks the right pose (flash > terminal > base) and `update()` lerps `this.current` toward `this.target` at a fixed rate.

**Drawing order (in `draw()`):**
1. Transform (translate to `x,y`, scale, flip on `facing`).
2. Breath y-bob via `Math.sin(breathPhase) * 3.5` (tweakable `breathAmplitude`).
3. Ground shadow ellipse (opacity tracks energy).
4. Legs (capsules hip→knee→foot).
5. Arms (capsules shoulder→elbow→hand).
6. Torso (armored chest plate with center seam + sternum branches + core gem). This is the "it's a figure, not clip-art" element — see `_drawTorso()`.
7. Hip plate.
8. Neck column.
9. Head (helmet with visor slit).
10. Weapon (orbit around handR for idle, thrust for strike).

**Flash states override the pose in `_updateTarget()` priority order:** flash → terminal → base.

### 4.2 `ArenaRing` (`ring.jsx:15`)

Draws the stage: floor grid, inner/outer elliptical rings, tick marks, phase tint, impact pulses.

- `setPhase(phase, winnerColor)` — active = cyan, judging = orange, reveal = winner color. Sets `phaseTint` + eases `phaseIntensity`.
- `pulse(color)` — push a concentric ring pulse (500ms cubic-out decay).
- `drawGrid(ctx, dim)` / `drawRing(ctx)` — split so `drawGrid` happens before gladiators (floor) and `drawRing` happens after (rim glow on top).

### 4.3 `Shockwaves` (`ring.jsx:132`)

Tiny particle system. `spawnShockwave(x, y, color)` emits 1 ring + 8 sparks; `spawnConfetti(x, y, color)` emits 36 victory particles with gravity. One flat `list` array; `update(dt)` ages + prunes, `draw(ctx)` renders in one pass. No object pooling — particle counts are tiny.

### 4.4 `app.jsx` — the match loop

**Main render frame (`app.jsx:160–260`):**
1. Compute `tNorm = cur / durationMs`, derive `phase`.
2. Walk events from `lastEventIdxRef.current` up to `cur`, apply each:
   - `thinking` → `g.setBase('thinking')`, revert in 400–700ms.
   - `strike` / `power` → `g.flash(...)`, `shock.spawnShockwave(opp.x, opp.y-20)`, `ring.pulse(g.color)`, camera nudge, opponent `flash('hit')`.
3. Handle phase transitions:
   - `reveal` → winner `setTerminal('triumph')`, loser `setTerminal('kneel')`, camera zoom, one-shot confetti (`ring._confettiFired` guards it).
   - non-reveal → clear terminals, reset confetti flag.
4. Compute energy per team from `stream.eventsInWindow(cur, 3000)` — count recent events, `min(1, count/5)`.
5. `update(dt)` all renderers, ease camera, clear canvas, apply camera transform, `drawGrid` → gladiators → `drawRing` → `shock.draw`.

**Critical things to know:**
- Momentum is `(countB - countA) / max(1, countA + countB)` over the last 3s. Clamped `[-1, 1]`.
- Camera eases at 0.12/frame toward `tx/tzoom`. Timer-based reset via `window.__camTimer`.
- Winner is decided client-side from total event count (`winnerId = countA >= countB ? 'a' : 'b'`). **On port, winner comes from the `MATCH_END` event.**

### 4.5 HUD components (`hud.jsx`)

All pure-React, no canvas. Small and portable.

- `LaneHeader` — team chip (model + persona) + "latest action" ticker. `latest` is a string the parent updates on each event (see `latestActionRef.current`). On port, drive from `ArenaEvent.meta.reasoningPreview` / `meta.filePath` / `meta.toolName`.
- `MomentumMeter` — horizontal bar. `momentum ∈ [-1, 1]` → gradient between `colorA` and `colorB`. Pointer at center.
- `WinnerBanner` — fade-in overlay during reveal. Needs score extension (§3.4).
- `PhaseChip` — `"TIME'S UP"` / `"JUDGING..."` pill. Hidden during `active` and `reveal` phases.

---

## 5 · Tweaks system

The prototype exposes a Tweaks panel (bottom-right) toggled by the host's **Tweaks** toolbar. It lives entirely in the prototype host environment — **do not port the Tweaks panel itself.** On port, the defaults become app-level design tokens.

Current defaults (locked in after iteration):
```js
{
  strokeWeight: 2.6,
  glowIntensity: 1.0,
  breathAmplitude: 3.5,
  figureScale: 1.8,       // optimal for 1200×640 canvas — full body visible inc. raised arms
  cameraBehavior: 'focus',
  showMomentum: true,
  ringTicks: true,
  backgroundDim: 0.6,
  matchDurationSec: 30,
}
```

On port: bake `figureScale`, `strokeWeight`, `glowIntensity`, `breathAmplitude` into `GladiatorV2` constructor. `matchDurationSec` disappears entirely (see §3.3). `backgroundDim` becomes a tailwind variable. `showMomentum` / `ringTicks` become user prefs if you want; otherwise always-on.

**Protocol used by the prototype host** (skip unless you're extending the prototype, not porting it): registers a `message` listener for `__activate_edit_mode` / `__deactivate_edit_mode`, posts `__edit_mode_available` back, and persists edits via `__edit_mode_set_keys`. The `DEFAULT_TWEAKS` literal is wrapped in `/*EDITMODE-BEGIN*/ … /*EDITMODE-END*/` markers so the host can rewrite defaults to disk.

---

## 6 · Open questions / decisions to make during port

1. **More than 2 fighters.** Prototype is 2-up (Claude vs Gemini). Tournaments can have >2 competitors. Options:
   - **Bracket mode:** render matches 2-at-a-time, show bracket progression between matches. Cheapest. Recommended.
   - **Battle-royale mode:** N gladiators in the ring simultaneously. Requires rethinking camera (follow active striker?), ring layout (polar placement around center), momentum meter (bar → multi-segment). Defer unless there's product pull.
   - **Gauntlet mode:** 1 fighter vs N sequential opponents, one at a time. Trivial on top of bracket mode.
   The current renderer's `x, y, facing` positioning already works for arbitrary placement — `GladiatorV2` has no 2-fighter assumptions baked in. The match loop and HUD do.

2. **Remotion / demo video rendering.** Out of scope for this project. **Do it in a separate Remotion project**: (a) Remotion has a different entry contract (`<Composition />`, fixed FPS), (b) needs `@remotion/cli` + node-side render, (c) the fixed-FPS compositional model doesn't play well with this prototype's event-driven scrubber. The canvas renderers (`GladiatorV2`, `ArenaRing`, `Shockwaves`) are drop-in portable — copy them into the Remotion project and drive them from Remotion's `useCurrentFrame()` instead of the prototype's match loop. Feed the same `ArenaEvent[]` timeline.

3. **Sound.** No audio in prototype. A strike hit + winner fanfare would sell the broadcast metaphor. Defer, but note where: `flash('strike' | 'power')` in the match loop is the hook.

4. **Accessibility.** The prototype has zero a11y affordances. On port: `aria-live` on the "latest action" ticker, pause-on-hover for reduced motion, a "Read match summary" text fallback derived from the event stream.

5. **Mobile.** Canvas scales responsively (`aspectRatio: '1200/640'`, `maxWidth: 1400`). HUD doesn't. On port, collapse the VS header into a stacked layout under 640px and drop the MomentumMeter to a thin bar above the canvas.

---

## 7 · Suggested port order

1. Copy `gladiator.ts`, `ring.ts` into `packages/web/lib/arena/`. Convert from vanilla class to TS; keep APIs identical.
2. Define `ArenaEvent` / `ArenaEventType` / `classifyEvent()` in `lib/arena/types.ts` + `lib/arena/classify.ts`.
3. Build `components/arena/ArenaViewer.tsx` (client component) wrapping the canvas + the four HUD components. Port the render loop from `app.jsx:160–260`.
4. Wire into `app/competitions/[id]/page.tsx`. Use the existing match-fetching hook; transform whatever event shape the backend currently produces into `ArenaEvent[]`.
5. **Backend:** add `PHASE_CHANGE`, `SCORE_UPDATE`, `MATCH_END` events. Replace time-normalized phase machine with event-driven one.
6. Extend `WinnerBanner` to render scores.
7. Apply homepage review edits (§1) in parallel — they're independent.

---

## 8 · Things I intentionally didn't build

- **No score rendering.** Winner banner shows who won, not by how much. Needs backend contract (§3.4) first.
- **No crowd / ambient particles.** Considered, cut for visual clarity. The ring pulses and shockwaves carry the energy.
- **No announcer text overlay.** The "latest action" ticker in `LaneHeader` covers the need without another layer.
- **No real loading/error states.** The prototype assumes events arrive; production needs skeleton + API-down fallback (use the existing dot pattern from the homepage).
- **No replay controls beyond scrub + speed + restart.** Jump-to-event, bookmark, share-timestamp are all obvious follow-ups. Deferred.

---

If anything here is wrong for the real codebase shape, update this file — it's the contract, not the code.
