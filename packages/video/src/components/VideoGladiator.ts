// packages/video/src/components/VideoGladiator.ts
//
// V2 TRON Broadcast renderer — matches the live ArenaViewerV2 silhouette.
// Pure function — no mutable state. Ambient motion is derived from the `frame`
// argument (Math.sin(frame * k)) so Remotion deterministically renders identically.

interface Joints {
  head: [number, number]; neck: [number, number];
  shoulderL: [number, number]; elbowL: [number, number]; handL: [number, number];
  shoulderR: [number, number]; elbowR: [number, number]; handR: [number, number];
  hipL: [number, number]; hipR: [number, number];
  kneeL: [number, number]; kneeR: [number, number];
  footL: [number, number]; footR: [number, number];
}

type PoseName = 'idle' | 'strike' | 'power' | 'hit' | 'triumph' | 'kneel';
type ModelType = 'claude' | 'codex' | 'gemini' | 'default';

interface VisualsV2 {
  helmet: 'tall-crown' | 'heavy-flat' | 'sleek-pointed' | 'hexagonal';
  weapon: 'disc' | 'dual-blades' | 'staff' | 'none';
  shoulders: 'sharp' | 'bulky' | 'asymmetric' | 'symmetric';
}

const MODEL_VISUALS: Record<ModelType, VisualsV2> = {
  claude:  { helmet: 'tall-crown',    weapon: 'disc',        shoulders: 'sharp' },
  codex:   { helmet: 'heavy-flat',    weapon: 'dual-blades', shoulders: 'bulky' },
  gemini:  { helmet: 'sleek-pointed', weapon: 'staff',       shoulders: 'asymmetric' },
  default: { helmet: 'hexagonal',     weapon: 'none',        shoulders: 'symmetric' },
};

/**
 * V2 pose library — ported from packages/web/lib/arena/poses-v2.ts.
 * Figure is ~180 units tall (head y=-100 to feet y=78).
 */
const POSES: Record<PoseName, Joints> = {
  idle: {
    head: [0, -100], neck: [0, -82],
    shoulderL: [-20, -74], shoulderR: [20, -74],
    elbowL: [-24, -42], elbowR: [24, -42],
    handL: [-22, -10], handR: [22, -10],
    hipL: [-12, 0], hipR: [12, 0],
    kneeL: [-12, 38], kneeR: [12, 38],
    footL: [-13, 78], footR: [13, 78],
  },
  strike: {
    head: [-2, -98], neck: [0, -80],
    shoulderL: [-18, -73], shoulderR: [22, -72],
    elbowL: [-28, -48], elbowR: [36, -60],
    handL: [-26, -18], handR: [58, -52],
    hipL: [-12, 0], hipR: [14, 0],
    kneeL: [-14, 36], kneeR: [16, 40],
    footL: [-20, 78], footR: [16, 78],
  },
  power: {
    head: [0, -104], neck: [0, -84],
    shoulderL: [-24, -76], shoulderR: [24, -76],
    elbowL: [-36, -58], elbowR: [36, -58],
    handL: [-34, -96], handR: [34, -96],
    hipL: [-12, 0], hipR: [12, 0],
    kneeL: [-12, 38], kneeR: [12, 38],
    footL: [-13, 78], footR: [13, 78],
  },
  hit: {
    head: [6, -92], neck: [3, -76],
    shoulderL: [-14, -68], shoulderR: [22, -66],
    elbowL: [-20, -42], elbowR: [28, -38],
    handL: [-18, -12], handR: [30, -6],
    hipL: [-10, 4], hipR: [14, 4],
    kneeL: [-12, 40], kneeR: [16, 42],
    footL: [-18, 80], footR: [18, 80],
  },
  triumph: {
    head: [0, -108], neck: [0, -88],
    shoulderL: [-22, -80], shoulderR: [22, -80],
    elbowL: [-34, -100], elbowR: [34, -100],
    handL: [-32, -140], handR: [32, -140],
    hipL: [-12, 0], hipR: [12, 0],
    kneeL: [-12, 38], kneeR: [12, 38],
    footL: [-13, 78], footR: [13, 78],
  },
  kneel: {
    head: [4, -72], neck: [2, -58],
    shoulderL: [-18, -52], shoulderR: [20, -52],
    elbowL: [-22, -28], elbowR: [24, -28],
    handL: [-20, -4], handR: [22, -4],
    hipL: [-12, 20], hipR: [12, 20],
    kneeL: [-14, 60], kneeR: [14, 40],
    footL: [-14, 82], footR: [14, 82],
  },
};

