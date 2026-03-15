# Sprint 7C: Gladiator Upgrade + Reels

**Date:** 2026-03-15
**Status:** Design approved, pending implementation plan
**Goal:** Transform stick-figure gladiators into armored TRON warriors with distinct per-model designs, rich idle animations, and integrate battle clips into Remotion video reels with longer scene durations.

## Part 1: Gladiator Visual Upgrade

### Style Direction: Armored TRON Warriors

Replace the current single-line wireframe stick figures with detailed armored warriors featuring filled polygon plates, angular helmets, flowing circuit traces, energy auras, model-specific weapons, and ground reflections. All Canvas 2D procedural — no external assets.

### Model-Specific Designs

Each AI model gets a distinct silhouette, helmet, weapon, and build proportions:

| Model | Build | Helmet | Weapon | Shoulders | Personality |
|---|---|---|---|---|---|
| **Claude** | Tall, precise (scaleX 1.0, scaleY 1.05) | Tall angular, pointed crown | Identity disc — spinning ring with inner energy pattern | Sharp pauldrons with pointed edges | The strategist |
| **Codex** | Stocky, wide (scaleX 1.12, scaleY 0.95) | Heavy wide, flat top | Dual arm blades — energy edges from forearms with glowing tips | Wide bulky pauldrons | The brawler |
| **Gemini** | Lithe, narrow (scaleX 0.92, scaleY 1.03) | Sleek narrow, pointed | Energy staff — pole weapon with glowing tips + crackling energy | Asymmetric (left larger) | The agile fighter |
| **Default** | Balanced (1.0, 1.0) | Standard hexagonal | No special weapon | Symmetric medium | Generic |

### Shared Armor Elements (all models)

1. **Helmet** — angular polygon (not circle), filled with low alpha, edge-stroked with glow. Visor slit rectangle with high brightness.
2. **Shoulder plates** — filled polygons with edge glow, model-specific shape/size.
3. **Chest plate** — pentagon shape, filled at 10-12% alpha, edge-stroked.
4. **Arms** — double-stroked segments (main stroke + thinner inner stroke for depth).
5. **Hip plate** — small trapezoid between torso and legs.
6. **Shin guards** — rectangular plates on each leg, filled + stroked.
7. **Circuit traces** — animated dashed lines (`setLineDash` + animated `lineDashOffset`) flowing along chest and legs. Speed scales with energy.
8. **Energy aura** — 3 concentric elliptical layers with pulsing radius, very low alpha (0.02-0.03). Size and brightness scale with momentum energy.
9. **Ground reflection** — vertically flipped, scaled to 25% height, 10% alpha copy of the figure drawn below the feet.

### Idle Animations (continuous)

These run constantly, not just during specific poses:

| Animation | What it does | Scales with energy? |
|---|---|---|
| **Breathing bob** | Vertical sine oscillation, 2px amplitude | No (constant) |
| **Weight shift** | Slight horizontal lean, slower sine | No (constant) |
| **Weapon activity** | Claude: disc rotates. Codex: blades pulse. Gemini: staff crackles | Yes — faster at high energy |
| **Circuit flow** | `lineDashOffset` animates, traces appear to flow | Yes — faster at high energy |
| **Aura pulse** | Aura ellipse radius oscillates | Yes — larger at high energy |
| **Visor flicker** | Periodic brief brightness spike on visor (every ~3s) | No |

### Momentum-Driven Intensity

The energy value (0-1) from `EventProcessor` drives visual intensity:

| Energy range | Visual effect |
|---|---|
| 0-0.3 (defensive) | Dim glow (shadowBlur 8), slow circuits, small aura, slight backward lean, weapon dim |
| 0.3-0.7 (neutral) | Medium glow (shadowBlur 14), normal speed, standard aura |
| 0.7-1.0 (aggressive) | Bright glow (shadowBlur 22), fast circuits, large pulsing aura, forward lean, weapon bright, slight scale increase |

### Pose-Specific Enhancements

| Pose | Current | Upgraded |
|---|---|---|
| `idle` | Breathing bob only | Full idle animation suite (weight shift, weapon activity, circuits, aura, visor flicker) |
| `thinking` | Head tilted, arms close | Head tilted, weapon lowered, circuits slow down, aura contracts — contemplative |
| `strike` | Arm extends | Weapon arm snaps forward, projectile launches (disc/blade/staff-tip), armor plates flash bright |
| `power` | Arms wide | Arms wide, energy burst radiates from chest plate, all circuits brighten, aura flares |
| `hit` | Knockback, red flash | Body jolts backward, armor plates flash red, sparks fly off contact point |
| `triumph` | Arms raised | Arms raised, weapon held high, massive particle fountain, aura at max, circuits flowing fast |
| `kneel` | One knee down | Weapon on ground, circuits dim, aura fades to 20% |
| `salute` | Arm extended | Weapon arm extended toward opponent, visor brightens |

### Scale Increase

Current figures are too small in the arena. Increase base scale from ~1.4 to ~2.2 (matching the mockup). Adjust gladiator positioning to account for larger figures.

### Implementation

All changes are in `packages/web/lib/arena/gladiator.ts`. The `GladiatorRenderer` class gets a complete rewrite of the `draw()` method with the new armor drawing code. The joint system and pose interpolation (`update()`) remain the same — only the visual rendering changes.

New helper methods on `GladiatorRenderer`:
- `drawHelmet(ctx)` — model-specific helmet shape
- `drawShoulders(ctx)` — model-specific shoulder plates
- `drawWeapon(ctx)` — model-specific weapon with animation
- `drawArmorPlates(ctx)` — chest plate, hip plate, shin guards
- `drawCircuitTraces(ctx, speed)` — animated dashed lines
- `drawAura(ctx, energy)` — concentric pulsing ellipses
- `drawReflection(ctx)` — ground mirror

