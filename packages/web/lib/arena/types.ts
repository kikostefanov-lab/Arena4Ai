/** 14 joints define the wireframe figure */
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
  energy: number;          // 0-1, decays over time
  basePose: BasePose;
  terminalPose?: TerminalPose;
  lastEventTime: number;
  recentTypes: string[];   // last 5 event types
  eventCounts: { reasoning: number; fileCreate: number; toolCall: number; error: number };
  latestAction: string;
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
  x: number; y: number;
  vx: number; vy: number;
  life: number;     // 0-1 decreasing
  maxLife: number;
  color: string;
  size: number;
}

export type ArenaPhase = 'active' | 'freeze' | 'judging' | 'reveal';
