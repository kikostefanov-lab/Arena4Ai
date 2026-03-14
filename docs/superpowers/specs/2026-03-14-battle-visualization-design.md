# Sprint 6: Live Battle Visualization

**Date:** 2026-03-14
**Status:** Design approved, pending implementation plan
**Goal:** Replace the scrolling event log on the live competition page with an animated TRON gladiator battle driven by real-time WebSocket events.

## Problem Statement

The current live competition view shows two columns of scrolling event rows (REASONING, FILE_CREATE, TOOL_CALL). User feedback: "boring." The scrolling text doesn't convey the energy, competition, or narrative of two AI agents racing to solve a problem. Users can't glance at it and understand who's winning or what's happening.

## Solution

A Canvas 2D arena with procedural wireframe TRON gladiators that react to live events. Each agent is a glowing geometric humanoid figure with team-colored animations driven by a momentum system. The event log becomes a collapsible mini-panel, not the main show.

## Architecture Overview

```
WebSocket events (existing stream, unchanged)
    │
    ▼
┌──────────────────────────┐
│  EventProcessor          │
│  - Classifies events     │
│  - Updates momentum/team │
│  - Emits animation cmds  │
└──────────┬───────────────┘
           │ { pose, energy, action, particles }
           ▼
┌──────────────────────────┐
│  BattleArena (React)     │
│  - Canvas 2D renderer    │
│  - requestAnimationFrame │
│  - GladiatorRenderer ×N  │
│  - ParticleSystem        │
│  - HTML HUD overlay      │
└──────────────────────────┘
```

**No backend changes.** The WebSocket stream and event data are unchanged. All visualization logic is client-side React + Canvas 2D.

---

## Components

### File Structure

| File | Purpose |
|---|---|
| `packages/web/components/BattleArena.tsx` | Main React component: Canvas + HUD overlay, animation loop, event integration |
| `packages/web/lib/arena/gladiator.ts` | `GladiatorRenderer` class: draws one wireframe figure, manages joint positions, interpolates poses |
| `packages/web/lib/arena/poses.ts` | Joint position definitions for all 8 poses × 3 model silhouettes |
| `packages/web/lib/arena/event-processor.ts` | `EventProcessor` class: raw events → per-team animation state + momentum |
| `packages/web/lib/arena/particles.ts` | `ParticleSystem` class: spawn/update/draw short-lived visual effects |
| `packages/web/lib/arena/types.ts` | Shared types: `AnimationState`, `TeamMomentum`, `Pose`, `JointPositions` |

### Modified Files

| File | Change |
|---|---|
| `packages/web/app/competitions/[id]/page.tsx` | Add view toggle (Battle/Log), render `BattleArena` as default view |

---

## Gladiator Design

### Procedural Wireframe Figures

Each gladiator is drawn with ~20 line segments + 2-3 arcs on Canvas 2D. Team color applied to all strokes with `shadowBlur` for glow effect.

**Joint system:** 12 points define the figure — head, neck, shoulders (L/R), elbows (L/R), hands (L/R), hips (L/R), knees (L/R), feet (L/R). Each pose is a set of (x, y) offsets from the figure's center. Transitions between poses interpolate each joint via lerp over ~300ms.

### Model Silhouettes (3 distinct builds)

| Model prefix | Build | Distinguishing features |
|---|---|---|
| `claude` | Tall, angular shoulders | Disc weapon, precise stance, upright posture |
| `codex` | Stocky, wide stance | Dual-blade arms, aggressive lean, broad shoulders |
| `gemini` | Lithe, asymmetric | One arm longer, fluid stance, narrow frame |
| Fallback | Balanced/generic | Neutral proportions, no weapon accent |

Model prefix is extracted from `team.model` (e.g., `claude:architect` → `claude`). The persona (`:architect`) does not affect the silhouette.

### Animation States (8 total)

