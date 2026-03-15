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
    this.currentScale = this.baseScale * (1.0 + energy * 0.04);

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

  /** Parse hex color to {r, g, b} */
  private hexToRgb(): { r: number; g: number; b: number } {
    const hex = this.color.replace('#', '');
    return {
      r: parseInt(hex.substring(0, 2), 16),
      g: parseInt(hex.substring(2, 4), 16),
      b: parseInt(hex.substring(4, 6), 16),
    };
  }

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
}
