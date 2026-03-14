# Sprint 6: Live Battle Visualization — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scrolling event log with an animated TRON gladiator battle driven by real-time WebSocket events.

**Architecture:** Pure client-side Canvas 2D + React. No backend changes. Six new files in `packages/web/lib/arena/` + one new component `BattleArena.tsx` + one modification to the competition page for the view toggle.

**Tech Stack:** React, Canvas 2D API, TypeScript, existing design tokens

**Spec:** `docs/superpowers/specs/2026-03-14-battle-visualization-design.md`

---

## Chunk 1: Types, Poses, and Core Rendering

### Task 1: Create shared types

**Files:**
- Create: `packages/web/lib/arena/types.ts`

- [ ] **Step 1: Write the types file**

```ts
// packages/web/lib/arena/types.ts

/** 12 joints define the wireframe figure */
export interface JointPositions {
  head: [number, number];
  neck: [number, number];
  shoulderL: [number, number];
  shoulderR: [number, number];
  elbowL: [number, number];
  elbowR: [number, number];
  handL: [number, number];
  handR: [number, number];
  hipL: [number, number];
  hipR: [number, number];
  kneeL: [number, number];
  kneeR: [number, number];
  footL: [number, number];
  footR: [number, number];
}

export type JointName = keyof JointPositions;
export const JOINT_NAMES: JointName[] = [
  'head', 'neck', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR',
  'handL', 'handR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'footL', 'footR',
];

export type PoseName = 'idle' | 'thinking' | 'strike' | 'power' | 'hit' | 'triumph' | 'kneel' | 'salute';
export type BasePose = 'idle' | 'thinking';
export type TerminalPose = 'triumph' | 'kneel' | 'salute';
export type FlashPose = 'strike' | 'power' | 'hit';

export type ModelBuild = 'claude' | 'codex' | 'gemini' | 'default';

export interface TeamMomentum {
  energy: number;
  basePose: BasePose;
  terminalPose?: TerminalPose;
  lastEventTime: number;
  recentTypes: string[];        // last 5 event types for base pose selection
  eventCounts: { reasoning: number; fileCreate: number; toolCall: number; error: number };
  latestAction: string;         // e.g. "Creating server.ts..."
}

export interface AnimationCommand {
  teamId: string;
  flash?: FlashPose;
  basePose?: BasePose;
  terminalPose?: TerminalPose;
  particle?: ParticleType;
}

export type ParticleType = 'strike_projectile' | 'power_burst' | 'impact_sparks' | 'hit_sparks' | 'triumph_explosion';

export interface Particle {
  type: ParticleType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;      // 0–1, decreasing
  maxLife: number;
  color: string;
  size: number;
}

export type ArenaPhase = 'active' | 'freeze' | 'judging' | 'reveal';
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/lib/arena/types.ts
git commit -m "feat(arena): add shared types for battle visualization"
```

---

### Task 2: Create pose definitions for all 8 poses × 3 model builds

**Files:**
- Create: `packages/web/lib/arena/poses.ts`

All coordinates are relative to figure center (0, 0), with Y-axis pointing up (negative = above center).

- [ ] **Step 1: Write the poses file**

