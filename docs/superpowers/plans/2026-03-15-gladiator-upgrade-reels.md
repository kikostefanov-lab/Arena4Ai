# Sprint 7C: Gladiator Upgrade + Reels — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform stick-figure gladiators into armored TRON warriors with model-specific weapons, rich idle animations, and integrate battle clips into Remotion reels with longer scene durations.

**Architecture:** Part 1 rewrites `gladiator.ts` draw methods with armor plates, helmets, weapons, circuit traces, auras, and ground reflections — the 14-joint pose system and animation state machine stay unchanged. Part 2 adds a frame-based gladiator renderer for Remotion and a new BattleHighlights scene. Part 3 stretches all scene durations from 42s→65s and updates Root.tsx registration.

**Tech Stack:** Canvas 2D (procedural), React, Remotion 4.x (frame-based rendering), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-15-gladiator-upgrade-reels-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `packages/video/src/components/VideoGladiator.ts` | Frame-based gladiator renderer for Remotion (no rAF, uses frame number) |
| `packages/video/src/scenes/BattleHighlights.tsx` | Remotion scene: canvas arena with gladiator event replay |

### Modified Files

| File | Change |
|---|---|
| `packages/web/lib/arena/gladiator.ts` | Complete `draw()` rewrite — armor, weapons, circuits, aura, reflection. Add helper methods. Increase base scale. |
| `packages/web/lib/arena/poses.ts` | Adjust joint positions for larger scale (minor coordinate tweaks) |
| `packages/video/src/types.ts` | Add `ReelKeyEvent` type and `keyEvents` field to `ReelData` |
| `packages/video/src/compositions/CompetitionRecap.tsx` | Add BattleHighlights scene, update all 9 scene frame ranges to 65s total |
| `packages/video/src/Root.tsx` | Update total duration from 1260 → 1950 frames |
| `packages/web/app/api/competitions/[id]/reel/route.ts` | Extract key events from competition history, add to `ReelData` |

### Unchanged

| File | Why |
|---|---|
| `packages/web/lib/arena/types.ts` | No new types needed — `ModelBuild`, `PoseName`, `JointPositions` all sufficient |
| `packages/web/lib/arena/event-processor.ts` | Energy/pose logic unchanged — gladiator upgrade is visual only |
| `packages/web/lib/arena/particles.ts` | Particle system unchanged |
| `packages/web/components/BattleArena.tsx` | Uses `GladiatorRenderer` — gets upgraded visuals automatically via `draw()` |

---

## Chunk 1: Gladiator Armor Upgrade (Web)

### Task 1: Add armor drawing helpers to GladiatorRenderer

**Files:**
- Modify: `packages/web/lib/arena/gladiator.ts:1-244`

This task adds 7 new private helper methods to the `GladiatorRenderer` class without changing the existing `draw()` method yet. Each helper is self-contained and testable visually.

- [ ] **Step 1: Add model-specific constants and types at the top of the file**

After the existing constants (line 10), add:

```ts
/** Per-model visual config for armor rendering */
interface ModelVisuals {
  helmetStyle: 'tall-crown' | 'heavy-flat' | 'sleek-pointed' | 'hexagonal';
  weaponType: 'disc' | 'dual-blades' | 'staff' | 'none';
  shoulderStyle: 'sharp' | 'bulky' | 'asymmetric' | 'symmetric';
}

const MODEL_VISUALS: Record<ModelBuild, ModelVisuals> = {
  claude:  { helmetStyle: 'tall-crown',    weaponType: 'disc',        shoulderStyle: 'sharp' },
  codex:   { helmetStyle: 'heavy-flat',    weaponType: 'dual-blades', shoulderStyle: 'bulky' },
  gemini:  { helmetStyle: 'sleek-pointed', weaponType: 'staff',       shoulderStyle: 'asymmetric' },
  default: { helmetStyle: 'hexagonal',     weaponType: 'none',        shoulderStyle: 'symmetric' },
};
```

- [ ] **Step 2: Add `drawHelmet()` helper method**

Add after the existing `drawLine()` method (after line 242). Each model gets a distinct helmet polygon:

```ts
/** Draw model-specific angular helmet around the head joint */
private drawHelmet(ctx: CanvasRenderingContext2D, headX: number, headY: number, r: number, g: number, b: number): void {
  const visuals = MODEL_VISUALS[this.build];
  ctx.save();
  ctx.translate(headX, headY);

  // Helmet shell — filled polygon
  ctx.beginPath();
  switch (visuals.helmetStyle) {
    case 'tall-crown': // Claude — tall angular with pointed crown
      ctx.moveTo(0, -12);    // crown tip
      ctx.lineTo(7, -8);
      ctx.lineTo(8, -2);
      ctx.lineTo(7, 4);
      ctx.lineTo(-7, 4);
      ctx.lineTo(-8, -2);
      ctx.lineTo(-7, -8);
      break;
    case 'heavy-flat': // Codex — wide, heavy, flat top
      ctx.moveTo(-9, -7);
      ctx.lineTo(9, -7);
      ctx.lineTo(10, -2);
      ctx.lineTo(8, 4);
      ctx.lineTo(-8, 4);
      ctx.lineTo(-10, -2);
      break;
    case 'sleek-pointed': // Gemini — narrow, sleek, pointed
      ctx.moveTo(0, -11);   // sharp tip
      ctx.lineTo(6, -6);
      ctx.lineTo(6, 2);
      ctx.lineTo(4, 5);
      ctx.lineTo(-4, 5);
      ctx.lineTo(-6, 2);
      ctx.lineTo(-6, -6);
      break;
    case 'hexagonal': // Default — standard hex
    default:
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const px = Math.cos(angle) * 8;
        const py = Math.sin(angle) * 8;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      break;
  }
  ctx.closePath();
  ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
  ctx.fill();
  ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Visor slit — bright horizontal rectangle
  ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
  ctx.fillRect(-5, -2, 10, 2);

  ctx.restore();
}
```

- [ ] **Step 3: Add `drawShoulders()` helper method**