function lerpJoints(a: Joints, b: Joints, t: number): Joints {
  const result = {} as Joints;
  for (const key of Object.keys(a) as (keyof Joints)[]) {
    result[key] = [
      a[key][0] + (b[key][0] - a[key][0]) * t,
      a[key][1] + (b[key][1] - a[key][1]) * t,
    ];
  }
  return result;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

export interface VideoGladiatorConfig {
  teamId: string;
  model: string;
  color: string;
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
  /** Optional terminal pose that persists (used in Winner scene). */
  terminal?: 'triumph' | 'kneel';
}

export interface GladiatorEvent {
  frameOffset: number;
  type: 'strike' | 'power' | 'hit';
}

const FLASH_FRAMES = 15; // ~0.5s @ 30fps — matches v2 flashDuration

// ── Drawing helpers ─────────────────────────────────────────────

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r},${g},${b},${a})`;
}

function fillDark(r: number, g: number, b: number, darkness = 0.94): string {
  const dr = Math.floor(r * (1 - darkness));
  const dg = Math.floor(g * (1 - darkness));
  const db = Math.floor(b * (1 - darkness));
  return `rgba(${dr},${dg},${db},0.95)`;
}

/** Capsule limb with dark body + bright TRON circuit edge. */
function drawCapsule(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  w1: number, w2: number,
  r: number, g: number, b: number,
): void {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;

  ctx.fillStyle = fillDark(r, g, b, 0.94);
  ctx.beginPath();
  ctx.moveTo(x1 + nx * w1, y1 + ny * w1);
  ctx.lineTo(x2 + nx * w2, y2 + ny * w2);
  ctx.lineTo(x2 - nx * w2, y2 - ny * w2);
  ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x1, y1, w1, 0, Math.PI * 2);
  ctx.arc(x2, y2, w2, 0, Math.PI * 2);
  ctx.fill();

  // Outline
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 1.2;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(x1 + nx * w1, y1 + ny * w1);
  ctx.lineTo(x2 + nx * w2, y2 + ny * w2);
  ctx.moveTo(x1 - nx * w1, y1 - ny * w1);
  ctx.lineTo(x2 - nx * w2, y2 - ny * w2);
  ctx.stroke();

  // Bright circuit down one side
  ctx.strokeStyle = rgba(r, g, b, 1);
  ctx.lineWidth = 2;
  ctx.shadowColor = rgba(r, g, b, 1);
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(x1 + nx * (w1 - 0.8), y1 + ny * (w1 - 0.8));
  ctx.lineTo(x2 + nx * (w2 - 0.8), y2 + ny * (w2 - 0.8));
  ctx.stroke();

  // Secondary dim line
  ctx.strokeStyle = rgba(r, g, b, 0.5);
  ctx.lineWidth = 1;
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(x1 - nx * (w1 - 0.8), y1 - ny * (w1 - 0.8));
  ctx.lineTo(x2 - nx * (w2 - 0.8), y2 - ny * (w2 - 0.8));
  ctx.stroke();

  ctx.shadowBlur = 0;
}

function drawHelmet(
  ctx: CanvasRenderingContext2D,
  j: Joints, r: number, g: number, b: number, vis: VisualsV2,
): void {
  const [hx, hy] = j.head;
  ctx.strokeStyle = rgba(r, g, b, 1);
  ctx.lineWidth = 2.4;
  ctx.shadowColor = rgba(r, g, b, 1);
  ctx.shadowBlur = 8;
  ctx.fillStyle = fillDark(r, g, b, 0.9);
  ctx.beginPath();
  if (vis.helmet === 'tall-crown') {
    ctx.moveTo(hx - 10, hy - 4);
    ctx.lineTo(hx - 7, hy - 20);
    ctx.lineTo(hx + 7, hy - 20);
    ctx.lineTo(hx + 10, hy - 4);
    ctx.lineTo(hx + 8, hy + 8);
    ctx.lineTo(hx, hy + 12);
    ctx.lineTo(hx - 8, hy + 8);
    ctx.closePath();
  } else if (vis.helmet === 'heavy-flat') {
    ctx.moveTo(hx - 11, hy - 6);
    ctx.lineTo(hx - 11, hy - 14);
    ctx.lineTo(hx + 11, hy - 14);
    ctx.lineTo(hx + 11, hy - 6);
    ctx.lineTo(hx + 9, hy + 10);
    ctx.lineTo(hx - 9, hy + 10);
    ctx.closePath();
  } else if (vis.helmet === 'sleek-pointed') {
    ctx.moveTo(hx - 10, hy - 4);
    ctx.lineTo(hx - 4, hy - 18);
    ctx.lineTo(hx + 4, hy - 18);
    ctx.lineTo(hx + 10, hy - 4);
    ctx.lineTo(hx + 7, hy + 10);
    ctx.lineTo(hx - 7, hy + 10);
    ctx.closePath();
  } else {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const px = hx + Math.cos(a) * 10;
      const py = hy + Math.sin(a) * 11;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();

  // Visor slit
  ctx.strokeStyle = rgba(r, g, b, 0.8);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(hx - 7, hy + 2);
  ctx.lineTo(hx + 7, hy + 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawTorso(
  ctx: CanvasRenderingContext2D,
  j: Joints, r: number, g: number, b: number,
): void {
  const sl = j.shoulderL, sr = j.shoulderR, hl = j.hipL, hr = j.hipR;

  ctx.fillStyle = fillDark(r, g, b, 0.94);
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 1.2;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(sl[0] - 2, sl[1] + 2);
  ctx.lineTo(sr[0] + 2, sr[1] + 2);
  ctx.lineTo(sr[0] - 2, sr[1] + 26);
  ctx.lineTo(hr[0] + 4, hr[1] - 4);
  ctx.lineTo(hl[0] - 4, hl[1] - 4);
  ctx.lineTo(sl[0] + 2, sl[1] + 26);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = rgba(r, g, b, 0.95);
  ctx.lineWidth = 2;
  ctx.shadowColor = rgba(r, g, b, 1);
  ctx.shadowBlur = 10;
  ctx.stroke();

  // Center seam
  ctx.strokeStyle = rgba(r, g, b, 1);
  ctx.lineWidth = 2.4;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(0, sl[1] + 6);
  ctx.lineTo(0, hl[1] - 2);
  ctx.stroke();

  // Sternum branches
  ctx.strokeStyle = rgba(r, g, b, 0.7);
  ctx.lineWidth = 1.4;
  ctx.shadowBlur = 6;
  const midY = (sl[1] + hl[1]) / 2;
  ctx.beginPath();
  ctx.moveTo(-8, midY - 6);
  ctx.lineTo(0, midY - 12);
  ctx.lineTo(8, midY - 6);
  ctx.stroke();

  // Core gem
  ctx.shadowColor = rgba(r, g, b, 1);
  ctx.shadowBlur = 14;
  ctx.fillStyle = rgba(r, g, b, 1);
  ctx.beginPath();
  ctx.arc(0, midY, 3.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(0, midY, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawHip(
  ctx: CanvasRenderingContext2D,
  j: Joints, r: number, g: number, b: number,
): void {
  ctx.fillStyle = fillDark(r, g, b, 0.94);
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 1.2;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(j.hipL[0] - 4, j.hipL[1] - 4);
  ctx.lineTo(j.hipR[0] + 4, j.hipR[1] - 4);
  ctx.lineTo(j.hipR[0] + 1, j.hipR[1] + 12);
  ctx.lineTo(j.hipL[0] - 1, j.hipL[1] + 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = rgba(r, g, b, 0.9);
  ctx.lineWidth = 1.6;
  ctx.shadowColor = rgba(r, g, b, 1);
  ctx.shadowBlur = 6;
  ctx.stroke();

  // Belt glow
  ctx.strokeStyle = rgba(r, g, b, 1);
  ctx.lineWidth = 2;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(j.hipL[0] - 2, j.hipL[1] + 2);
  ctx.lineTo(j.hipR[0] + 2, j.hipR[1] + 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawShoulders(
  ctx: CanvasRenderingContext2D,
  j: Joints, r: number, g: number, b: number, vis: VisualsV2,
): void {
  ctx.strokeStyle = rgba(r, g, b, 1);
  ctx.lineWidth = 2.2;
  ctx.shadowColor = rgba(r, g, b, 1);
  ctx.shadowBlur = 8;
  ctx.fillStyle = fillDark(r, g, b, 0.9);

  const pauldron = (sx: number, sy: number, side: 1 | -1): void => {
    ctx.beginPath();
    if (vis.shoulders === 'sharp') {
      ctx.moveTo(sx - side * 12, sy - 4);
      ctx.lineTo(sx + side * 2, sy - 8);
      ctx.lineTo(sx + side * 5, sy + 4);
      ctx.lineTo(sx - side * 10, sy + 8);
    } else if (vis.shoulders === 'bulky') {
      ctx.moveTo(sx - side * 14, sy - 2);
      ctx.lineTo(sx + side * 2, sy - 10);
      ctx.lineTo(sx + side * 4, sy + 6);
      ctx.lineTo(sx - side * 12, sy + 10);
    } else if (vis.shoulders === 'asymmetric') {
      if (side === -1) {
        ctx.moveTo(sx - 14, sy - 4);
        ctx.lineTo(sx - 2, sy - 10);
        ctx.lineTo(sx + 2, sy + 4);
        ctx.lineTo(sx - 12, sy + 8);
      } else {
        ctx.moveTo(sx + 2, sy - 8);
        ctx.lineTo(sx - 2, sy - 4);
        ctx.lineTo(sx + 6, sy + 4);
        ctx.lineTo(sx + 10, sy + 2);
      }
    } else {
      ctx.moveTo(sx - side * 10, sy - 4);
      ctx.lineTo(sx + side * 2, sy - 6);
      ctx.lineTo(sx + side * 2, sy + 6);
      ctx.lineTo(sx - side * 8, sy + 6);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  pauldron(j.shoulderL[0], j.shoulderL[1], -1);
  pauldron(j.shoulderR[0], j.shoulderR[1], 1);
  ctx.shadowBlur = 0;
}

function drawArms(
  ctx: CanvasRenderingContext2D,
  j: Joints, r: number, g: number, b: number,
): void {
  drawCapsule(ctx, j.shoulderL[0], j.shoulderL[1], j.elbowL[0], j.elbowL[1], 4.5, 3.6, r, g, b);
  drawCapsule(ctx, j.shoulderR[0], j.shoulderR[1], j.elbowR[0], j.elbowR[1], 4.5, 3.6, r, g, b);
  drawCapsule(ctx, j.elbowL[0], j.elbowL[1], j.handL[0], j.handL[1], 3.6, 3.2, r, g, b);
  drawCapsule(ctx, j.elbowR[0], j.elbowR[1], j.handR[0], j.handR[1], 3.6, 3.2, r, g, b);

  // Hand knobs
  ctx.fillStyle = fillDark(r, g, b, 0.92);
  ctx.beginPath();
  ctx.arc(j.handL[0], j.handL[1], 3.4, 0, Math.PI * 2);
  ctx.arc(j.handR[0], j.handR[1], 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(r, g, b, 0.8);
  ctx.lineWidth = 1.4;
  ctx.shadowColor = rgba(r, g, b, 1);
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(j.handL[0], j.handL[1], 3.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(j.handR[0], j.handR[1], 3.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawLegs(
  ctx: CanvasRenderingContext2D,
  j: Joints, r: number, g: number, b: number, weight: number,
): void {
  drawCapsule(ctx, j.hipL[0] + weight, j.hipL[1], j.kneeL[0] + weight * 0.5, j.kneeL[1], 5.5, 4.2, r, g, b);
  drawCapsule(ctx, j.hipR[0] + weight, j.hipR[1], j.kneeR[0] + weight * 0.5, j.kneeR[1], 5.5, 4.2, r, g, b);
  drawCapsule(ctx, j.kneeL[0] + weight * 0.5, j.kneeL[1], j.footL[0], j.footL[1], 4.2, 3.2, r, g, b);
  drawCapsule(ctx, j.kneeR[0] + weight * 0.5, j.kneeR[1], j.footR[0], j.footR[1], 4.2, 3.2, r, g, b);

  // Feet
  ctx.fillStyle = fillDark(r, g, b, 0.9);
  ctx.strokeStyle = rgba(r, g, b, 0.9);
  ctx.lineWidth = 1.5;
  ctx.shadowColor = rgba(r, g, b, 1);
  ctx.shadowBlur = 5;
  const foot = (fx: number, fy: number): void => {
    ctx.beginPath();
    ctx.moveTo(fx - 5, fy - 2);
    ctx.lineTo(fx + 7, fy - 2);
    ctx.lineTo(fx + 7, fy + 4);
    ctx.lineTo(fx - 5, fy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  foot(j.footL[0], j.footL[1]);
  foot(j.footR[0], j.footR[1]);
  ctx.shadowBlur = 0;
}

function drawWeapon(
  ctx: CanvasRenderingContext2D,
  j: Joints, r: number, g: number, b: number, vis: VisualsV2, frame: number,
): void {
  if (vis.weapon === 'none') return;
  const [hx, hy] = j.handR;
  const spin = frame * 0.1;

  if (vis.weapon === 'disc') {
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(spin);
    ctx.strokeStyle = rgba(r, g, b, 1);
    ctx.lineWidth = 2;
    ctx.shadowColor = rgba(r, g, b, 1);
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = rgba(r, g, b, 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(r, g, b, 1);
    ctx.beginPath();
    ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (vis.weapon === 'dual-blades') {
    const blade = (bx: number, by: number, side: 1 | -1): void => {
      ctx.strokeStyle = rgba(r, g, b, 1);
      ctx.lineWidth = 2.4;
      ctx.shadowColor = rgba(r, g, b, 1);
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(bx + side * 3, by - 2);
      ctx.lineTo(bx + side * 14, by - 8);
      ctx.stroke();
    };
    blade(j.handR[0], j.handR[1], 1);
    blade(j.handL[0], j.handL[1], -1);
  } else if (vis.weapon === 'staff') {
    ctx.strokeStyle = rgba(r, g, b, 1);
    ctx.lineWidth = 2.4;
    ctx.shadowColor = rgba(r, g, b, 1);
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(hx + 2, hy - 18);
    ctx.lineTo(hx + 6, hy + 22);
    ctx.stroke();
    ctx.fillStyle = rgba(r, g, b, 1);
    ctx.beginPath();
    ctx.arc(hx + 2, hy - 18, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  r: number, g: number, b: number,
): void {
  const grad = ctx.createRadialGradient(0, 82, 6, 0, 82, 80);
  grad.addColorStop(0, rgba(r, g, b, 0.55));
  grad.addColorStop(1, rgba(r, g, b, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 82, 56, 7, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ── Main render function ───────────────────────────────────────

/**
 * Render an armored v2 gladiator at a specific frame.
 * Pure — ambient motion is a deterministic function of `frame`.
 */
export function renderVideoGladiator(
  ctx: CanvasRenderingContext2D,
  config: VideoGladiatorConfig,
  frame: number,
  events: GladiatorEvent[],
): void {
  const modelType: ModelType = (['claude', 'codex', 'gemini'].includes(config.model)
    ? config.model
    : 'default') as ModelType;
  const vis = MODEL_VISUALS[modelType];
  const { r, g, b } = hexToRgb(config.color);

  // Determine pose from events (flash priority) or terminal (winner reveal)
  let currentPose: PoseName = 'idle';
  let blendT = 1;
  for (const ev of events) {
    const elapsed = frame - ev.frameOffset;
    if (elapsed >= 0 && elapsed < FLASH_FRAMES) {
      currentPose = ev.type;
      const progress = elapsed / FLASH_FRAMES;
      blendT = progress < 0.5 ? progress * 2 : 2 - progress * 2;
      break;
    }
  }
  // Terminal pose wins if no active flash
  if (currentPose === 'idle' && config.terminal) {
    currentPose = config.terminal;
    blendT = 1;
  }

  const joints = currentPose === 'idle'
    ? POSES.idle
    : lerpJoints(POSES.idle, POSES[currentPose], blendT);

  // Deterministic ambient motion
  const breath = Math.sin(frame * 0.06) * 3.5;
  const weight = Math.sin(frame * 0.037) * 1.4;

  ctx.save();
  ctx.translate(config.x, config.y + breath);
  ctx.scale(config.scale * config.facing, config.scale);

  // Draw order mirrors v2: ground → legs → hip → torso → arms → shoulders → neck → helmet → weapon
  drawGround(ctx, r, g, b);
  drawLegs(ctx, joints, r, g, b, weight);
  drawHip(ctx, joints, r, g, b);
  drawTorso(ctx, joints, r, g, b);
  drawArms(ctx, joints, r, g, b);
  drawShoulders(ctx, joints, r, g, b, vis);
  // Neck capsule
  drawCapsule(ctx, joints.head[0], joints.head[1] + 10, joints.neck[0], joints.neck[1], 4.5, 5.5, r, g, b);
  drawHelmet(ctx, joints, r, g, b, vis);
  drawWeapon(ctx, joints, r, g, b, vis, frame);

  // Impact bloom overlay on active flashes (strike/power/hit)
  if (currentPose === 'strike' || currentPose === 'power' || currentPose === 'hit') {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(r, g, b, 0.08 * blendT);
    ctx.fillRect(-60, -90, 120, 160);
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}