| State | Visual | Duration | Trigger |
|---|---|---|---|
| `idle` | Subtle breathing bob, low glow | Continuous | Default, long pauses |
| `thinking` | Head tilted, arms close, pulsing aura | Continuous | Sustained REASONING events |
| `strike` | Arm extends, projectile flies toward center | 500ms flash | FILE_CREATE |
| `power` | Arms wide, energy orb charges above head | 500ms flash | TOOL_CALL |
| `hit` | Knockback, red flash | 400ms flash | ERROR on this team |
| `triumph` | Arms raised, particle explosion in team color | Hold | Winner at competition end |
| `kneel` | One knee down, head bowed, glow fades to 20% | Hold | Loser at competition end |
| `salute` | Arm extended toward opponent | Hold | Tie at competition end |

**Flash vs. Continuous:** `strike`, `power`, and `hit` are transient — they play for their duration then return to the current base stance. `idle`, `thinking`, `triumph`, `kneel`, `salute` are sustained until replaced.

---

## Momentum System

Each team has a momentum state:

```ts
interface TeamMomentum {
  energy: number;       // 0–1, decays over time
  basePose: 'idle' | 'thinking';  // driven by energy level and recent event types
  terminalPose?: 'triumph' | 'kneel' | 'salute';  // set at competition end, overrides basePose
  lastEventTime: number;
  eventCounts: { reasoning: number; fileCreate: number; toolCall: number; error: number };
}
```

**Energy rules:**
- FILE_CREATE: +0.15
- TOOL_CALL: +0.10
- REASONING: +0.02
- ERROR: −0.10
- Decay: −0.01 per second (continuous)
- Clamped to [0, 1]

**Posture from energy:**
- Energy > 0.7 → aggressive (leaning forward, brighter glow, slightly larger scale)
- Energy 0.3–0.7 → neutral
- Energy < 0.3 → defensive (leaning back, dimmer glow, slightly smaller scale)

**Base pose selection:**
- If last 5 events are all REASONING → `thinking`
- Otherwise → `idle`

Individual events trigger flash animations on top of the base pose. The flash plays, then the figure returns to the current base stance smoothly.

---

## Competition End Sequence

Mapped to competition lifecycle states:

| Competition State | Arena Phase | Visual |
|---|---|---|
| `RUNNING` | Active battle | Normal momentum-driven animation |
| `TIME_UP` | Freeze | Gladiators hold current pose, glow dims to 50%, particles stop. HUD: "TIME'S UP" |
| `COLLECTING` | Freeze (continued) | Same as TIME_UP — agents have stopped working |
| `PRESENTING` | Judging | Figures return to `idle`, scanning beam sweeps arena. HUD: "ANALYZING..." |
| `JUDGING` | Judging (continued) | Same scanning beam. HUD: "JUDGING..." |
| `SCORED` / `COMPLETE` | Winner reveal | Winner → `triumph` (arms raised, particle explosion). Loser → `kneel` (one knee, glow fades). Arena floor floods with winner's color. Scores fade in above heads. |
| Tie at `SCORED` | Salute | Both play `salute` (arm extended toward each other), neither kneels. Arena stays neutral. |

The `terminalPose` field on the animation state overrides momentum-driven posing entirely once set. Terminal poses (`triumph`, `kneel`, `salute`) are sticky — they hold until the user navigates away.

Timing: Freeze holds through COLLECTING → Judging holds through PRESENTING/JUDGING → Reveal holds at SCORED/COMPLETE.

---

## Arena Layout

### 2-Team Layout (most common)

```
┌─────────────────────────────────────────────────────┐
│  CLAUDE :architect    ⏱ 3:42    CODEX :speedrunner  │
│  ████████░░ 67%       ● LIVE    ███████░░░ 58%      │
│                                                      │
│              🟠           🔵                         │
│           [gladiator]  [gladiator]                    │
│              ╲           ╱                            │
│               ╲─────────╱                            │
│            ═══════════════════                        │
│                                                      │
│  ▸ Creating server.ts...              📄 12 ⚡ 4 🧠 89│
├─────────────────────────────────────────────────────┤
│  ▾ Event Log                                         │
│  3m12s  FILE_CREATE  app/server.ts                   │
│  3m05s  TOOL_CALL    npm install express             │
│  2m58s  REASONING    Planning route structure...     │
└─────────────────────────────────────────────────────┘
```

