// packages/video/src/components/VideoGladiator.ts

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
type WeaponType = 'disc' | 'dual-blades' | 'staff' | 'none';
type ShoulderStyle = 'sharp' | 'bulky' | 'asymmetric' | 'symmetric';

const MODEL_CONFIG: Record<ModelType, { weapon: WeaponType; shoulder: ShoulderStyle }> = {
  claude:  { weapon: 'disc',        shoulder: 'sharp' },
  codex:   { weapon: 'dual-blades', shoulder: 'bulky' },
  gemini:  { weapon: 'staff',       shoulder: 'asymmetric' },
  default: { weapon: 'none',        shoulder: 'symmetric' },
};

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

// ── Drawing helpers (frame-based, no mutable state) ──

function drawShoulderPlates(
  ctx: CanvasRenderingContext2D,
  joints: Joints, r: number, g: number, b: number,
  style: ShoulderStyle,
): void {
  ctx.save();
  ctx.fillStyle = `rgba(${r},${g},${b},0.15)`;
  ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`;
  ctx.lineWidth = 1.2;

  const drawPlate = (cx: number, cy: number, mirror: boolean) => {
    ctx.beginPath();
    const m = mirror ? -1 : 1;
    switch (style) {
      case 'sharp':
        ctx.moveTo(cx, cy - 4);
        ctx.lineTo(cx + m * 10, cy - 6);
        ctx.lineTo(cx + m * 12, cy);
        ctx.lineTo(cx + m * 8, cy + 3);
        ctx.lineTo(cx, cy + 2);
        break;
      case 'bulky':
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx + m * 12, cy - 5);
        ctx.lineTo(cx + m * 14, cy);
        ctx.lineTo(cx + m * 12, cy + 4);
        ctx.lineTo(cx, cy + 3);
        break;
      case 'asymmetric': {
        const size = mirror ? 11 : 8;
        ctx.moveTo(cx, cy - 4);
        ctx.lineTo(cx + m * size, cy - 3);
        ctx.lineTo(cx + m * (size + 1), cy + 1);
        ctx.lineTo(cx + m * (size - 2), cy + 4);
        ctx.lineTo(cx, cy + 2);
        break;
      }
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

  drawPlate(joints.shoulderL[0], joints.shoulderL[1], true);
  drawPlate(joints.shoulderR[0], joints.shoulderR[1], false);
  ctx.restore();
}

function drawArmorPlates(
  ctx: CanvasRenderingContext2D,
  joints: Joints, r: number, g: number, b: number,
): void {
  ctx.save();
  ctx.fillStyle = `rgba(${r},${g},${b},0.10)`;
  ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`;
  ctx.lineWidth = 1;

  const hipMidX = (joints.hipL[0] + joints.hipR[0]) / 2;
  const hipMidY = (joints.hipL[1] + joints.hipR[1]) / 2;
  const chestMidY = (joints.neck[1] + hipMidY) / 2;

  // Chest plate — pentagon
  ctx.beginPath();
  ctx.moveTo(joints.shoulderL[0] + 2, joints.shoulderL[1]);
  ctx.lineTo(joints.shoulderR[0] - 2, joints.shoulderR[1]);
  ctx.lineTo(joints.shoulderR[0] - 1, chestMidY);
  ctx.lineTo(hipMidX, chestMidY + 6);
  ctx.lineTo(joints.shoulderL[0] + 1, chestMidY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Hip plate — trapezoid
  ctx.beginPath();
  ctx.moveTo(joints.hipL[0] + 2, joints.hipL[1] - 2);
  ctx.lineTo(joints.hipR[0] - 2, joints.hipR[1] - 2);
  ctx.lineTo(joints.hipR[0] - 1, joints.hipR[1] + 4);
  ctx.lineTo(joints.hipL[0] + 1, joints.hipL[1] + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Shin guards
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

function drawWeapon(
  ctx: CanvasRenderingContext2D,
  joints: Joints, r: number, g: number, b: number,
  weapon: WeaponType, frame: number,
): void {
  if (weapon === 'none') return;
  ctx.save();
  const phase = frame * 0.1;
  const brightness = 0.7;

  switch (weapon) {
    case 'disc': {
      const hx = joints.handR[0];
      const hy = joints.handR[1];
      ctx.translate(hx, hy);
      ctx.rotate(phase * 1.5);
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r},${g},${b},${brightness})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
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
    case 'dual-blades': {
      for (const hand of [joints.handL, joints.handR] as const) {
        const elbow = hand === joints.handL ? joints.elbowL : joints.elbowR;
        const dx = hand[0] - elbow[0];
        const dy = hand[1] - elbow[1];
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / len;
        const ny = dy / len;
        const bladeLen = 14;
        const tipX = hand[0] + nx * bladeLen;
        const tipY = hand[1] + ny * bladeLen;
        ctx.beginPath();
        ctx.moveTo(hand[0], hand[1]);
        ctx.lineTo(tipX, tipY);
        ctx.strokeStyle = `rgba(${r},${g},${b},${brightness})`;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(tipX, tipY, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${brightness})`;
        ctx.fill();
      }
      break;
    }
    case 'staff': {
      const hx = joints.handR[0];
      const hy = joints.handR[1];
      const staffLen = 28;
      const angle = -Math.PI / 6;
      const topX = hx + Math.cos(angle) * staffLen / 2;
      const topY = hy + Math.sin(angle) * staffLen / 2;
      const botX = hx - Math.cos(angle) * staffLen / 2;
      const botY = hy - Math.sin(angle) * staffLen / 2;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(botX, botY);
      ctx.strokeStyle = `rgba(${r},${g},${b},${brightness * 0.7})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      for (const [tx, ty] of [[topX, topY], [botX, botY]]) {
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${brightness})`;
        ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      // Crackling energy arc
      const midX = (topX + botX) / 2;
      const midY = (topY + botY) / 2;
      const jitter = Math.sin(phase * 8) * 3;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.quadraticCurveTo(midX + jitter, midY + jitter, botX, botY);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.3)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

function drawReflection(
  ctx: CanvasRenderingContext2D,
  joints: Joints, r: number, g: number, b: number,
): void {
  ctx.save();
  const groundY = Math.max(joints.footL[1], joints.footR[1]);
  ctx.translate(0, groundY * 2 + 4);
  ctx.scale(1, -0.25);
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  const hipMidX = (joints.hipL[0] + joints.hipR[0]) / 2;
  const hipMidY = (joints.hipL[1] + joints.hipR[1]) / 2;

  ctx.beginPath();
  ctx.moveTo(joints.neck[0], joints.neck[1]);
  ctx.lineTo(hipMidX, hipMidY);
  ctx.stroke();

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

// ── Main render function ──

/**
 * Render an armored gladiator at a specific frame.
 * Pure function — no mutable state. Computes pose from frame + events.
 */
export function renderVideoGladiator(
  ctx: CanvasRenderingContext2D,
  config: VideoGladiatorConfig,
  frame: number,
  events: GladiatorEvent[],
): void {
  const modelType: ModelType = (['claude','codex','gemini'].includes(config.model) ? config.model : 'default') as ModelType;
  const modelCfg = MODEL_CONFIG[modelType];
  const { r, g, b } = hexToRgb(config.color);

  // Determine current pose from events — find the most recent active flash
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

  // Lerp between idle and target pose
  const joints = currentPose === 'idle'
    ? POSES.idle
    : lerpJoints(POSES.idle, POSES[currentPose], blendT);

  // Breathing bob
  const breathY = Math.sin(frame * 0.1) * 1.5;

  ctx.save();
  ctx.translate(config.x, config.y);
  ctx.scale(config.scale * config.facing, config.scale);

  // Weight shift
  const weightShift = Math.sin(frame * 0.04) * 1.5;
  ctx.translate(weightShift, 0);

  const glow = 14;
  const hipMidX = (joints.hipL[0] + joints.hipR[0]) / 2;
  const hipMidY = (joints.hipL[1] + joints.hipR[1]) / 2;

  // 1. Aura — 3 concentric pulsing layers
  const auraPulse = Math.sin(frame * 0.08);
  for (let i = 0; i < 3; i++) {
    const baseR = 25 + i * 12;
    const radius = baseR + auraPulse * 3 * (i + 1);
    const alpha = 0.03 - i * 0.008;
    ctx.beginPath();
    ctx.ellipse(0, hipMidY - 10, radius * 0.7, radius, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${Math.max(0, alpha)})`;
    ctx.fill();
  }

  // 2. Ground reflection
  drawReflection(ctx, joints, r, g, b);

  // 3. Circuit traces
  ctx.setLineDash([4, 6]);
  ctx.lineDashOffset = -(frame * 2);
  ctx.strokeStyle = `rgba(${r},${g},${b},0.25)`;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(joints.neck[0] + 2, joints.neck[1] + breathY + 2);
  ctx.lineTo(hipMidX + 2, hipMidY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(joints.neck[0] - 2, joints.neck[1] + breathY + 2);
  ctx.lineTo(hipMidX - 2, hipMidY);
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

  // 4. Armor plates
  drawArmorPlates(ctx, joints, r, g, b);

  // 5. Skeleton — double-stroked limbs
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

  // Outer stroke with breathing
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

  // Inner stroke (thinner, for depth)
  ctx.strokeStyle = `rgba(${r},${g},${b},0.4)`;
  ctx.lineWidth = 1;
  ctx.shadowBlur = 0;
  drawLine(joints.neck, [hipMidX, hipMidY], breathY * 0.7);
  drawLine(joints.shoulderL, joints.elbowL, breathY * 0.5);
  drawLine(joints.elbowL, joints.handL, breathY * 0.3);
  drawLine(joints.shoulderR, joints.elbowR, breathY * 0.5);
  drawLine(joints.elbowR, joints.handR, breathY * 0.3);
  drawLine(joints.hipL, joints.kneeL);
  drawLine(joints.kneeL, joints.footL);
  drawLine(joints.hipR, joints.kneeR);
  drawLine(joints.kneeR, joints.footR);

  // 6. Shoulder plates
  drawShoulderPlates(ctx, joints, r, g, b, modelCfg.shoulder);

  // 7. Helmet
  ctx.shadowBlur = glow;
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
  ctx.shadowBlur = 0;

  // 8. Weapon
  ctx.shadowBlur = glow;
  drawWeapon(ctx, joints, r, g, b, modelCfg.weapon, frame);
  ctx.shadowBlur = 0;

  // 9. Hit flash overlay
  if (currentPose === 'hit') {
    ctx.fillStyle = `rgba(255,80,80,${0.6 + (Math.sin(frame * 7.3) * 0.5 + 0.5) * 0.2})`;
    ctx.fillRect(-15, joints.head[1] - 14, 30, 60);
  }

  // 10. Power orb
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

  // Visor flicker (every ~3s at 30fps)
  if (Math.sin(frame * 0.035) > 0.97) {
    ctx.fillStyle = `rgba(${r},${g},${b},1.0)`;
    ctx.fillRect(headX - 5, headY - 2, 10, 2);
  }

  ctx.restore();
}
