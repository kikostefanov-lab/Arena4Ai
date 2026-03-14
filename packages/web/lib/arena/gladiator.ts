import type { JointPositions, JointName, ModelBuild, BasePose, FlashPose, TerminalPose } from './types';
import { JOINT_NAMES } from './types';
import { getPose } from './poses';
import { hexToRgb } from '../design-tokens';

const LERP_SPEED = 0.12;
const FLASH_DURATION_STRIKE = 500;
const FLASH_DURATION_POWER = 500;
const FLASH_DURATION_HIT = 400;
const BREATH_SPEED = 0.002;
const BREATH_AMPLITUDE = 1.5;

function lerpValue(current: number, target: number, t: number): number {
  return current + (target - current) * t;
}

function lerpJoint(current: [number, number], target: [number, number], t: number): [number, number] {
  return [lerpValue(current[0], target[0], t), lerpValue(current[1], target[1], t)];
}

/**
 * GladiatorRenderer draws one wireframe figure on a Canvas 2D context.
 * Handles pose interpolation, flash animations, breathing, and glow effects.
 */
export class GladiatorRenderer {
  readonly teamId: string;
  readonly build: ModelBuild;
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly baseScale: number;
  readonly facing: 1 | -1;

  private currentJoints: JointPositions;
  private targetJoints: JointPositions;
  private basePose: BasePose = 'idle';
  private terminalPose: TerminalPose | null = null;
  private flash: FlashPose | null = null;
  private flashTimer = 0;
  private breathPhase = 0;
  private energy = 0;
  private currentScale: number;

  constructor(
    teamId: string,
    build: ModelBuild,
    color: string,
    x: number,
    y: number,
    scale: number,
    facing: 1 | -1,
  ) {
    this.teamId = teamId;
    this.build = build;
    this.color = color;
    this.x = x;
    this.y = y;
    this.baseScale = scale;
    this.currentScale = scale;
    this.facing = facing;
    this.currentJoints = getPose('idle', build);
    this.targetJoints = getPose('idle', build);
  }

  setBasePose(pose: BasePose): void {
    this.basePose = pose;
    if (!this.flash && !this.terminalPose) {
      this.targetJoints = getPose(pose, this.build);
    }
  }

  setTerminalPose(pose: TerminalPose): void {
    this.terminalPose = pose;
    this.targetJoints = getPose(pose, this.build);
  }

  triggerFlash(flash: FlashPose): void {
    this.flash = flash;
    this.flashTimer =
      flash === 'hit' ? FLASH_DURATION_HIT :
      flash === 'strike' ? FLASH_DURATION_STRIKE :
      FLASH_DURATION_POWER;
    this.targetJoints = getPose(flash, this.build);
  }

  /** Advance animation by dt milliseconds. */
  update(dt: number, energy: number): void {
    this.energy = energy;
    this.breathPhase += dt * BREATH_SPEED;

    // Flash timer countdown
    if (this.flash && this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flash = null;
        this.flashTimer = 0;
        // Return to terminal or base pose
        const activePose = this.terminalPose ?? this.basePose;
        this.targetJoints = getPose(activePose, this.build);
      }
    }

    // Energy-based scale adjustment (1.0 at 0 energy, 1.06 at full)
    this.currentScale = this.baseScale * (1.0 + energy * 0.06);

    // Lerp all joints toward target
    const joints = {} as JointPositions;
    for (const name of JOINT_NAMES) {
      joints[name] = lerpJoint(this.currentJoints[name], this.targetJoints[name], LERP_SPEED);
    }

    // Apply breathing offset to vertical joints
    const breathOffset = Math.sin(this.breathPhase) * BREATH_AMPLITUDE;
    joints.head = [joints.head[0], joints.head[1] + breathOffset];
    joints.neck = [joints.neck[0], joints.neck[1] + breathOffset * 0.7];
    joints.shoulderL = [joints.shoulderL[0], joints.shoulderL[1] + breathOffset * 0.5];
    joints.shoulderR = [joints.shoulderR[0], joints.shoulderR[1] + breathOffset * 0.5];