```ts
// packages/web/lib/arena/poses.ts
import type { JointPositions, PoseName, ModelBuild } from './types.js';

/** Default (balanced) figure joint positions for each pose */
const DEFAULT_POSES: Record<PoseName, JointPositions> = {
  idle: {
    head: [0, -58], neck: [0, -50],
    shoulderL: [-18, -45], shoulderR: [18, -45],
    elbowL: [-22, -28], elbowR: [22, -28],
    handL: [-18, -12], handR: [18, -12],
    hipL: [-10, -15], hipR: [10, -15],
    kneeL: [-12, 5], kneeR: [12, 5],
    footL: [-10, 22], footR: [10, 22],
  },
  thinking: {
    head: [3, -56], neck: [0, -50],
    shoulderL: [-16, -45], shoulderR: [16, -45],
    elbowL: [-10, -35], elbowR: [10, -35],
    handL: [-5, -42], handR: [5, -42],
    hipL: [-10, -15], hipR: [10, -15],
    kneeL: [-12, 5], kneeR: [12, 5],
    footL: [-10, 22], footR: [10, 22],
  },
  strike: {
    head: [0, -56], neck: [0, -48],
    shoulderL: [-18, -44], shoulderR: [18, -44],
    elbowL: [-28, -34], elbowR: [35, -40],
    handL: [-22, -18], handR: [50, -32],
    hipL: [-10, -15], hipR: [10, -15],
    kneeL: [-14, 5], kneeR: [8, 5],
    footL: [-12, 22], footR: [12, 22],
  },
  power: {
    head: [0, -60], neck: [0, -52],
    shoulderL: [-20, -46], shoulderR: [20, -46],
    elbowL: [-35, -50], elbowR: [35, -50],
    handL: [-42, -40], handR: [42, -40],
    hipL: [-12, -15], hipR: [12, -15],
    kneeL: [-14, 3], kneeR: [14, 3],
    footL: [-12, 22], footR: [12, 22],
  },
  hit: {
    head: [-5, -52], neck: [-3, -46],
    shoulderL: [-20, -42], shoulderR: [14, -40],
    elbowL: [-28, -30], elbowR: [20, -25],
    handL: [-30, -18], handR: [22, -10],
    hipL: [-8, -15], hipR: [12, -12],
    kneeL: [-10, 5], kneeR: [14, 3],
    footL: [-8, 22], footR: [16, 20],
  },
  triumph: {
    head: [0, -62], neck: [0, -54],
    shoulderL: [-20, -48], shoulderR: [20, -48],
    elbowL: [-25, -58], elbowR: [25, -58],
    handL: [-20, -68], handR: [20, -68],
    hipL: [-10, -15], hipR: [10, -15],
    kneeL: [-12, 5], kneeR: [12, 5],
    footL: [-10, 22], footR: [10, 22],
  },
  kneel: {
    head: [0, -35], neck: [0, -28],
    shoulderL: [-16, -24], shoulderR: [16, -24],
    elbowL: [-20, -12], elbowR: [20, -12],
    handL: [-16, 0], handR: [16, 0],
    hipL: [-8, 5], hipR: [8, 5],
    kneeL: [-14, 18], kneeR: [6, 18],
    footL: [-18, 22], footR: [14, 10],
  },
  salute: {
    head: [0, -58], neck: [0, -50],
    shoulderL: [-18, -45], shoulderR: [18, -45],
    elbowL: [-22, -28], elbowR: [30, -40],
    handL: [-18, -12], handR: [45, -35],
    hipL: [-10, -15], hipR: [10, -15],
    kneeL: [-12, 5], kneeR: [12, 5],
    footL: [-10, 22], footR: [10, 22],
  },
};

/**
 * Model-specific scale adjustments applied on top of DEFAULT_POSES.
 * Claude = tall/angular, Codex = stocky/wide, Gemini = lithe/asymmetric.
 */
const MODEL_ADJUSTMENTS: Record<ModelBuild, { scaleX: number; scaleY: number; shoulderWidth: number }> = {
  claude:  { scaleX: 1.0,  scaleY: 1.1,  shoulderWidth: 1.0 },
  codex:   { scaleX: 1.15, scaleY: 0.95, shoulderWidth: 1.2 },
  gemini:  { scaleX: 0.9,  scaleY: 1.05, shoulderWidth: 0.9 },
  default: { scaleX: 1.0,  scaleY: 1.0,  shoulderWidth: 1.0 },
};

/** Get the joint positions for a given pose and model build */
export function getPose(pose: PoseName, build: ModelBuild): JointPositions {
  const base = DEFAULT_POSES[pose];
  const adj = MODEL_ADJUSTMENTS[build];
  const result = {} as JointPositions;
  for (const [key, [x, y]] of Object.entries(base) as [keyof JointPositions, [number, number]][]) {
    const sx = key.includes('shoulder') ? adj.scaleX * adj.shoulderWidth : adj.scaleX;
    result[key] = [x * sx, y * adj.scaleY];
  }
  return result;
}

/** Resolve model string (e.g. "claude:architect") to a ModelBuild */
export function resolveModelBuild(model: string): ModelBuild {
  const prefix = model.split(':')[0]?.toLowerCase();
  if (prefix === 'claude' || prefix === 'codex' || prefix === 'gemini') return prefix;
  return 'default';
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/lib/arena/poses.ts
git commit -m "feat(arena): add 8-pose × 3-build joint position definitions"
```

---

### Task 3: Create GladiatorRenderer

**Files:**
- Create: `packages/web/lib/arena/gladiator.ts`

