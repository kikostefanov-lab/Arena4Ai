import type { JointPositions, PoseName } from './types';

/**
 * V2 pose library — ported from handoff-bundle/design-handoff/gladiator.jsx.
 *
 * Figure is ~180px tall at scale 1 (8-heads proportion). Y-origin is hip line;
 * head crown ≈ y=-112, feet ≈ y=+80. Roughly 2× v1's 120px figure.
 *
 * These are the full-bodied TRON Broadcast poses used by GladiatorV2.
 */
export const POSES_V2: Record<PoseName, JointPositions> = {
  idle: {
    head:      [0, -100],
    neck:      [0, -82],
    shoulderL: [-20, -74],
    shoulderR: [20, -74],
    elbowL:    [-24, -42],
    elbowR:    [24, -42],
    handL:     [-22, -10],
    handR:     [22, -10],
    hipL:      [-12, 0],
    hipR:      [12, 0],
    kneeL:     [-12, 38],
    kneeR:     [12, 38],
    footL:     [-13, 78],
    footR:     [13, 78],
  },

  thinking: {
    head:      [2, -100],
    neck:      [0, -82],
    shoulderL: [-20, -74],
    shoulderR: [20, -74],
    elbowL:    [-26, -46],
    elbowR:    [18, -48],
    handL:     [-20, -14],
    handR:     [8, -78],     // chin-rub
    hipL:      [-12, 0],
    hipR:      [12, 0],
    kneeL:     [-12, 38],
    kneeR:     [12, 38],
    footL:     [-13, 78],
    footR:     [13, 78],
  },

  strike: {
    head:      [-2, -98],
    neck:      [0, -80],
    shoulderL: [-18, -73],
    shoulderR: [22, -72],
    elbowL:    [-28, -48],
    elbowR:    [36, -60],
    handL:     [-26, -18],
    handR:     [58, -52],    // thrust forward
    hipL:      [-12, 0],
    hipR:      [14, 0],
    kneeL:     [-14, 36],
    kneeR:     [16, 40],
    footL:     [-20, 78],
    footR:     [16, 78],
  },

  power: {
    head:      [0, -104],
    neck:      [0, -84],
    shoulderL: [-24, -76],
    shoulderR: [24, -76],
    elbowL:    [-36, -58],
    elbowR:    [36, -58],
    handL:     [-34, -96],   // arms raised high
    handR:     [34, -96],
    hipL:      [-12, 0],
    hipR:      [12, 0],
    kneeL:     [-12, 38],
    kneeR:     [12, 38],
    footL:     [-13, 78],
    footR:     [13, 78],
  },

  hit: {
    head:      [6, -92],
    neck:      [3, -76],     // knocked back
    shoulderL: [-14, -68],
    shoulderR: [22, -66],
    elbowL:    [-20, -42],
    elbowR:    [28, -38],
    handL:     [-18, -12],
    handR:     [30, -6],
    hipL:      [-10, 4],
    hipR:      [14, 4],
    kneeL:     [-12, 40],
    kneeR:     [16, 42],
    footL:     [-18, 80],
    footR:     [18, 80],
  },

  triumph: {
    head:      [0, -108],
    neck:      [0, -88],
    shoulderL: [-22, -80],
    shoulderR: [22, -80],
    elbowL:    [-34, -100],
    elbowR:    [34, -100],
    handL:     [-32, -140],  // fists high
    handR:     [32, -140],
    hipL:      [-12, 0],
    hipR:      [12, 0],
    kneeL:     [-12, 38],
    kneeR:     [12, 38],
    footL:     [-13, 78],
    footR:     [13, 78],
  },

  kneel: {
    head:      [4, -72],
    neck:      [2, -58],
    shoulderL: [-18, -52],
    shoulderR: [20, -52],
    elbowL:    [-22, -28],
    elbowR:    [24, -28],
    handL:     [-20, -4],
    handR:     [22, -4],
    hipL:      [-12, 20],
    hipR:      [12, 20],
    kneeL:     [-14, 60],    // one knee down
    kneeR:     [14, 40],
    footL:     [-14, 82],
    footR:     [14, 82],
  },

  salute: {
    head:      [0, -100],
    neck:      [0, -82],
    shoulderL: [-20, -74],
    shoulderR: [20, -74],
    elbowL:    [-24, -42],
    elbowR:    [12, -66],
    handL:     [-22, -10],
    handR:     [2, -98],     // hand to brow
    hipL:      [-12, 0],
    hipR:      [12, 0],
    kneeL:     [-12, 38],
    kneeR:     [12, 38],
    footL:     [-13, 78],
    footR:     [13, 78],
  },
};

/** Model-specific armor/weapon/helmet config for GladiatorV2. */
export interface ModelVisualsV2 {
  helmet: 'tall-crown' | 'heavy-flat' | 'sleek-pointed' | 'hexagonal';
  weapon: 'disc' | 'dual-blades' | 'staff' | 'none';
  shoulders: 'sharp' | 'bulky' | 'asymmetric' | 'symmetric';
}

export const MODEL_VISUALS_V2: Record<string, ModelVisualsV2> = {
  claude:  { helmet: 'tall-crown',    weapon: 'disc',        shoulders: 'sharp' },
  codex:   { helmet: 'heavy-flat',    weapon: 'dual-blades', shoulders: 'bulky' },
  gemini:  { helmet: 'sleek-pointed', weapon: 'staff',       shoulders: 'asymmetric' },
  default: { helmet: 'hexagonal',     weapon: 'none',        shoulders: 'symmetric' },
};

export function resolveVisuals(build: string): ModelVisualsV2 {
  return MODEL_VISUALS_V2[build] ?? MODEL_VISUALS_V2.default;
}
