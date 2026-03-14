import type { JointPositions, PoseName, ModelBuild } from './types';

/**
 * Base pose definitions — all coordinates relative to figure center (0,0).
 * Y negative = up. Designed for a figure roughly 120px tall at scale 1.
 */
const BASE_POSES: Record<PoseName, JointPositions> = {
  idle: {
    head:      [0, -55],
    neck:      [0, -45],
    shoulderL: [-16, -42],
    shoulderR: [16, -42],
    elbowL:    [-20, -25],
    elbowR:    [20, -25],
    handL:     [-18, -8],
    handR:     [18, -8],
    hipL:      [-10, 0],
    hipR:      [10, 0],
    kneeL:     [-12, 22],
    kneeR:     [12, 22],
    footL:     [-14, 45],
    footR:     [14, 45],
  },

  thinking: {
    head:      [3, -56],
    neck:      [0, -45],
    shoulderL: [-16, -42],
    shoulderR: [16, -42],
    elbowL:    [-22, -28],
    elbowR:    [14, -30],
    handL:     [-20, -12],
    handR:     [6, -48],     // hand near chin
    hipL:      [-10, 0],
    hipR:      [10, 0],
    kneeL:     [-12, 22],
    kneeR:     [12, 22],
    footL:     [-14, 45],
    footR:     [14, 45],
  },

  strike: {
    head:      [-2, -53],
    neck:      [0, -44],
    shoulderL: [-16, -41],
    shoulderR: [16, -41],
    elbowL:    [-24, -30],
    elbowR:    [28, -38],
    handL:     [-22, -16],
    handR:     [42, -35],    // right arm extended forward
    hipL:      [-10, 0],
    hipR:      [10, 0],
    kneeL:     [-14, 20],
    kneeR:     [14, 22],
    footL:     [-18, 45],
    footR:     [12, 45],
  },

  power: {
    head:      [0, -58],
    neck:      [0, -47],
    shoulderL: [-18, -44],
    shoulderR: [18, -44],
    elbowL:    [-32, -36],
    elbowR:    [32, -36],
    handL:     [-38, -48],   // arms wide and up
    handR:     [38, -48],
    hipL:      [-12, 0],
    hipR:      [12, 0],
    kneeL:     [-14, 20],
    kneeR:     [14, 20],
    footL:     [-16, 45],
    footR:     [16, 45],
  },

  hit: {
    head:      [6, -48],
    neck:      [4, -40],
    shoulderL: [-12, -38],
    shoulderR: [18, -36],
    elbowL:    [-20, -22],
    elbowR:    [26, -20],
    handL:     [-24, -8],
    handR:     [30, -6],
    hipL:      [-8, 2],
    hipR:      [12, 0],
    kneeL:     [-14, 24],
    kneeR:     [16, 20],
    footL:     [-16, 45],
    footR:     [18, 44],
  },

  triumph: {
    head:      [0, -60],
    neck:      [0, -48],
    shoulderL: [-18, -44],
    shoulderR: [18, -44],
    elbowL:    [-26, -56],
    elbowR:    [26, -56],
    handL:     [-22, -70],   // arms raised overhead
    handR:     [22, -70],
    hipL:      [-10, 0],
    hipR:      [10, 0],
    kneeL:     [-12, 22],
    kneeR:     [12, 22],
    footL:     [-14, 45],
    footR:     [14, 45],
  },

  kneel: {
    head:      [0, -30],     // head lowered
    neck:      [0, -22],
    shoulderL: [-16, -18],
    shoulderR: [16, -18],
    elbowL:    [-20, -4],
    elbowR:    [20, -4],
    handL:     [-16, 10],
    handR:     [16, 10],
    hipL:      [-10, 18],
    hipR:      [10, 18],
    kneeL:     [-14, 36],    // one knee down
    kneeR:     [8, 40],
    footL:     [-16, 45],
    footR:     [18, 36],
  },

  salute: {
    head:      [0, -55],
    neck:      [0, -45],
    shoulderL: [-16, -42],
    shoulderR: [16, -42],
    elbowL:    [-22, -26],
    elbowR:    [26, -38],
    handL:     [-20, -10],
    handR:     [38, -32],    // right arm extended toward opponent
    hipL:      [-10, 0],
    hipR:      [10, 0],
    kneeL:     [-12, 22],
    kneeR:     [12, 22],
    footL:     [-14, 45],
    footR:     [14, 45],
  },
};

/**
 * Model build multipliers — adjust proportions per model identity.
 * claude: tall and angular
 * codex: stocky and wide
 * gemini: lithe and asymmetric
 */
const BUILD_ADJUSTMENTS: Record<ModelBuild, { scaleX: number; scaleY: number; shoulderWidth: number }> = {
  claude:  { scaleX: 0.95, scaleY: 1.08, shoulderWidth: 1.0 },
  codex:   { scaleX: 1.12, scaleY: 0.94, shoulderWidth: 1.18 },
  gemini:  { scaleX: 0.92, scaleY: 1.02, shoulderWidth: 0.95 },
  default: { scaleX: 1.0,  scaleY: 1.0,  shoulderWidth: 1.0 },
};

/** Joints affected by shoulder width scaling */
const SHOULDER_JOINTS = new Set([
  'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR',
]);

function applyBuild(pose: JointPositions, build: ModelBuild): JointPositions {
  const adj = BUILD_ADJUSTMENTS[build];
  const result = {} as JointPositions;

  for (const joint of Object.keys(pose) as (keyof JointPositions)[]) {
    const [x, y] = pose[joint];
    const sx = SHOULDER_JOINTS.has(joint) ? adj.scaleX * adj.shoulderWidth : adj.scaleX;
    result[joint] = [x * sx, y * adj.scaleY];
  }

  return result;
}

/** Get joint positions for a pose adjusted to the model build. */
export function getPose(pose: PoseName, build: ModelBuild): JointPositions {
  return applyBuild(BASE_POSES[pose], build);
}

/** Resolve a model string (e.g. 'claude:architect') to a ModelBuild. */
export function resolveModelBuild(model: string): ModelBuild {
  const base = model.toLowerCase().split(':')[0];
  if (base === 'claude' || base === 'codex' || base === 'gemini') {
    return base;
  }
  return 'default';
}
