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
  const result = {} as Joints;
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
    ctx.fillStyle = `rgba(255,80,80,${0.6 + (Math.sin(frame * 7.3) * 0.5 + 0.5) * 0.2})`;
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