```ts
/** Draw model-specific shoulder plates */
private drawShoulders(
  ctx: CanvasRenderingContext2D,
  shoulderLX: number, shoulderLY: number,
  shoulderRX: number, shoulderRY: number,
  r: number, g: number, b: number,
): void {
  const visuals = MODEL_VISUALS[this.build];
  ctx.save();
  ctx.fillStyle = `rgba(${r},${g},${b},0.15)`;
  ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`;
  ctx.lineWidth = 1.2;

  const drawPlate = (cx: number, cy: number, mirror: boolean) => {
    ctx.beginPath();
    const m = mirror ? -1 : 1;
    switch (visuals.shoulderStyle) {
      case 'sharp': // Claude — pointed edges
        ctx.moveTo(cx, cy - 4);
        ctx.lineTo(cx + m * 10, cy - 6);
        ctx.lineTo(cx + m * 12, cy);
        ctx.lineTo(cx + m * 8, cy + 3);
        ctx.lineTo(cx, cy + 2);
        break;
      case 'bulky': // Codex — wide rounded
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx + m * 12, cy - 5);
        ctx.lineTo(cx + m * 14, cy);
        ctx.lineTo(cx + m * 12, cy + 4);
        ctx.lineTo(cx, cy + 3);
        break;
      case 'asymmetric': // Gemini — left larger than right
        const size = mirror ? 11 : 8; // left shoulder larger
        ctx.moveTo(cx, cy - 4);
        ctx.lineTo(cx + m * size, cy - 3);
        ctx.lineTo(cx + m * (size + 1), cy + 1);
        ctx.lineTo(cx + m * (size - 2), cy + 4);
        ctx.lineTo(cx, cy + 2);
        break;
      case 'symmetric':
      default:
        ctx.moveTo(cx, cy - 3);
        ctx.lineTo(cx + m * 8, cy - 3);
        ctx.lineTo(cx + m * 9, cy + 1);
        ctx.lineTo(cx + m * 6, cy + 3);
        ctx.lineTo(cx, cy + 2);
        break;
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  drawPlate(shoulderLX, shoulderLY, true);  // left — mirrored
  drawPlate(shoulderRX, shoulderRY, false); // right — normal
  ctx.restore();
}
```

- [ ] **Step 4: Add `drawArmorPlates()` helper method**

Chest plate (pentagon), hip plate (trapezoid), shin guards (rectangles):

```ts
/** Draw chest plate, hip plate, and shin guards */
private drawArmorPlates(
  ctx: CanvasRenderingContext2D,
  joints: JointPositions,
  r: number, g: number, b: number,
): void {
  ctx.save();
  ctx.fillStyle = `rgba(${r},${g},${b},0.10)`;
  ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`;
  ctx.lineWidth = 1;

  // Chest plate — pentagon from shoulders to mid-torso
  const hipMidX = (joints.hipL[0] + joints.hipR[0]) / 2;
  const hipMidY = (joints.hipL[1] + joints.hipR[1]) / 2;
  const chestMidY = (joints.neck[1] + hipMidY) / 2;
  ctx.beginPath();
  ctx.moveTo(joints.shoulderL[0] + 2, joints.shoulderL[1]);
  ctx.lineTo(joints.shoulderR[0] - 2, joints.shoulderR[1]);
  ctx.lineTo(joints.shoulderR[0] - 1, chestMidY);
  ctx.lineTo(hipMidX, chestMidY + 6);
  ctx.lineTo(joints.shoulderL[0] + 1, chestMidY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Hip plate — small trapezoid
  ctx.beginPath();
  ctx.moveTo(joints.hipL[0] + 2, joints.hipL[1] - 2);
  ctx.lineTo(joints.hipR[0] - 2, joints.hipR[1] - 2);
  ctx.lineTo(joints.hipR[0] - 1, joints.hipR[1] + 4);
  ctx.lineTo(joints.hipL[0] + 1, joints.hipL[1] + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Shin guards — rectangles on each lower leg
  for (const [knee, foot] of [[joints.kneeL, joints.footL], [joints.kneeR, joints.footR]] as const) {
    const mx = (knee[0] + foot[0]) / 2;
    const my = (knee[1] + foot[1]) / 2;
    ctx.beginPath();
    ctx.rect(mx - 3, my - 6, 6, 12);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}
```

- [ ] **Step 5: Add `drawWeapon()` helper method**

Model-specific animated weapons. Uses `this.breathPhase` for animation:

```ts
/** Draw model-specific weapon with energy-driven animation */
private drawWeapon(
  ctx: CanvasRenderingContext2D,
  joints: JointPositions,
  r: number, g: number, b: number,
  energy: number,
): void {
  const visuals = MODEL_VISUALS[this.build];
  if (visuals.weaponType === 'none') return;

  ctx.save();
  const phase = this.breathPhase;
  const brightness = 0.4 + energy * 0.5; // 0.4–0.9

  switch (visuals.weaponType) {
    case 'disc': { // Claude — spinning identity disc near right hand
      const hx = joints.handR[0];
      const hy = joints.handR[1];
      ctx.translate(hx, hy);
      const rotation = phase * (1 + energy * 2); // faster spin at high energy
      ctx.rotate(rotation);
      // Outer ring
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r},${g},${b},${brightness})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Inner energy pattern — 3 spokes
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI * 2 / 3) * i;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 5, Math.sin(a) * 5);
        ctx.strokeStyle = `rgba(${r},${g},${b},${brightness * 0.6})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      break;
    }
    case 'dual-blades': { // Codex — energy blades extending from forearms
      for (const hand of [joints.handL, joints.handR] as const) {
        const elbow = hand === joints.handL ? joints.elbowL : joints.elbowR;
        // Blade direction: elbow → hand, extended
        const dx = hand[0] - elbow[0];
        const dy = hand[1] - elbow[1];
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / len;
        const ny = dy / len;
        const bladeLen = 12 + energy * 4; // 12–16px
        const tipX = hand[0] + nx * bladeLen;
        const tipY = hand[1] + ny * bladeLen;
        // Blade edge
        ctx.beginPath();
        ctx.moveTo(hand[0], hand[1]);
        ctx.lineTo(tipX, tipY);
        ctx.strokeStyle = `rgba(${r},${g},${b},${brightness})`;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
        ctx.shadowBlur = 6 + energy * 8;
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Glowing tip
        ctx.beginPath();
        ctx.arc(tipX, tipY, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${brightness})`;
        ctx.fill();
      }
      break;
    }
    case 'staff': { // Gemini — pole weapon with glowing tips
      const hx = joints.handR[0];
      const hy = joints.handR[1];
      const staffLen = 28;
      const angle = -Math.PI / 6; // angled
      const topX = hx + Math.cos(angle) * staffLen / 2;
      const topY = hy + Math.sin(angle) * staffLen / 2;
      const botX = hx - Math.cos(angle) * staffLen / 2;
      const botY = hy - Math.sin(angle) * staffLen / 2;
      // Shaft
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(botX, botY);
      ctx.strokeStyle = `rgba(${r},${g},${b},${brightness * 0.7})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Glowing tips
      for (const [tx, ty] of [[topX, topY], [botX, botY]]) {
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${brightness})`;
        ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
        ctx.shadowBlur = 8 + energy * 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      // Crackling energy between tips (when energy > 0.4)
      if (energy > 0.4) {
        const midX = (topX + botX) / 2;
        const midY = (topY + botY) / 2;
        const jitter = Math.sin(phase * 8) * 3;
        ctx.beginPath();
        ctx.moveTo(topX, topY);
        ctx.quadraticCurveTo(midX + jitter, midY + jitter, botX, botY);
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.2 + energy * 0.3})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      break;
    }
  }

  ctx.restore();
}
```

- [ ] **Step 6: Add `drawCircuitTraces()` helper method**

Animated dashed lines along chest and legs:

```ts
/** Draw animated circuit traces flowing along body */
private drawCircuitTraces(
  ctx: CanvasRenderingContext2D,
  joints: JointPositions,
  r: number, g: number, b: number,
  energy: number,
): void {
  ctx.save();
  const speed = 0.5 + energy * 2; // dash animation speed
  const dashOffset = this.breathPhase * 20 * speed;
  ctx.setLineDash([4, 6]);
  ctx.lineDashOffset = -dashOffset;
  ctx.strokeStyle = `rgba(${r},${g},${b},${0.15 + energy * 0.2})`;
  ctx.lineWidth = 0.8;

  const hipMidX = (joints.hipL[0] + joints.hipR[0]) / 2;
  const hipMidY = (joints.hipL[1] + joints.hipR[1]) / 2;

  // Chest trace — neck to hip center
  ctx.beginPath();
  ctx.moveTo(joints.neck[0] + 2, joints.neck[1] + 2);
  ctx.lineTo(hipMidX + 2, hipMidY);
  ctx.stroke();

  // Second chest trace (cross)
  ctx.beginPath();
  ctx.moveTo(joints.neck[0] - 2, joints.neck[1] + 2);
  ctx.lineTo(hipMidX - 2, hipMidY);
  ctx.stroke();

  // Left leg trace
  ctx.beginPath();
  ctx.moveTo(joints.hipL[0], joints.hipL[1]);
  ctx.lineTo(joints.kneeL[0], joints.kneeL[1]);
  ctx.lineTo(joints.footL[0], joints.footL[1]);
  ctx.stroke();

  // Right leg trace
  ctx.beginPath();
  ctx.moveTo(joints.hipR[0], joints.hipR[1]);
  ctx.lineTo(joints.kneeR[0], joints.kneeR[1]);
  ctx.lineTo(joints.footR[0], joints.footR[1]);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.restore();
}
```

- [ ] **Step 7: Add `drawAura()` helper method**

Concentric pulsing ellipses:

```ts
/** Draw energy aura — concentric pulsing ellipses scaled by energy */
private drawAura(
  ctx: CanvasRenderingContext2D,
  centerX: number, centerY: number,
  r: number, g: number, b: number,
  energy: number,
): void {
  if (energy < 0.05) return; // no aura when dormant
  ctx.save();
  const pulse = Math.sin(this.breathPhase * 1.5);
  const layers = 3;
  for (let i = 0; i < layers; i++) {
    const baseRadius = 30 + i * 15;
    const radius = baseRadius * (0.8 + energy * 0.6) + pulse * 3 * (i + 1);
    const alpha = (0.03 - i * 0.008) * energy; // very faint: 0.03, 0.022, 0.014 at max
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radius * 0.7, radius, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${Math.max(0, alpha)})`;
    ctx.fill();
  }
  ctx.restore();
}
```

- [ ] **Step 8: Add `drawReflection()` helper method**

Ground mirror beneath the figure:

```ts
/** Draw ground reflection — vertically flipped, faded copy */
private drawReflection(
  ctx: CanvasRenderingContext2D,
  joints: JointPositions,
  r: number, g: number, b: number,
): void {
  ctx.save();
  // Find the lowest point (feet)
  const groundY = Math.max(joints.footL[1], joints.footR[1]);
  // Reflection starts below feet
  ctx.translate(0, groundY * 2 + 4);
  ctx.scale(1, -0.25); // flip + compress to 25% height
  ctx.globalAlpha = 0.10;

  // Draw simplified limb skeleton as reflection
  ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  const hipMidX = (joints.hipL[0] + joints.hipR[0]) / 2;
  const hipMidY = (joints.hipL[1] + joints.hipR[1]) / 2;

  // Spine
  ctx.beginPath();
  ctx.moveTo(joints.neck[0], joints.neck[1]);
  ctx.lineTo(hipMidX, hipMidY);
  ctx.stroke();

  // Arms
  for (const [s, e, h] of [
    [joints.shoulderL, joints.elbowL, joints.handL],
    [joints.shoulderR, joints.elbowR, joints.handR],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(s[0], s[1]);
    ctx.lineTo(e[0], e[1]);
    ctx.lineTo(h[0], h[1]);
    ctx.stroke();
  }

  // Legs
  for (const [hip, knee, foot] of [
    [joints.hipL, joints.kneeL, joints.footL],
    [joints.hipR, joints.kneeR, joints.footR],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(hip[0], hip[1]);
    ctx.lineTo(knee[0], knee[1]);
    ctx.lineTo(foot[0], foot[1]);
    ctx.stroke();
  }

  ctx.restore();
}
```

- [ ] **Step 9: Add `hexToRgb()` private utility**

The current `draw()` method has an inline hex→rgb parser. Extract it as a reusable private method:

```ts
/** Parse hex color to {r, g, b} */
private hexToRgb(): { r: number; g: number; b: number } {
  const hex = this.color.replace('#', '');
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  };
}
```

- [ ] **Step 10: Run typecheck to verify helpers compile**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: No errors (helpers are private methods not yet called)

- [ ] **Step 11: Commit**

```bash
git add packages/web/lib/arena/gladiator.ts
git commit -m "feat(arena): add armor drawing helpers — helmet, shoulders, plates, weapon, circuits, aura, reflection"
```

---

### Task 2: Rewrite `draw()` to render armored gladiators

**Files:**
- Modify: `packages/web/lib/arena/gladiator.ts:122-222` (replace the `draw()` method body)

The current `draw()` is ~100 lines drawing simple wireframe limbs. Replace it with a layered rendering pipeline that calls the helpers from Task 1. The draw order matters — back-to-front:

1. Aura (farthest back)
2. Ground reflection
3. Circuit traces
4. Armor plates (chest, hip, shin)
5. Skeleton (limbs, spine — double-stroked for depth)
6. Shoulder plates
7. Helmet
8. Weapon
9. Hit flash overlay (if active)
10. Power orb (if active)

- [ ] **Step 1: Replace the `draw()` method**

Replace lines 122–222 of `gladiator.ts` with:

```ts
draw(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(this.x, this.y);
  ctx.scale(this.currentScale * this.facing, this.currentScale);

  const { r, g, b } = this.hexToRgb();
  const glow = 8 + this.energy * 14; // 8–22px shadow blur
  const joints = this.currentJoints;

  const hipMidX = (joints.hipL[0] + joints.hipR[0]) / 2;
  const hipMidY = (joints.hipL[1] + joints.hipR[1]) / 2;

  // 1. Aura (behind everything)
  this.drawAura(ctx, 0, hipMidY - 15, r, g, b, this.energy);

  // 2. Ground reflection
  this.drawReflection(ctx, joints, r, g, b);

  // 3. Circuit traces
  this.drawCircuitTraces(ctx, joints, r, g, b, this.energy);

  // 4. Armor plates (chest, hip, shin guards)
  this.drawArmorPlates(ctx, joints, r, g, b);

  // 5. Skeleton — double-stroked limbs
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
  ctx.shadowBlur = glow;

  // Outer stroke (main limb color)
  ctx.strokeStyle = `rgba(${r},${g},${b},0.9)`;
  ctx.lineWidth = 2.5;

  // Spine
  this.drawLine(ctx, joints.neck, [hipMidX, hipMidY]);

  // Arms
  this.drawLine(ctx, joints.shoulderL, joints.elbowL);
  this.drawLine(ctx, joints.elbowL, joints.handL);
  this.drawLine(ctx, joints.shoulderR, joints.elbowR);
  this.drawLine(ctx, joints.elbowR, joints.handR);

  // Shoulder bar
  this.drawLine(ctx, joints.shoulderL, joints.shoulderR);

  // Hips
  this.drawLine(ctx, joints.hipL, joints.hipR);

  // Legs
  this.drawLine(ctx, joints.hipL, joints.kneeL);
  this.drawLine(ctx, joints.kneeL, joints.footL);
  this.drawLine(ctx, joints.hipR, joints.kneeR);
  this.drawLine(ctx, joints.kneeR, joints.footR);

  // Inner stroke (brighter, thinner — gives depth)
  ctx.strokeStyle = `rgba(${r},${g},${b},0.4)`;
  ctx.lineWidth = 1;
  ctx.shadowBlur = 0;
  this.drawLine(ctx, joints.neck, [hipMidX, hipMidY]);
  this.drawLine(ctx, joints.shoulderL, joints.elbowL);
  this.drawLine(ctx, joints.elbowL, joints.handL);
  this.drawLine(ctx, joints.shoulderR, joints.elbowR);
  this.drawLine(ctx, joints.elbowR, joints.handR);
  this.drawLine(ctx, joints.hipL, joints.kneeL);
  this.drawLine(ctx, joints.kneeL, joints.footL);
  this.drawLine(ctx, joints.hipR, joints.kneeR);
  this.drawLine(ctx, joints.kneeR, joints.footR);

  // 6. Shoulder plates
  this.drawShoulders(ctx, joints.shoulderL[0], joints.shoulderL[1], joints.shoulderR[0], joints.shoulderR[1], r, g, b);

  // 7. Helmet (replaces simple circle head)
  this.drawHelmet(ctx, joints.head[0], joints.head[1], r, g, b);

  // 8. Weapon
  ctx.shadowBlur = glow;
  this.drawWeapon(ctx, joints, r, g, b, this.energy);
  ctx.shadowBlur = 0;

  // 9. Hit flash overlay
  if (this.flash === 'hit') {
    const hitAlpha = 0.6 + Math.random() * 0.3;
    ctx.fillStyle = `rgba(255,80,80,${hitAlpha})`;
    ctx.fillRect(-15, joints.head[1] - 14, 30, joints.footL[1] - joints.head[1] + 20);
  }

  // 10. Power orb (during power flash)
  if (this.flash === 'power') {
    const handMidX = (joints.handL[0] + joints.handR[0]) / 2;
    const handMidY = (joints.handL[1] + joints.handR[1]) / 2;
    const orbSize = 6 + Math.random() * 4;
    ctx.beginPath();
    ctx.arc(handMidX, handMidY, orbSize, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},0.7)`;
    ctx.shadowColor = `rgba(${r},${g},${b},1)`;
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Weight shift — slight horizontal lean (slow sine)
  // Applied as a subtle translate before restore
  const weightShift = Math.sin(this.breathPhase * 0.4) * 1.5;
  ctx.translate(weightShift, 0);

  // Visor flicker (every ~3s — breathPhase increments at 0.002/ms, so 3s = 6 phase units)
  // sin(phase * 1.05) cycles every ~6 rad of phase ≈ 3000ms at 0.002/ms
  if (Math.sin(this.breathPhase * 1.05) > 0.97) {
    ctx.fillStyle = `rgba(${r},${g},${b},1.0)`;
    ctx.fillRect(joints.head[0] - 5, joints.head[1] - 2, 10, 2);
  }

  ctx.restore();
}
```

- [ ] **Step 2: Remove old torso accents code**

The old `draw()` method had torso accent lines (diagonal cross-chest). These are replaced by `drawArmorPlates()` and `drawCircuitTraces()`. Ensure the old code is fully removed (it was in lines ~186-204 of the original).

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: Clean compilation

- [ ] **Step 4: Run orchestrator tests (unchanged — gladiator is client-only)**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/arena/gladiator.ts
git commit -m "feat(arena): rewrite draw() with layered armor rendering — helmet, plates, weapons, circuits, aura, reflection"
```

---

### Task 3: Increase base scale and adjust positioning

**Files:**
- Modify: `packages/web/lib/arena/gladiator.ts` (LERP_SPEED, scale boost)
- Modify: `packages/web/components/BattleArena.tsx` (gladiator scale parameter in initialization)

The spec says increase base scale from ~1.4 to ~2.2. The scale is set in `BattleArena.tsx` where gladiators are instantiated.

- [ ] **Step 1: Find where gladiator scale is set in BattleArena.tsx**

Read `BattleArena.tsx` around lines 260–283 where `GladiatorRenderer` instances are created. The `scale` parameter is the 6th constructor argument.

- [ ] **Step 2: Update gladiator scale in BattleArena.tsx**

In the gladiator initialization `useEffect`, find the `new GladiatorRenderer(...)` call and change the scale parameter from the current value (~1.4) to `2.2`.

If the scale is computed (e.g., `canvas.height * 0.0025` or similar), adjust the multiplier so the result is ~2.2 at typical viewport sizes. The exact line numbers will be visible after reading the file.

- [ ] **Step 3: Adjust energy scale boost in gladiator.ts**

In `update()`, change the energy-based scale from `1.0 + energy * 0.06` to `1.0 + energy * 0.04`. The larger base figure needs less proportional boost to look impactful.

Find the line in `update()` (around line 100) that sets:
```ts
this.currentScale = this.baseScale * (1.0 + energy * 0.06);
```
Change to:
```ts
this.currentScale = this.baseScale * (1.0 + energy * 0.04);
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: Clean

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/arena/gladiator.ts packages/web/components/BattleArena.tsx
git commit -m "feat(arena): increase gladiator base scale to 2.2, reduce energy boost ratio"
```

---

### Task 4: Adjust poses for larger scale (minor coordinate tweaks)

**Files:**
- Modify: `packages/web/lib/arena/poses.ts`

The current poses have coordinates tuned for ~1.4 scale. At 2.2 scale, some limb extensions may look exaggerated. Check if any strike/power/triumph poses need coordinate dampening.

- [ ] **Step 1: Dampen strike reach for larger scale**

In `packages/web/lib/arena/poses.ts`, update the `strike` pose (around line 42-57). Change right hand extension:

```ts
handR: [35, -28],  // was [42, -28] — at 2.2× scale, 42 extends 92px which is too wide
```

- [ ] **Step 2: Dampen triumph arm height for larger scale**

In the `triumph` pose (around line 93-108), lower the arm positions:

```ts
head: [0, -54],     // was [0, -60]
handL: [-18, -60],  // was [-22, -70]
handR: [18, -60],   // was [22, -70]
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/web/lib/arena/poses.ts
git commit -m "feat(arena): adjust pose coordinates for larger gladiator scale"
```

---

## Chunk 2: Remotion Reel — Battle Highlights Scene

### Task 5: Add `ReelKeyEvent` type and `keyEvents` to `ReelData`

**Files:**
- Modify: `packages/video/src/types.ts:24-35`

- [ ] **Step 1: Add `ReelKeyEvent` interface**

After the existing `ReelKeyMoment` interface (line 22), add:

```ts
/** Key event for BattleHighlights scene — maps to a gladiator animation */
export interface ReelKeyEvent {
  frameOffset: number;   // frame within the 180-frame BattleHighlights scene
  teamId: string;        // which gladiator reacts
  type: 'strike' | 'power' | 'hit';  // animation to trigger
}
```

- [ ] **Step 2: Add `keyEvents` field to `ReelData`**

In the `ReelData` interface, add after `keyMoments`:

```ts
keyEvents: ReelKeyEvent[];  // 4-6 events for BattleHighlights scene
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p packages/video/tsconfig.json 2>/dev/null || npx tsc --noEmit -p packages/web/tsconfig.json`

The video package may not have its own tsconfig. Check which tsconfig covers it. Expected: type errors in `route.ts` (missing `keyEvents` in data construction) — this is fine, we'll fix it in Task 7.

- [ ] **Step 4: Commit**

```bash
git add packages/video/src/types.ts
git commit -m "feat(video): add ReelKeyEvent type and keyEvents field to ReelData"
```

---

### Task 6: Create `VideoGladiator` — frame-based renderer for Remotion

**Files:**
- Create: `packages/video/src/components/VideoGladiator.ts`

This is a simplified version of the web `GladiatorRenderer` adapted for Remotion's frame-based rendering. Key differences:
- No `requestAnimationFrame` — uses frame number directly
- No `update()` loop — state is computed from frame number
- Simpler armor rendering (no idle animation state machine — poses are driven by `ReelKeyEvent`)
- Inlines pose data (avoids cross-package imports from web)

- [ ] **Step 1: Create the VideoGladiator file**

```ts
// packages/video/src/components/VideoGladiator.ts

import { MODEL_COLORS } from '../tokens';

/** Joint positions for the 14-joint figure */
interface Joints {
  head: [number, number]; neck: [number, number];
  shoulderL: [number, number]; elbowL: [number, number]; handL: [number, number];
  shoulderR: [number, number]; elbowR: [number, number]; handR: [number, number];
  hipL: [number, number]; hipR: [number, number];
  kneeL: [number, number]; kneeR: [number, number];
  footL: [number, number]; footR: [number, number];
}

type PoseName = 'idle' | 'strike' | 'power' | 'hit';
type ModelType = 'claude' | 'codex' | 'gemini' | 'default';

/** Simplified pose definitions for video rendering */
const POSES: Record<PoseName, Joints> = {
  idle: {
    head: [0, -52], neck: [0, -42],
    shoulderL: [-14, -38], elbowL: [-18, -22], handL: [-16, -8],
    shoulderR: [14, -38], elbowR: [18, -22], handR: [16, -8],
    hipL: [-6, 0], hipR: [6, 0],
    kneeL: [-8, 20], kneeR: [8, 20],
    footL: [-10, 40], footR: [10, 40],
  },
  strike: {
    head: [2, -52], neck: [1, -42],
    shoulderL: [-14, -38], elbowL: [-22, -24], handL: [-24, -14],
    shoulderR: [14, -38], elbowR: [28, -30], handR: [35, -28],
    hipL: [-6, 0], hipR: [6, 0],
    kneeL: [-10, 20], kneeR: [6, 20],
    footL: [-12, 40], footR: [8, 40],
  },
  power: {
    head: [0, -54], neck: [0, -44],
    shoulderL: [-16, -40], elbowL: [-28, -38], handL: [-32, -48],
    shoulderR: [16, -40], elbowR: [28, -38], handR: [32, -48],
    hipL: [-8, 0], hipR: [8, 0],
    kneeL: [-10, 20], kneeR: [10, 20],
    footL: [-12, 40], footR: [12, 40],
  },
  hit: {
    head: [4, -48], neck: [3, -40],
    shoulderL: [-12, -36], elbowL: [-20, -22], handL: [-22, -10],
    shoulderR: [16, -34], elbowR: [22, -18], handR: [24, -6],
    hipL: [-4, 2], hipR: [8, 0],
    kneeL: [-6, 22], kneeR: [10, 20],
    footL: [-8, 40], footR: [12, 40],
  },
};

const HELMET_PATHS: Record<ModelType, [number, number][]> = {
  claude: [[0,-12],[7,-8],[8,-2],[7,4],[-7,4],[-8,-2],[-7,-8]],
  codex: [[-9,-7],[9,-7],[10,-2],[8,4],[-8,4],[-10,-2]],
  gemini: [[0,-11],[6,-6],[6,2],[4,5],[-4,5],[-6,2],[-6,-6]],
  default: (() => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      pts.push([Math.cos(a) * 8, Math.sin(a) * 8]);
    }
    return pts;
  })(),
};