    this.currentJoints = joints;
  }

  /** Draw the wireframe figure to a 2D canvas context. */
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.currentScale * this.facing, this.currentScale);

    const rgb = hexToRgb(this.color);
    const glow = 8 + this.energy * 14; // 8-22 range

    // Hit flash: red tint overlay
    const drawColor = this.flash === 'hit'
      ? `rgba(255,80,80,${0.6 + Math.random() * 0.3})`
      : this.color;
    const drawRgb = this.flash === 'hit' ? '255,80,80' : rgb;

    ctx.strokeStyle = drawColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = `rgba(${drawRgb},0.7)`;
    ctx.shadowBlur = glow;

    const j = this.currentJoints;
    const hipMid: [number, number] = [
      (j.hipL[0] + j.hipR[0]) / 2,
      (j.hipL[1] + j.hipR[1]) / 2,
    ];

    // --- Head: circle + visor ---
    ctx.beginPath();
    ctx.arc(j.head[0], j.head[1], 6, 0, Math.PI * 2);
    ctx.stroke();

    // Visor line across head
    ctx.beginPath();
    ctx.moveTo(j.head[0] - 5, j.head[1]);
    ctx.lineTo(j.head[0] + 5, j.head[1]);
    ctx.stroke();

    // --- Spine: neck to hip midpoint ---
    this.drawLine(ctx, j.neck, hipMid);

    // --- Shoulders ---
    this.drawLine(ctx, j.shoulderL, j.shoulderR);

    // --- Left arm ---
    this.drawLine(ctx, j.shoulderL, j.elbowL);
    this.drawLine(ctx, j.elbowL, j.handL);

    // --- Right arm ---
    this.drawLine(ctx, j.shoulderR, j.elbowR);
    this.drawLine(ctx, j.elbowR, j.handR);

    // --- Hip bar ---
    this.drawLine(ctx, j.hipL, j.hipR);

    // --- Left leg ---
    this.drawLine(ctx, j.hipL, j.kneeL);
    this.drawLine(ctx, j.kneeL, j.footL);

    // --- Right leg ---
    this.drawLine(ctx, j.hipR, j.kneeR);
    this.drawLine(ctx, j.kneeR, j.footR);

    // --- Circuit accent lines on torso (dimmed) ---
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = `rgba(${rgb},0.4)`;
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;

    // Cross-chest accent
    const chestMid: [number, number] = [
      (j.shoulderL[0] + j.shoulderR[0]) / 2,
      (j.shoulderL[1] + j.shoulderR[1]) / 2,
    ];
    const torsoMid: [number, number] = [
      (chestMid[0] + hipMid[0]) / 2,
      (chestMid[1] + hipMid[1]) / 2,
    ];
    this.drawLine(ctx, [chestMid[0] - 6, chestMid[1] + 4], [torsoMid[0] + 4, torsoMid[1]]);
    this.drawLine(ctx, [chestMid[0] + 6, chestMid[1] + 4], [torsoMid[0] - 4, torsoMid[1]]);
    ctx.restore();

    // --- Power orb during power pose ---
    if (this.flash === 'power') {
      ctx.save();
      const orbX = (j.handL[0] + j.handR[0]) / 2;
      const orbY = (j.handL[1] + j.handR[1]) / 2;
      const orbSize = 6 + Math.random() * 4;
      ctx.fillStyle = `rgba(${rgb},${0.4 + Math.random() * 0.3})`;
      ctx.shadowColor = `rgba(${rgb},0.9)`;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(orbX, orbY, orbSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  /** Returns the world-space [x, y] of the right hand (for projectile origin). */
  getHandPosition(): [number, number] {
    const j = this.currentJoints;
    return [
      this.x + j.handR[0] * this.currentScale * this.facing,
      this.y + j.handR[1] * this.currentScale,
    ];
  }

  private drawLine(
    ctx: CanvasRenderingContext2D,
    from: [number, number],
    to: [number, number],
  ): void {
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
  }
}