- Canvas: full width, 60-70vh height
- Gladiators positioned at 30% and 70% horizontal, facing each other
- TRON perspective grid floor beneath them
- Arena boundary: glowing ellipse on the floor

### N-Team Layout (3-4 teams, ring formation)

```
         🟠 CLAUDE
        ╱    ╲
       ╱      ╲
   🟢 ╱────────╲ 🔵
  GEMINI        CODEX
```

- Gladiators arranged in a regular polygon (triangle for 3, square for 4)
- Each faces the center of the arena
- Energy bars and labels arrayed around the outside
- Same floor grid, circular boundary

### TRON Grid Floor

Perspective-transformed grid lines converging toward a vanishing point (slightly above center). Drawn on canvas with `rgba(0,240,255,0.07)` lines. Arena boundary is a glowing ellipse at the gladiators' feet.

### HUD (HTML overlay, positioned absolute over canvas)

| Element | Position | Content |
|---|---|---|
| Team names + persona | Top left/right (2-team) or arrayed (N-team) | `CLAUDE :architect` in team color |
| Energy bars | Below team names | Animated width bar, team color fill |
| Timer | Top center | `⏱ 3:42` countdown |
| LIVE indicator | Next to timer | Pulsing green dot + "LIVE" |
| Latest action | Bottom left/right per team | `▸ Creating server.ts...` in team color |
| Event counters | Bottom corners | `📄 12  ⚡ 4  🧠 89` |
| Mini-log | Bottom panel, collapsible | Last 5-8 events, slides up/down |

### Mini Event Log

- Collapsible panel at bottom of the arena (toggle via ▾/▴ button)
- Shows last 5-8 events across all teams
- Each row: timestamp, event type badge, team color dot, truncated text
- Uses the existing `EventRow` component styling but simplified
- Default: expanded. Remembers toggle state in localStorage.

### View Toggle

A button in the competition header bar (alongside existing Pause/Cancel/Brief buttons):
- `⚔ Battle` / `📋 Log`
- Switches between `BattleArena` and the existing per-team event columns
- Default: Battle view
- Remembers preference in localStorage

---

## Canvas Rendering

**Engine:** Canvas 2D with `requestAnimationFrame` at 60fps.

**Render order (back to front):**
1. Background fill (`#000408`)
2. Grid floor (perspective lines)
3. Arena boundary (glowing ellipse)
4. Particles (behind figures)
5. Gladiators (sorted by y-position for depth)
6. Particles (in front of figures)
7. HUD is HTML overlay, not canvas-drawn

**Gladiator rendering per frame:**
1. Read current `TeamMomentum` for this team
2. Compute target joint positions from current base pose + any active flash
3. Lerp current joint positions toward target (300ms interpolation)
4. Apply energy-based transforms (scale, lean, glow intensity)
5. Draw lines between joints with `strokeStyle = teamColor`, `shadowBlur = 8-20` (based on energy)
6. Draw accent details: visor, circuit lines, weapon glow

**Particle types:**
| Type | Visual | Spawned by |
|---|---|---|
| `strike_projectile` | Small glowing disc flying toward center | FILE_CREATE / FILE_MODIFY flash |
| `power_burst` | Expanding ring of dots | TOOL_CALL flash |
| `impact_sparks` | Scattered dots at impact point | Strike hitting center |
| `hit_sparks` | Red scattered dots at figure position | ERROR (supplements the `hit` flash on the figure) |
| `triumph_explosion` | Fountain of team-colored particles | Winner reveal |

**Note:** The `hit` flash animation (on the gladiator figure) and `hit_sparks` particle are complementary — the flash handles the figure's knockback/red tint, the particle adds scattered red dots around the figure. They work together, not in conflict.

Particle cap: 50 active at any time. Oldest particles removed when cap is exceeded.

---

## Event Processing