/** Lerp between two joint sets */
function lerpJoints(a: Joints, b: Joints, t: number): Joints {
  const result = {} as any;
  for (const key of Object.keys(a) as (keyof Joints)[]) {
    result[key] = [
      a[key][0] + (b[key][0] - a[key][0]) * t,
      a[key][1] + (b[key][1] - a[key][1]) * t,
    ];
  }
  return result as Joints;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) };
}

export interface VideoGladiatorConfig {
  teamId: string;
  model: string;       // 'claude' | 'codex' | 'gemini'
  color: string;       // hex
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
}

export interface GladiatorEvent {
  frameOffset: number;
  type: 'strike' | 'power' | 'hit';
}

const FLASH_FRAMES = 15; // ~0.5s at 30fps

/**
 * Render a gladiator at a specific frame.
 * Pure function — no mutable state. Computes pose from frame + events.
 */
export function renderVideoGladiator(
  ctx: CanvasRenderingContext2D,
  config: VideoGladiatorConfig,
  frame: number,
  events: GladiatorEvent[],
): void {
  const modelType: ModelType = (['claude','codex','gemini'].includes(config.model) ? config.model : 'default') as ModelType;
  const { r, g, b } = hexToRgb(config.color);

  // Determine current pose from events — find the most recent active flash
  let currentPose: PoseName = 'idle';
  let blendT = 1; // blend factor: 0=idle, 1=full pose
  for (const ev of events) {
    const elapsed = frame - ev.frameOffset;
    if (elapsed >= 0 && elapsed < FLASH_FRAMES) {
      currentPose = ev.type;
      // Triangle blend: ramp up first half, ramp down second half
      const progress = elapsed / FLASH_FRAMES;
      blendT = progress < 0.5 ? progress * 2 : 2 - progress * 2;
      break;
    }
  }

  // Lerp between idle and target pose
  const joints = currentPose === 'idle'
    ? POSES.idle
    : lerpJoints(POSES.idle, POSES[currentPose], blendT);

  // Breathing bob
  const breathY = Math.sin(frame * 0.1) * 1.5;

  ctx.save();
  ctx.translate(config.x, config.y);
  ctx.scale(config.scale * config.facing, config.scale);

  const glow = 12;
  const hipMidX = (joints.hipL[0] + joints.hipR[0]) / 2;
  const hipMidY = (joints.hipL[1] + joints.hipR[1]) / 2;

  // Aura — 3 concentric pulsing layers
  const auraPulse = Math.sin(frame * 0.08);
  for (let i = 0; i < 3; i++) {
    const baseR = 25 + i * 12;
    const radius = baseR + auraPulse * 3 * (i + 1);
    const alpha = 0.03 - i * 0.008; // 0.03, 0.022, 0.014
    ctx.beginPath();
    ctx.ellipse(0, hipMidY - 10, radius * 0.7, radius, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${Math.max(0, alpha)})`;
    ctx.fill();
  }

  // Circuit traces
  ctx.setLineDash([4, 6]);
  ctx.lineDashOffset = -(frame * 2);
  ctx.strokeStyle = `rgba(${r},${g},${b},0.2)`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(joints.neck[0] + 2, joints.neck[1] + breathY + 2);
  ctx.lineTo(hipMidX + 2, hipMidY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(joints.hipL[0], joints.hipL[1]);
  ctx.lineTo(joints.kneeL[0], joints.kneeL[1]);
  ctx.lineTo(joints.footL[0], joints.footL[1]);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(joints.hipR[0], joints.hipR[1]);
  ctx.lineTo(joints.kneeR[0], joints.kneeR[1]);
  ctx.lineTo(joints.footR[0], joints.footR[1]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Skeleton — main strokes
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
  ctx.shadowBlur = glow;
  ctx.strokeStyle = `rgba(${r},${g},${b},0.9)`;
  ctx.lineWidth = 2.5;

  const drawLine = (from: [number, number], to: [number, number], yOff = 0) => {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1] + yOff);
    ctx.lineTo(to[0], to[1] + yOff);
    ctx.stroke();
  };

  // Apply breathing to upper body
  drawLine(joints.neck, [hipMidX, hipMidY], breathY * 0.7);
  drawLine(joints.shoulderL, joints.elbowL, breathY * 0.5);
  drawLine(joints.elbowL, joints.handL, breathY * 0.3);
  drawLine(joints.shoulderR, joints.elbowR, breathY * 0.5);
  drawLine(joints.elbowR, joints.handR, breathY * 0.3);
  drawLine(joints.shoulderL, joints.shoulderR, breathY * 0.5);
  drawLine(joints.hipL, joints.hipR);
  drawLine(joints.hipL, joints.kneeL);
  drawLine(joints.kneeL, joints.footL);
  drawLine(joints.hipR, joints.kneeR);
  drawLine(joints.kneeR, joints.footR);

  ctx.shadowBlur = 0;

  // Helmet
  const headX = joints.head[0];
  const headY = joints.head[1] + breathY;
  const pts = HELMET_PATHS[modelType];
  ctx.beginPath();
  ctx.moveTo(headX + pts[0][0], headY + pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(headX + pts[i][0], headY + pts[i][1]);
  }
  ctx.closePath();
  ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
  ctx.fill();
  ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Visor
  ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
  ctx.fillRect(headX - 5, headY - 2, 10, 2);

  // Hit flash
  if (currentPose === 'hit') {
    ctx.fillStyle = `rgba(255,80,80,${0.6 + Math.random() * 0.2})`;
    ctx.fillRect(-15, joints.head[1] - 14, 30, 60);
  }

  // Power orb
  if (currentPose === 'power') {
    const mx = (joints.handL[0] + joints.handR[0]) / 2;
    const my = (joints.handL[1] + joints.handR[1]) / 2 + breathY * 0.3;
    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},0.7)`;
    ctx.shadowColor = `rgba(${r},${g},${b},1)`;
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: Clean (video file uses standalone types, no web imports)

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/components/VideoGladiator.ts
git commit -m "feat(video): add VideoGladiator frame-based renderer for Remotion battle scenes"
```

---

### Task 7: Create `BattleHighlights` Remotion scene

**Files:**
- Create: `packages/video/src/scenes/BattleHighlights.tsx`

A Remotion component that renders a Canvas-based arena with two gladiators reacting to key events. Uses `useCurrentFrame()` and `<Canvas>` (Remotion `<OffthreadVideo>` is not needed — we use a plain HTML canvas rendered via a React ref).

- [ ] **Step 1: Create the BattleHighlights scene**

```tsx
// packages/video/src/scenes/BattleHighlights.tsx

import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { useCallback, useRef, useEffect } from 'react';
import { TronGrid } from '../components/TronGrid';
import { renderVideoGladiator } from '../components/VideoGladiator';
import type { ReelData, ReelKeyEvent } from '../types';
import { ACCENT_CYAN, TEXT_PRIMARY, ORBITRON, BG_DARK } from '../tokens';

interface BattleHighlightsProps {
  data: Pick<ReelData, 'teams' | 'keyEvents'>;
}

export const BattleHighlights: React.FC<BattleHighlightsProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Title fade-in
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Scene fade-out
  const sceneOpacity = interpolate(frame, [160, 180], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Position gladiators based on team count
  const gladiatorConfigs = data.teams.map((team, i) => {
    const total = data.teams.length;
    let x: number, facing: 1 | -1;
    if (total === 2) {
      x = i === 0 ? width * 0.3 : width * 0.7;
      facing = i === 0 ? 1 : -1;
    } else {
      // Ring formation
      const angle = (Math.PI * 2 / total) * i - Math.PI / 2;
      x = width / 2 + Math.cos(angle) * width * 0.25;
      facing = x < width / 2 ? 1 : -1;
    }
    return {
      teamId: team.teamId,
      model: team.model,
      color: team.color,
      x,
      y: height * 0.55,
      scale: 2.8,
      facing,
    };
  });

  // Split keyEvents by team
  const eventsByTeam = new Map<string, { frameOffset: number; type: 'strike' | 'power' | 'hit' }[]>();
  for (const team of data.teams) {
    eventsByTeam.set(team.teamId, []);
  }
  for (const ev of data.keyEvents) {
    const arr = eventsByTeam.get(ev.teamId);
    if (arr) arr.push({ frameOffset: ev.frameOffset, type: ev.type });
  }

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Draw each gladiator
    for (const config of gladiatorConfigs) {
      const teamEvents = eventsByTeam.get(config.teamId) || [];
      renderVideoGladiator(ctx, config, frame, teamEvents);
    }
  }, [frame, width, height]);

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      backgroundColor: BG_DARK,
      opacity: sceneOpacity,
    }}>
      <TronGrid opacity={0.4} />

      {/* Canvas for gladiators */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* Title overlay */}
      <div style={{
        position: 'absolute', top: 60, left: 0, right: 0,
        textAlign: 'center',
        fontFamily: ORBITRON,
        fontSize: 36,
        fontWeight: 900,
        color: ACCENT_CYAN,
        letterSpacing: '4px',
        textShadow: `0 0 30px rgba(0,240,255,0.6)`,
        opacity: titleOpacity,
        zIndex: 2,
      }}>
        BATTLE HIGHLIGHTS
      </div>

      {/* Team labels */}
      <div style={{
        position: 'absolute', bottom: 80, left: 0, right: 0,
        display: 'flex', justifyContent: 'space-around',
        padding: '0 60px',
        zIndex: 2,
      }}>
        {data.teams.map((team) => (
          <div key={team.teamId} style={{
            fontFamily: ORBITRON,
            fontSize: 18,
            color: team.color,
            textShadow: `0 0 12px ${team.color}`,
            textAlign: 'center',
            opacity: titleOpacity,
          }}>
            {team.label.toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: May warn about unused import in composition (BattleHighlights not yet imported there). Clean otherwise.

- [ ] **Step 3: Commit**

```bash
git add packages/video/src/scenes/BattleHighlights.tsx
git commit -m "feat(video): add BattleHighlights Remotion scene with canvas gladiator rendering"
```

---

### Task 8: Extract key events in reel API route

**Files:**
- Modify: `packages/web/app/api/competitions/[id]/reel/route.ts`

Add `keyEvents` extraction to `buildReelData()` and include in the returned `ReelData`.

- [ ] **Step 1: Add key event extraction to `buildReelData()`**

After the existing `keyMoments` extraction logic (~line 174), add:

```ts
// Extract key events for BattleHighlights scene (4-6 events, spaced across timeline)
const battleEvents: ReelKeyEvent[] = [];
const BATTLE_FRAMES = 180; // 6s at 30fps

// Collect significant events with timestamps
const significantEvents = events
  .filter((e: any) => ['FILE_CREATE', 'FILE_MODIFY', 'TOOL_CALL', 'ERROR'].includes(e.type))
  .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

if (significantEvents.length > 0) {
  const startTime = new Date(significantEvents[0].timestamp).getTime();
  const endTime = new Date(significantEvents[significantEvents.length - 1].timestamp).getTime();
  const duration = endTime - startTime || 1;

  // Sample 6 evenly-spaced events
  const step = Math.max(1, Math.floor(significantEvents.length / 6));
  const sampled = [];
  for (let i = 0; i < significantEvents.length && sampled.length < 6; i += step) {
    sampled.push(significantEvents[i]);
  }

  for (const ev of sampled) {
    const relTime = new Date(ev.timestamp).getTime() - startTime;
    const rawOffset = Math.round((relTime / duration) * (BATTLE_FRAMES - 30)) + 10;
    const frameOffset = Math.max(10, Math.min(160, rawOffset)); // clamp to 10–160
    const type = ev.type === 'ERROR' ? 'hit' as const
      : ev.type === 'TOOL_CALL' ? 'power' as const
      : 'strike' as const;
    battleEvents.push({ frameOffset, teamId: ev.teamId, type });
  }
}
```

- [ ] **Step 2: Add `keyEvents` to the return object**

In the `return` statement of `buildReelData()`, add:

```ts
keyEvents: battleEvents,
```

- [ ] **Step 3: Import `ReelKeyEvent` type**

At the top of the file, update the import from `types.ts`:

The `route.ts` file currently imports types inline or uses `any`. Add the `ReelKeyEvent` type definition locally in the route file (same pattern as other reel types):

```ts
interface ReelKeyEvent {
  frameOffset: number;
  teamId: string;
  type: 'strike' | 'power' | 'hit';
}
```

This avoids cross-package imports since the video package types aren't directly importable from web API routes.

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: Clean

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/api/competitions/[id]/reel/route.ts
git commit -m "feat(reel): extract key events from competition history for BattleHighlights scene"
```

---

## Chunk 3: Longer Durations + Integration

### Task 9: Update CompetitionRecap frame timings and add BattleHighlights

**Files:**
- Modify: `packages/video/src/compositions/CompetitionRecap.tsx`

Update all `<Sequence>` frame ranges from 42s (1260 frames) to 65s (1950 frames) and insert BattleHighlights as the 3rd scene.

- [ ] **Step 1: Update the frame timing constants**

Replace the existing frame constants (lines 12–21) with the new timing:

```ts
// Scene timing — 65s total @ 30fps = 1950 frames
const INTRO_START = 0;
const INTRO_DURATION = 120;     // 4s (+1s)

const MATCHUP_START = 120;
const MATCHUP_DURATION = 180;   // 6s (+2s)

const BATTLE_START = 300;
const BATTLE_DURATION = 180;    // 6s (NEW)

const BRIEF_START = 480;
const BRIEF_DURATION = 180;     // 6s (+2s)

const MOMENTS_START = 660;
const MOMENTS_DURATION = 300;   // 10s (+2s)

const SCORE_START = 960;
const SCORE_DURATION = 420;     // 14s (+3s)

const WINNER_START = 1380;
const WINNER_DURATION = 120;    // 4s (+1s)

const DEEPER_START = 1500;
const DEEPER_DURATION = 270;    // 9s (+3s)

const OUTRO_START = 1770;
const OUTRO_DURATION = 180;     // 6s (+3s)

const TOTAL_FRAMES = 1950;      // 65s
```

- [ ] **Step 2: Import BattleHighlights scene**

Add to imports:

```ts
import { BattleHighlights } from '../scenes/BattleHighlights';
```

- [ ] **Step 3: Add BattleHighlights Sequence between Matchup and TheBrief**

After the Matchup `<Sequence>`, insert:

```tsx
<Sequence from={BATTLE_START} durationInFrames={BATTLE_DURATION} name="BattleHighlights">
  <BattleHighlights data={{ teams: data.teams, keyEvents: data.keyEvents }} />
</Sequence>
```

- [ ] **Step 4: Update all existing Sequence `from` and `durationInFrames` to use the new constants**

Update each `<Sequence>` to use the named constants:

```tsx
<Sequence from={INTRO_START} durationInFrames={INTRO_DURATION} name="IntroBumper">
<Sequence from={MATCHUP_START} durationInFrames={MATCHUP_DURATION} name="Matchup">
// BattleHighlights inserted here
<Sequence from={BRIEF_START} durationInFrames={BRIEF_DURATION} name="TheBrief">
<Sequence from={MOMENTS_START} durationInFrames={MOMENTS_DURATION} name="KeyMoments">
<Sequence from={SCORE_START} durationInFrames={SCORE_DURATION} name="ScoreReveal">
<Sequence from={WINNER_START} durationInFrames={WINNER_DURATION} name="Winner">
<Sequence from={DEEPER_START} durationInFrames={DEEPER_DURATION} name="GoDeeper">
<Sequence from={OUTRO_START} durationInFrames={OUTRO_DURATION} name="Outro">
```

- [ ] **Step 5: Update ThemeAudio fade-out timing**

The current fade-out starts at frame 1200 and ends at 1260. Update to:

```ts
// Fade-out starts 60 frames before end
const fadeOutStart = TOTAL_FRAMES - 60; // 1890
const fadeOutEnd = TOTAL_FRAMES;        // 1950
```

- [ ] **Step 6: Commit**

```bash
git add packages/video/src/compositions/CompetitionRecap.tsx
git commit -m "feat(video): update reel to 65s with BattleHighlights scene, longer durations for all scenes"
```

---

### Task 10: Update Root.tsx total duration

**Files:**
- Modify: `packages/video/src/Root.tsx`

- [ ] **Step 1: Update the Composition duration**

In `Root.tsx`, find the `<Composition>` element and change `durationInFrames` from `1260` to `1950`:

```tsx
<Composition
  id={COMPOSITION_ID}
  component={CompetitionRecap}
  durationInFrames={1950}
  fps={30}
  width={1080}
  height={1920}
  defaultProps={{ data: mockReelData }}
/>
```

- [ ] **Step 2: Update mockReelData to include `keyEvents`**

The `mockReelData` object in Root.tsx needs a `keyEvents` field to match the updated `ReelData` type:

```ts
keyEvents: [
  { frameOffset: 30, teamId: 'team-a', type: 'strike' },
  { frameOffset: 60, teamId: 'team-b', type: 'power' },
  { frameOffset: 100, teamId: 'team-a', type: 'power' },
  { frameOffset: 130, teamId: 'team-b', type: 'strike' },
  { frameOffset: 155, teamId: 'team-a', type: 'hit' },
],
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: Clean — all types aligned

- [ ] **Step 4: Run orchestrator tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass (no orchestrator changes in this sprint)

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/Root.tsx
git commit -m "feat(video): update Root.tsx to 1950 frames (65s) and add mock keyEvents"
```

---

### Task 11: Final integration check

**Files:** None (verification only)

- [ ] **Step 1: Full typecheck — web**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: Clean

- [ ] **Step 2: Full typecheck — orchestrator**

Run: `npm run typecheck --workspace=packages/orchestrator`
Expected: Clean

- [ ] **Step 3: Full test suite**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass

- [ ] **Step 4: Visual verification (manual)**

Start the dev stack:
```bash
# Terminal 1
DATABASE_URL=postgresql://localhost/arena npx tsx packages/orchestrator/src/cli.ts serve --port 3000

# Terminal 2
cd packages/web && npm run dev
```

Open a completed competition in the browser and check:
1. Battle Arena shows armored gladiators (not stick figures)
2. Claude gladiator has identity disc weapon
3. Codex gladiator has dual arm blades
4. Gemini gladiator has energy staff
5. Idle animations visible: breathing bob, weapon activity, circuit flow
6. Gladiators are noticeably larger than before
7. Ground reflections visible beneath figures
8. Energy affects glow intensity

- [ ] **Step 5: Generate a test reel (manual)**

Click "Generate Reel" on a completed competition. Verify:
1. Reel is ~65s (not 42s)
2. BattleHighlights scene appears after Matchup
3. Gladiator figures visible in BattleHighlights with armor
4. Events trigger animation flashes during BattleHighlights

- [ ] **Step 6: Final commit with sprint summary**

```bash
git add -A
git commit -m "docs: Sprint 7C complete — armored gladiators, battle reel highlights, 65s reels"
```