This class draws one wireframe figure and interpolates between poses.

- [ ] **Step 1: Write the gladiator renderer**

```ts
// packages/web/lib/arena/gladiator.ts
import type { JointPositions, JointName, PoseName, FlashPose, ModelBuild } from './types.js';
import { JOINT_NAMES } from './types.js';
import { getPose } from './poses.js';

const LERP_SPEED = 0.12; // per frame at 60fps (~300ms to settle)

export class GladiatorRenderer {
  private currentJoints: JointPositions;
  private targetJoints: JointPositions;
  private currentPose: PoseName = 'idle';
  private flashPose: FlashPose | null = null;
  private flashTimer = 0;
  private breathOffset = 0;

  constructor(
    public readonly teamId: string,
    public readonly build: ModelBuild,
    public color: string,
    public x: number,
    public y: number,
    public scale: number,
    public facing: 1 | -1,
  ) {
    this.currentJoints = getPose('idle', build);
    this.targetJoints = { ...this.currentJoints };
  }

  /** Set the sustained base pose */
  setBasePose(pose: PoseName) {
    this.currentPose = pose;
    this.targetJoints = getPose(pose, this.build);
  }

  /** Trigger a transient flash animation (500ms for strike/power, 400ms for hit) */
  triggerFlash(flash: FlashPose) {
    this.flashPose = flash;
    this.flashTimer = flash === 'hit' ? 0.4 : 0.5;
    this.targetJoints = getPose(flash, this.build);
  }

  /** Update animation state. Called every frame. */
  update(dt: number, energy: number) {
    this.breathOffset += dt * 2;

    // Flash timer countdown
    if (this.flashPose && this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flashPose = null;
        this.targetJoints = getPose(this.currentPose, this.build);
      }
    }

    // Lerp joints toward target
    for (const name of JOINT_NAMES) {
      const cur = this.currentJoints[name];
      const tgt = this.targetJoints[name];
      cur[0] += (tgt[0] - cur[0]) * LERP_SPEED;
      cur[1] += (tgt[1] - cur[1]) * LERP_SPEED;
    }

    // Energy-based scale adjustment
    this.scale = 1.4 + (energy - 0.5) * 0.3; // 1.25 at low, 1.55 at high
  }

  /** Draw the figure on a canvas context */
  draw(ctx: CanvasRenderingContext2D, energy: number) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.scale * this.facing, this.scale);

    // Breathing bob
    const bob = Math.sin(this.breathOffset) * 1.5;
    ctx.translate(0, bob);

    const glowIntensity = 8 + energy * 14;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = glowIntensity;
    ctx.lineCap = 'round';

    const j = this.currentJoints;

    // Hit flash: red tint
    if (this.flashPose === 'hit' && this.flashTimer > 0) {
      ctx.strokeStyle = '#ef4444';
      ctx.shadowColor = '#ef4444';
    }

    // Head
    ctx.beginPath();
    ctx.arc(j.head[0], j.head[1], 8, 0, Math.PI * 2);
    ctx.stroke();

    // Visor
    ctx.fillStyle = this.flashPose === 'hit' ? '#ef4444' : this.color;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(j.head[0] - 5, j.head[1] - 2, 10, 3);
    ctx.globalAlpha = 1;

    // Spine: neck → hipL/hipR midpoint
    const hipMidX = (j.hipL[0] + j.hipR[0]) / 2;
    const hipMidY = (j.hipL[1] + j.hipR[1]) / 2;
    this.line(ctx, j.neck, [hipMidX, hipMidY]);

    // Shoulders
    this.line(ctx, j.shoulderL, j.shoulderR);

    // Arms
    this.line(ctx, j.shoulderL, j.elbowL);
    this.line(ctx, j.elbowL, j.handL);
    this.line(ctx, j.shoulderR, j.elbowR);
    this.line(ctx, j.elbowR, j.handR);

    // Hips
    this.line(ctx, j.hipL, j.hipR);

    // Legs
    this.line(ctx, j.hipL, j.kneeL);
    this.line(ctx, j.kneeL, j.footL);
    this.line(ctx, j.hipR, j.kneeR);
    this.line(ctx, j.kneeR, j.footR);

    // Circuit accent lines on torso
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    this.line(ctx, [j.shoulderL[0] + 5, j.shoulderL[1] + 2], [j.hipL[0] + 3, j.hipL[1] - 2]);
    this.line(ctx, [j.shoulderR[0] - 5, j.shoulderR[1] + 2], [j.hipR[0] - 3, j.hipR[1] - 2]);
    ctx.globalAlpha = 1;

    // Power orb (during power pose)
    if (this.flashPose === 'power' && this.flashTimer > 0) {
      const pulse = Math.sin(this.breathOffset * 4) * 4;
      ctx.beginPath();
      ctx.arc(0, j.head[1] - 18, 8 + pulse, 0, Math.PI * 2);
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  private line(ctx: CanvasRenderingContext2D, a: [number, number] | number[], b: [number, number] | number[]) {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  /** Get the world-space hand position (for projectile origin) */
  getHandPosition(): [number, number] {
    const j = this.currentJoints;
    return [
      this.x + j.handR[0] * this.scale * this.facing,
      this.y + j.handR[1] * this.scale,
    ];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/lib/arena/gladiator.ts
git commit -m "feat(arena): add GladiatorRenderer with joint interpolation and drawing"
```