```ts
// packages/web/lib/arena/event-processor.ts

interface AnimationCommand {
  teamId: string;
  flash?: 'strike' | 'power' | 'hit';   // transient 500ms animation
  basePose?: 'idle' | 'thinking';         // sustained pose change
  terminalPose?: 'triumph' | 'kneel' | 'salute';  // end-of-competition override
  particle?: 'strike_projectile' | 'power_burst' | 'hit_sparks';
}

class EventProcessor {
  private momentum: Map<string, TeamMomentum>;

  /** Process a raw ArenaEvent, update momentum, return animation command */
  processEvent(event: { type: string; teamId: string; payload?: any }): AnimationCommand | null;

  /** Called every frame — handles energy decay and base pose updates */
  tick(deltaMs: number): AnimationCommand[];
}
```

**Event classification:**
- `REASONING` → energy +0.02, update base pose if 5+ consecutive
- `FILE_CREATE` → energy +0.15, flash `strike`, particle `strike_projectile`
- `FILE_MODIFY` → energy +0.12, flash `strike`, particle `strike_projectile` (same as FILE_CREATE — editing files is equally productive)
- `TOOL_CALL` → energy +0.10, flash `power`, particle `power_burst`
- `ERROR` → energy −0.10, flash `hit`, particle `hit_sparks`
- `COMMENTARY` → no animation (displayed in HUD as text overlay)
- All other event types → energy +0.01, no animation

**On initial mount:** If the user switches to Battle view mid-competition, skip animation processing for historical events — only update momentum/energy values. Animate only events arriving after mount to avoid a frame spike from processing 600+ buffered events.

**Design tokens:** All colors must be imported from `packages/web/lib/design-tokens.ts` (`MODEL_COLORS`, `BG_DARK`, `TEXT_PRIMARY`, etc.) — never hardcode hex values. Team colors resolved via `getModelColor(team.model)` or equivalent.

---

## Integration with Competition Page

### Current State

`packages/web/app/competitions/[id]/page.tsx` renders:
- Header bar with competition title, state badge, action buttons
- Per-team columns with scrolling `EventRow` components
- WebSocket connection that receives events and updates state

### Changes

1. **Add view toggle button** to the header bar (next to existing buttons):
   ```tsx
   const [viewMode, setViewMode] = useState<'battle' | 'log'>(
     () => localStorage.getItem('arena-view-mode') as any ?? 'battle'
   );
   ```

2. **Conditionally render** either `<BattleArena>` or the existing event columns:
   ```tsx
   {viewMode === 'battle' ? (
     <BattleArena
       teams={competition.teams}
       events={events}
       state={competition.state}
       elapsedMs={elapsedMs}
       timeLimitMs={competition.brief.timeLimitMs}
     />
   ) : (
     // existing per-team event columns
   )}
   ```

3. **Props interface:**
   ```ts
   interface BattleArenaProps {
     teams: Team[];
     events: ArenaEvent[];           // full event buffer (existing)
     state: CompetitionState;        // for end sequence triggers
     elapsedMs: number;              // for timer display
     timeLimitMs: number;
     scores?: Scorecard[];           // for winner reveal
   }
   ```

4. The `BattleArena` component manages its own `EventProcessor` and animation loop internally. It reads from the `events` prop (which is already maintained by the page's WebSocket handler) and processes new events as they arrive.

---

## Performance Considerations

- Canvas 2D is lightweight — wireframe figures are ~20 draw calls each
- Particle cap at 50 prevents runaway allocation
- `requestAnimationFrame` auto-pauses when tab is hidden
- HTML HUD overlay avoids expensive canvas text rendering
- Mini-log capped at 8 DOM elements
- No WebGL, no Three.js, no heavy dependencies — pure Canvas 2D + React

---

## What's NOT Changing

- WebSocket event stream — unchanged
- Event data format — unchanged
- Backend/orchestrator — no changes
- Existing event log — still accessible via toggle
- Competition header bar — same layout, just adding the view toggle button
- Score drawer / results tabs — unchanged
- Remotion reels — unchanged (post-completion video, separate system)

---

## Success Criteria

1. Default live view is the animated battle, not scrolling text
2. Users can glance at the arena and understand: who's active, who's ahead in momentum, what's happening
3. End sequence clearly communicates the winner with dramatic flair
4. 3-4 team ring formation works visually
5. Users who prefer text can toggle to log view (preference persisted)
6. No noticeable performance impact (60fps maintained)
7. Mobile: graceful fallback to log view (canvas may be too small)