Pose data in `packages/web/lib/arena/poses.ts` may need minor adjustments for the larger figure proportions but the 14-joint system stays the same.

**Modified files:**
- `packages/web/lib/arena/gladiator.ts` — complete draw() rewrite
- `packages/web/lib/arena/poses.ts` — minor joint position adjustments for scale

---

## Part 2: Reel Battle Clips

### Concept

Add a "Battle Highlights" scene to the Remotion video reel that replays key competition moments through the upgraded gladiator renderer.

### How It Works

1. **Extract key moments** from the competition's event history — find the most visually interesting events (FILE_CREATEs, TOOL_CALLs, ERRORs) spaced across the competition timeline
2. **Render a Canvas-based Remotion component** that plays the gladiator arena with these events driving the animation
3. **Duration:** 6-8 seconds of battle highlights showing both gladiators reacting to events

### Remotion Integration

The existing Remotion composition at `packages/video/src/compositions/CompetitionRecap.tsx` has 8 scenes totaling 42 seconds. Add a new scene:

| Scene | Frames | Duration | Content |
|---|---|---|---|
| **BattleHighlights** (new) | After Matchup, before KeyMoments | 6s (180 frames) | Canvas arena with gladiators reacting to 4-6 key events |

The Canvas rendering code from `packages/web/lib/arena/` can't be imported directly into Remotion (different build pipeline). Instead, create a **Remotion-compatible version** of the gladiator renderer in `packages/video/src/components/`:
- `BattleScene.tsx` — Remotion component using `useCurrentFrame()` to drive animation
- `VideoGladiator.ts` — simplified gladiator renderer adapted for Remotion's frame-based rendering (no `requestAnimationFrame`, uses frame number directly)
- Reuse the pose definitions from the web package via `@arena/shared` or duplicate the data (poses are just coordinate arrays)

### Event Replay in Remotion

The `ReelData` type already contains team info and scores. Add a `keyEvents` field:

```ts
interface ReelKeyEvent {
  frameOffset: number;  // which frame of the 180-frame scene this event fires
  teamId: string;
  type: 'strike' | 'power' | 'hit';
}
```

The reel API route (`POST /api/competitions/:id/reel`) extracts 4-6 key events from the competition's event history, maps them to frame offsets, and includes them in `ReelData`.

### Scene Design

- Dark TRON arena background with perspective grid (same as live view)
- Two gladiators in face-off position (or ring for N teams)
- Events trigger flash animations at their frame offsets
- Camera doesn't move — static framing
- Team labels and a "BATTLE HIGHLIGHTS" title overlay

---

## Part 3: Longer Reel Durations

### Current Timing (42s total, 1260 frames at 30fps)

| Scene | Frames | Duration |
|---|---|---|
| IntroBumper | 0-90 | 3s |
| Matchup | 90-210 | 4s |
| TheBrief | 210-330 | 4s |
| KeyMoments | 330-570 | 8s |
| ScoreReveal | 570-900 | 11s |
| Winner | 900-990 | 3s |
| GoDeeper | 990-1170 | 6s |
| Outro | 1170-1260 | 3s |

### New Timing (~65s total, 1950 frames at 30fps)

| Scene | Frames | Duration | Change |
|---|---|---|---|
| IntroBumper | 0-120 | 4s | +1s |
| Matchup | 120-300 | 6s | +2s |
| **BattleHighlights** | 300-480 | **6s** | **NEW** |
| TheBrief | 480-660 | 6s | +2s |
| KeyMoments | 660-960 | 10s | +2s |
| ScoreReveal | 960-1380 | 14s | +3s |
| Winner | 1380-1500 | 4s | +1s |
| GoDeeper | 1500-1770 | 9s | +3s |
| Outro | 1770-1950 | 6s | +3s |

Key changes:
- Total duration: 42s → 65s (+23s, +55%)
- Every scene gets more breathing room
- ScoreReveal gets the most extra time (+3s) since it has the most text to read
- BattleHighlights is a new 6s scene

---

## File Inventory

### New Files

| File | Purpose |
|---|---|
| `packages/video/src/scenes/BattleHighlights.tsx` | Remotion scene: canvas arena with gladiator event replay |
| `packages/video/src/components/VideoGladiator.ts` | Frame-based gladiator renderer for Remotion |

### Modified Files

| File | Change |
|---|---|
| `packages/web/lib/arena/gladiator.ts` | Complete draw() rewrite with armor, weapons, circuits, aura |
| `packages/web/lib/arena/poses.ts` | Minor joint adjustments for larger scale |
| `packages/video/src/compositions/CompetitionRecap.tsx` | Add BattleHighlights scene, update all frame timings |
| `packages/video/src/types.ts` | Add `keyEvents` to ReelData |
| `packages/web/app/api/competitions/[id]/reel/route.ts` | Extract key events for ReelData |

### Unchanged

- Event processor, particle system, arena types
- BattleArena.tsx component (uses GladiatorRenderer, gets upgraded visuals automatically)
- All backend code
- TopBar, Stats page, gallery

---

## Success Criteria

1. Gladiators look like armored TRON warriors, not stick figures
2. Each model (Claude/Codex/Gemini) is visually distinct — different helmet, weapon, build
3. Idle animations run continuously — weapon activity, circuit flow, aura pulse, weight shift
4. Energy/momentum visibly affects figure intensity (dim vs bright)
5. Ground reflections visible beneath each figure
6. Figures scaled up ~50% from current size
7. Reel includes a 6s BattleHighlights scene with gladiator animations
8. All reel scenes have longer durations (65s total vs 42s)
9. No performance regression — Canvas 2D stays at 60fps