---

### Task 4: Create ParticleSystem

**Files:**
- Create: `packages/web/lib/arena/particles.ts`

- [ ] **Step 1: Write the particle system**

```ts
// packages/web/lib/arena/particles.ts
import type { Particle, ParticleType } from './types.js';

const MAX_PARTICLES = 50;

export class ParticleSystem {
  private particles: Particle[] = [];

  spawn(type: ParticleType, x: number, y: number, color: string, count = 1) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) {
        this.particles.shift(); // remove oldest
      }

      const angle = Math.random() * Math.PI * 2;
      const speed = type === 'triumph_explosion' ? 2 + Math.random() * 4
        : type === 'power_burst' ? 1.5 + Math.random() * 2
        : 1 + Math.random() * 3;

      this.particles.push({
        type,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: type === 'triumph_explosion'
          ? -(2 + Math.random() * 5) // fountain upward
          : Math.sin(angle) * speed,
        life: 1,
        maxLife: type === 'strike_projectile' ? 0.8 : 0.6,
        color,
        size: type === 'triumph_explosion' ? 2 + Math.random() * 3 : 1.5 + Math.random() * 2,
      });
    }
  }

  /** Spawn a projectile that moves toward a target */
  spawnProjectile(x: number, y: number, targetX: number, targetY: number, color: string) {
    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = 4;
    this.particles.push({
      type: 'strike_projectile',
      x, y,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      life: 1,
      maxLife: dist / speed / 60, // frames to reach target
      color,
      size: 4,
    });
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.type === 'triumph_explosion') p.vy += 0.15; // gravity
      p.life -= dt / p.maxLife;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color.replace(')', `,${p.life * 0.8})`).replace('rgb(', 'rgba(');

      // Fallback for hex colors
      if (p.color.startsWith('#')) {
        const r = parseInt(p.color.slice(1, 3), 16);
        const g = parseInt(p.color.slice(3, 5), 16);
        const b = parseInt(p.color.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r},${g},${b},${p.life * 0.8})`;
      }

      ctx.fill();

      // Glow on projectiles
      if (p.type === 'strike_projectile') {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  }

  clear() {
    this.particles = [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/lib/arena/particles.ts
git commit -m "feat(arena): add ParticleSystem with projectiles, bursts, and triumph fountain"
```

---

## Chunk 2: Event Processor

### Task 5: Create EventProcessor

**Files:**
- Create: `packages/web/lib/arena/event-processor.ts`

- [ ] **Step 1: Write the event processor**

```ts
// packages/web/lib/arena/event-processor.ts
import type { AnimationCommand, TeamMomentum, BasePose, ArenaPhase } from './types.js';

const ENERGY_MAP: Record<string, number> = {
  FILE_CREATE: 0.15,
  FILE_MODIFY: 0.12,
  TOOL_CALL: 0.10,
  REASONING: 0.02,
  ERROR: -0.10,
};

const FLASH_MAP: Record<string, AnimationCommand['flash']> = {
  FILE_CREATE: 'strike',
  FILE_MODIFY: 'strike',
  TOOL_CALL: 'power',
  ERROR: 'hit',
};

const PARTICLE_MAP: Record<string, AnimationCommand['particle']> = {
  FILE_CREATE: 'strike_projectile',
  FILE_MODIFY: 'strike_projectile',
  TOOL_CALL: 'power_burst',
  ERROR: 'hit_sparks',
};

export class EventProcessor {
  private momentum = new Map<string, TeamMomentum>();
  private processedCount = 0;
  private skipAnimations = false; // true during initial catch-up

  constructor(teamIds: string[]) {
    for (const id of teamIds) {
      this.momentum.set(id, {
        energy: 0.3,
        basePose: 'idle',
        lastEventTime: Date.now(),
        recentTypes: [],
        eventCounts: { reasoning: 0, fileCreate: 0, toolCall: 0, error: 0 },
        latestAction: '',
      });
    }
  }

  /** Get current momentum for a team */
  getMomentum(teamId: string): TeamMomentum | undefined {
    return this.momentum.get(teamId);
  }

  /**
   * Process events, skipping animations for historical ones.
   * Call with the full events array; it tracks how many it has already processed.
   */
  processEvents(events: Array<{ type: string; teamId?: string; payload?: any }>, skipCount?: number): AnimationCommand[] {
    const startFrom = skipCount ?? this.processedCount;
    const commands: AnimationCommand[] = [];

    // On first call, process all existing events for momentum only (no animations)
    if (this.processedCount === 0 && startFrom === 0 && events.length > 0) {
      this.skipAnimations = true;
      for (const ev of events) {
        if (ev.teamId) this.updateMomentum(ev);
      }
      this.skipAnimations = false;
      this.processedCount = events.length;
      return commands; // no animation commands for historical events
    }

    for (let i = startFrom; i < events.length; i++) {
      const ev = events[i];
      if (!ev.teamId) continue;
      const cmd = this.processEvent(ev);
      if (cmd) commands.push(cmd);
    }
    this.processedCount = events.length;
    return commands;
  }

  private processEvent(event: { type: string; teamId?: string; payload?: any }): AnimationCommand | null {
    if (!event.teamId) return null;
    this.updateMomentum(event);

    if (this.skipAnimations) return null;
    if (event.type === 'COMMENTARY') return null;

    const flash = FLASH_MAP[event.type];
    const particle = PARTICLE_MAP[event.type];
    if (!flash && !particle) return null;

    return {
      teamId: event.teamId,
      flash,
      particle,
    };
  }

  private updateMomentum(event: { type: string; teamId?: string; payload?: any }) {
    const m = this.momentum.get(event.teamId!);
    if (!m) return;

    // Energy
    const delta = ENERGY_MAP[event.type] ?? 0.01;
    m.energy = Math.max(0, Math.min(1, m.energy + delta));
    m.lastEventTime = Date.now();

    // Event counts
    if (event.type === 'REASONING') m.eventCounts.reasoning++;
    else if (event.type === 'FILE_CREATE' || event.type === 'FILE_MODIFY') m.eventCounts.fileCreate++;
    else if (event.type === 'TOOL_CALL') m.eventCounts.toolCall++;
    else if (event.type === 'ERROR') m.eventCounts.error++;

    // Recent types for base pose selection
    m.recentTypes.push(event.type);
    if (m.recentTypes.length > 5) m.recentTypes.shift();

    // Base pose: thinking if last 5 are all REASONING
    const allReasoning = m.recentTypes.length >= 5 && m.recentTypes.every(t => t === 'REASONING');
    m.basePose = allReasoning ? 'thinking' : 'idle';

    // Latest action text
    const p = event.payload as Record<string, any> | undefined;
    if (event.type === 'FILE_CREATE' || event.type === 'FILE_MODIFY') {
      const text = p?.text ?? p?.path ?? '';
      const filename = typeof text === 'string' ? text.split('/').pop()?.slice(0, 30) : '';
      m.latestAction = filename ? `Creating ${filename}...` : 'Writing files...';
    } else if (event.type === 'TOOL_CALL') {
      m.latestAction = 'Running tools...';
    } else if (event.type === 'REASONING') {
      const text = typeof p?.text === 'string' ? p.text.slice(0, 40) : '';
      if (text) m.latestAction = text + '...';
    } else if (event.type === 'ERROR') {
      m.latestAction = 'Error encountered';
    }
  }

  /** Called every frame for energy decay */
  tick(dt: number) {
    for (const [, m] of this.momentum) {
      if (m.terminalPose) continue; // no decay in terminal state
      m.energy = Math.max(0, m.energy - 0.01 * dt);
    }
  }

  /** Set terminal poses for competition end */
  setTerminalPoses(winnerId: string | null, teamIds: string[]) {
    if (!winnerId) {
      // Tie — all salute
      for (const id of teamIds) {
        const m = this.momentum.get(id);
        if (m) m.terminalPose = 'salute';
      }
    } else {
      for (const id of teamIds) {
        const m = this.momentum.get(id);
        if (m) m.terminalPose = id === winnerId ? 'triumph' : 'kneel';
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/lib/arena/event-processor.ts
git commit -m "feat(arena): add EventProcessor with momentum system and event classification"
```

---

## Chunk 3: BattleArena Component

### Task 6: Create BattleArena React component

**Files:**
- Create: `packages/web/components/BattleArena.tsx`

This is the main component that brings together Canvas rendering, gladiators, particles, HUD, and mini-log.

- [ ] **Step 1: Write the BattleArena component**

This is a large component. Key sections:
1. Props interface matching the spec
2. Canvas ref + requestAnimationFrame loop
3. GladiatorRenderer instances (one per team)
4. ParticleSystem instance
5. EventProcessor instance, processing new events on each render
6. Arena phase management (active/freeze/judging/reveal) based on competition state
7. TRON grid floor drawing
8. HTML HUD overlay (team names, energy bars, timer, counters, latest action)
9. Collapsible mini event log (last 8 events)
10. N-team ring formation layout (positions computed from team count)

The component should:
- Import colors from `packages/web/lib/design-tokens.ts` using `getModelColor(team.model)` for team colors and `BG_DARK` for background
- Use `classifyEvent` from `packages/web/lib/EventRow.tsx` for mini-log event formatting
- Position gladiators in a ring: for N teams, place at `angle = (i / N) * 2π`, facing center
- For 2 teams, use the simpler left/right layout (30%/70% horizontal)
- Manage the mini-log toggle state in localStorage (`arena-mini-log`)

Key implementation notes:
- `useRef` for canvas, gladiators, particles, event processor (mutable refs, not state)
- `useEffect` to start/stop the animation loop
- `useEffect` to detect competition state changes and trigger arena phase transitions
- `useMemo` to compute team positions from team count
- The animation loop: `update(dt)` → `draw()` on every `requestAnimationFrame`

The HUD is HTML positioned absolute over the canvas — NOT drawn on canvas. This gives better text rendering and accessibility.

The mini-log shows last 8 events with: relative timestamp, event type badge (icon + label from `classifyEvent`), team color dot, truncated text.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/components/BattleArena.tsx
git commit -m "feat(arena): add BattleArena component with Canvas renderer, HUD, and mini-log"
```

---

## Chunk 4: Integration

### Task 7: Add view toggle to competition page

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`

- [ ] **Step 1: Add BattleArena import**

At the top of the file (around line 8), add:
```ts
import { BattleArena } from '../../../components/BattleArena';
```

- [ ] **Step 2: Add viewMode state**

In the main `CompetitionPage` component (after existing state declarations around line 2080), add:
```ts
const [viewMode, setViewMode] = useState<'battle' | 'log'>(() => {
  if (typeof window === 'undefined') return 'battle';
  return (localStorage.getItem('arena-view-mode') as 'battle' | 'log') ?? 'battle';
});
```

And an effect to persist it:
```ts
useEffect(() => {
  localStorage.setItem('arena-view-mode', viewMode);
}, [viewMode]);
```

- [ ] **Step 3: Add toggle button to action buttons**

In the action buttons section (around lines 2768-2783, near the Spectate button), add a view toggle button:
```tsx
<button
  onClick={() => setViewMode(v => v === 'battle' ? 'log' : 'battle')}
  style={{
    fontSize: '0.58rem', fontWeight: 700, padding: '0.3rem 0.7rem',
    background: 'rgba(0,240,255,0.08)', color: '#00f0ff',
    border: '1px solid rgba(0,240,255,0.3)', borderRadius: '5px',
    cursor: 'pointer', fontFamily: MONOSPACE_FONT,
  }}
>
  {viewMode === 'battle' ? '📋 Log View' : '⚔ Battle View'}
</button>
```

- [ ] **Step 4: Conditionally render BattleArena or event columns**

Find the per-team lanes grid (around line 2977). Wrap it in a conditional:

```tsx
{viewMode === 'battle' ? (
  <BattleArena
    teams={orderedTeams}
    events={[...broadcastEvents, ...[...teamEvents.values()].flat()].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )}
    state={state}
    elapsedMs={elapsed}
    timeLimitMs={brief?.timeLimitMs ?? 300000}
    scores={result?.teams?.map(t => ({ teamId: t.teamId, finalScore: t.score })) ?? undefined}
    winnerId={result?.winnerId ?? undefined}
  />
) : (
  // existing grid code stays here unchanged
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${numTeams}, 1fr)` }}>
    ...
  </div>
)}
```

Note: The `events` prop combines `broadcastEvents` and all per-team events into one sorted array. This matches what the `EventProcessor` expects.

Also add `winnerId` as an additional prop to `BattleArenaProps` for the end sequence.

- [ ] **Step 5: Mobile fallback**

If `isMobile` is true (already tracked at line 2135), force `viewMode` to `'log'`:
```ts
const effectiveViewMode = isMobile ? 'log' : viewMode;
```
Use `effectiveViewMode` instead of `viewMode` in the conditional render.

- [ ] **Step 6: Type check**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/competitions/[id]/page.tsx
git commit -m "feat(arena): integrate BattleArena with view toggle on competition page"
```

---

## Chunk 5: Polish and Validation

### Task 8: Visual tuning pass

- [ ] **Step 1: Start the stack and run a competition**

```bash
# Terminal 1 — API
DATABASE_URL=postgresql://localhost/arena npx tsx packages/orchestrator/src/cli.ts serve --port 3000

# Terminal 2 — Web
cd packages/web && npm run dev

# Terminal 3 — Competition
DATABASE_URL=postgresql://localhost/arena npx tsx packages/orchestrator/src/cli.ts run briefs/fizzbuzz-cli.yml \
  --team-a claude:architect --team-b codex:standard \
  --skip-sandbox --time-limit 120000
```

- [ ] **Step 2: Watch the battle view**

Open `http://localhost:3001/competitions/<id>` and verify:
- Two gladiators visible, team-colored, facing each other
- Events trigger flash animations (FILE_CREATE = strike, TOOL_CALL = power)
- Energy bars move as events flow
- Momentum affects figure posture (active team leans forward)
- Timer counts down
- Mini-log shows last 8 events
- Toggle button switches to log view and back

- [ ] **Step 3: Tune animation timing and positions**

Adjust as needed:
- Gladiator scale/position if they're too big/small for the canvas
- Glow intensity (`shadowBlur` range)
- Particle speeds and lifetimes
- Energy decay rate
- LERP speed for pose transitions

- [ ] **Step 4: Test end sequence**

Wait for the competition to complete and verify:
- Freeze at TIME_UP
- Judging scanning beam
- Winner reveal with triumph/kneel poses

- [ ] **Step 5: Test 3-team ring**

Run a 3-team competition and verify ring formation works:
```bash
DATABASE_URL=postgresql://localhost/arena npx tsx packages/orchestrator/src/cli.ts run briefs/fizzbuzz-cli.yml \
  --teams claude:architect,codex:standard,gemini:speedrunner \
  --skip-sandbox --time-limit 120000
```

- [ ] **Step 6: Test view on completed competition**

Load an already-completed competition. Verify:
- Battle view shows the end state (winner revealed)
- No animation errors from processing historical events

- [ ] **Step 7: Commit any tuning changes**

```bash
git add -A packages/web/
git commit -m "fix(arena): visual tuning — positions, glow, timing, particles"
```

### Task 9: Update CLAUDE.md and final commit

- [ ] **Step 1: Add Sprint 6 section to CLAUDE.md**

Add under Key Architecture section:
```
### Live battle visualization (Sprint 6)
Competition detail page default view. Canvas 2D arena with procedural wireframe TRON gladiators.
- `packages/web/components/BattleArena.tsx` — main component (Canvas + HUD overlay)
- `packages/web/lib/arena/` — gladiator renderer, poses, event processor, particles, types
- Momentum system: events → energy (0–1) → posture (aggressive/defensive/neutral)
- 8 animation states: idle, thinking, strike, power, hit, triumph, kneel, salute
- View toggle: ⚔ Battle / 📋 Log (persisted in localStorage)
- N-team ring formation for 3-4 teams
- No backend changes — pure client-side Canvas 2D
```

- [ ] **Step 2: Commit and push**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Sprint 6 — live battle visualization"
git push
```
