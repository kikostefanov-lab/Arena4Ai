import type { JointPositions, JointName, PoseName, BasePose, TerminalPose, FlashPose, ModelBuild } from './types';
import { JOINT_NAMES } from './types';
import { POSES_V2, resolveVisuals } from './poses-v2';
import { hexToRgb as hexToRgbTriplet } from '../design-tokens';

interface GladiatorV2Opts {
  teamId: string;
  build: ModelBuild;
  color: string;
  x: number;
  y: number;
  scale?: number;
  facing?: 1 | -1;
}

function clonePose(p: JointPositions): JointPositions {
  const out = {} as JointPositions;
  for (const k of JOINT_NAMES) out[k] = [p[k][0], p[k][1]];
  return out;
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function parseHex(hex: string): { r: number; g: number; b: number } {
  const [r, g, b] = hexToRgbTriplet(hex).split(',').map(Number);
  return { r, g, b };
}

function rgba(hex: string, a: number): string {
  const c = parseHex(hex);
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

/**
 * GladiatorV2 — TRON Broadcast armored renderer.
 * Canvas 2D. Capsule limbs, armor plates, pauldrons, chest-gem, weapons.
 *
 * Public API mirrors the handoff prototype exactly:
 *   g.setBase('idle' | 'thinking')
 *   g.setTerminal('triumph' | 'kneel' | 'salute' | null)
 *   g.flash('strike' | 'power' | 'hit', duration?)
 *   g.setEnergy(0..1)
 *   g.update(dtMs, now)
 *   g.draw(ctx)
 */
export class GladiatorV2 {
  teamId: string;
  build: ModelBuild;
  color: string;
  x: number;
  y: number;
  baseScale: number;
  facing: 1 | -1;

  private basePoseName: BasePose = 'idle';
  private terminalPoseName: TerminalPose | null = null;
  private flashPoseName: FlashPose | null = null;
  private flashTime = 0;
  private flashDuration = 0;

  private current: JointPositions;
  private target: JointPositions;

  private breathPhase: number;
  private weightPhase: number;
  energy = 0;
  private hitShake = 0;
  private weaponSpin = 0;

  private _r: number;
  private _g: number;
  private _b: number;

  constructor(opts: GladiatorV2Opts) {
    this.teamId = opts.teamId;
    this.build = opts.build;
    this.color = opts.color;
    this.x = opts.x;
    this.y = opts.y;
    this.baseScale = opts.scale ?? 1;
    this.facing = opts.facing ?? 1;

    this.current = clonePose(POSES_V2.idle);
    this.target = clonePose(POSES_V2.idle);

    this.breathPhase = Math.random() * Math.PI * 2;
    this.weightPhase = Math.random() * Math.PI * 2;

    const c = parseHex(this.color);
    this._r = c.r; this._g = c.g; this._b = c.b;

    this._updateTarget();
  }

  setBase(pose: BasePose): void {
    if (pose !== this.basePoseName) {
      this.basePoseName = pose;
      this._updateTarget();
    }
  }

  setTerminal(pose: TerminalPose | null): void {
    this.terminalPoseName = pose;
    this._updateTarget();
  }

  flash(pose: FlashPose, duration?: number): void {
    this.flashPoseName = pose;
    this.flashDuration = duration ?? (pose === 'hit' ? 420 : 500);
    this.flashTime = 0;
    if (pose === 'hit') this.hitShake = 1;
    this._updateTarget();
  }

  setEnergy(e: number): void {
    this.energy = Math.max(0, Math.min(1, e));
  }

  private _updateTarget(): void {
    let poseName: PoseName;
    if (this.flashPoseName) poseName = this.flashPoseName;
    else if (this.terminalPoseName) poseName = this.terminalPoseName;
    else poseName = this.basePoseName;
    this.target = POSES_V2[poseName];
  }

  update(dtMs: number, _now: number): void {
    // Flash timer
    if (this.flashPoseName) {
      this.flashTime += dtMs;
      if (this.flashTime >= this.flashDuration) {
        this.flashPoseName = null;
        this.flashTime = 0;
        this._updateTarget();
      }
    }

    // Joint lerp toward target — snappier during flash
    const lerpT = this.flashPoseName ? 0.32 : 0.12;
    for (const k of JOINT_NAMES) {
      this.current[k][0] = lerp(this.current[k][0], this.target[k][0], lerpT);
      this.current[k][1] = lerp(this.current[k][1], this.target[k][1], lerpT);
    }

    // Ambient motion
    this.breathPhase += dtMs * 0.0018;
    this.weightPhase += dtMs * 0.0011;
    this.weaponSpin += dtMs * 0.003 * (0.6 + this.energy);

    // Hit shake decay
    this.hitShake *= Math.pow(0.001, dtMs / 1000);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.baseScale;
    const breath = Math.sin(this.breathPhase) * 3.5;
    const weight = Math.sin(this.weightPhase) * 1.4;
    const shake = this.hitShake * (Math.random() - 0.5) * 8;

    ctx.save();
    ctx.translate(this.x + shake, this.y + breath);
    ctx.scale(s * this.facing, s);

    this._drawGround(ctx);
    this._drawLegs(ctx, weight);
    this._drawHip(ctx);
    this._drawTorso(ctx);
    this._drawArms(ctx);
    this._drawShoulders(ctx);
    this._drawNeck(ctx);
    this._drawHelmet(ctx);
    this._drawWeapon(ctx);

    // Impact bloom overlay
    if (this.flashPoseName) {
      const k = 1 - this.flashTime / this.flashDuration;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(this.color, 0.08 * k);
      ctx.fillRect(-60, -90, 120, 160);
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();
  }

  // ── drawing helpers ──────────────────────────────────────────

  private _drawGround(ctx: CanvasRenderingContext2D): void {
    const grad = ctx.createRadialGradient(0, 82, 6, 0, 82, 80);
    grad.addColorStop(0, rgba(this.color, 0.55));
    grad.addColorStop(1, rgba(this.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 82, 56, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private _stroke(ctx: CanvasRenderingContext2D, w: number, a = 1): void {
    ctx.strokeStyle = rgba(this.color, a);
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
  }

  private _fill(ctx: CanvasRenderingContext2D, darkness = 0.93): void {
    const r = Math.floor(this._r * (1 - darkness));
    const g = Math.floor(this._g * (1 - darkness));
    const b = Math.floor(this._b * (1 - darkness));
    ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
  }

  /** Filled capsule limb segment with TRON edge circuit. */
  private _capsule(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number, x2: number, y2: number,
    widthStart: number, widthEnd?: number,
  ): void {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w1 = widthStart, w2 = widthEnd ?? widthStart;

    this._fill(ctx, 0.94);
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

    // Dark outline
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
    ctx.strokeStyle = rgba(this.color, 1);
    ctx.lineWidth = 2;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(x1 + nx * (w1 - 0.8), y1 + ny * (w1 - 0.8));
    ctx.lineTo(x2 + nx * (w2 - 0.8), y2 + ny * (w2 - 0.8));
    ctx.stroke();

    // Secondary thin line opposite side
    ctx.strokeStyle = rgba(this.color, 0.5);
    ctx.lineWidth = 1;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(x1 - nx * (w1 - 0.8), y1 - ny * (w1 - 0.8));
    ctx.lineTo(x2 - nx * (w2 - 0.8), y2 - ny * (w2 - 0.8));
    ctx.stroke();

    ctx.shadowBlur = 0;
  }

  private _drawHelmet(ctx: CanvasRenderingContext2D): void {
    const j = this.current;
    const [hx, hy] = j.head;
    const vis = resolveVisuals(this.build);
    this._stroke(ctx, 2.4);
    this._fill(ctx, 0.9);
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
      // hexagonal
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

    this._stroke(ctx, 1.3, 0.8);
    ctx.beginPath();
    ctx.moveTo(hx - 7, hy + 2);
    ctx.lineTo(hx + 7, hy + 2);
    ctx.stroke();
  }

  private _drawNeck(ctx: CanvasRenderingContext2D): void {
    const j = this.current;
    this._capsule(ctx, j.head[0], j.head[1] + 10, j.neck[0], j.neck[1], 4.5, 5.5);
  }

  private _drawTorso(ctx: CanvasRenderingContext2D): void {
    const j = this.current;
    const sl = j.shoulderL, sr = j.shoulderR, hl = j.hipL, hr = j.hipR;

    // Chest plate
    this._fill(ctx, 0.94);
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

    // Team-color stroke
    ctx.strokeStyle = rgba(this.color, 0.95);
    ctx.lineWidth = 2;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;
    ctx.stroke();

    // Center seam
    ctx.strokeStyle = rgba(this.color, 1);
    ctx.lineWidth = 2.4;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(0, sl[1] + 6);
    ctx.lineTo(0, hl[1] - 2);
    ctx.stroke();

    // Sternum branches
    ctx.strokeStyle = rgba(this.color, 0.7);
    ctx.lineWidth = 1.4;
    ctx.shadowBlur = 6;
    const midY = (sl[1] + hl[1]) / 2;
    ctx.beginPath();
    ctx.moveTo(-8, midY - 6);
    ctx.lineTo(0, midY - 12);
    ctx.lineTo(8, midY - 6);
    ctx.stroke();

    // Chest core gem
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = rgba(this.color, 1);
    ctx.beginPath();
    ctx.arc(0, midY, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(0, midY, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  private _drawHip(ctx: CanvasRenderingContext2D): void {
    const j = this.current;
    this._fill(ctx, 0.94);
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

    ctx.strokeStyle = rgba(this.color, 0.9);
    ctx.lineWidth = 1.6;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 6;
    ctx.stroke();

    // Belt glow
    ctx.strokeStyle = rgba(this.color, 1);
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(j.hipL[0] - 2, j.hipL[1] + 2);
    ctx.lineTo(j.hipR[0] + 2, j.hipR[1] + 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  private _drawShoulders(ctx: CanvasRenderingContext2D): void {
    const j = this.current;
    const vis = resolveVisuals(this.build);
    this._stroke(ctx, 2.2);
    this._fill(ctx, 0.9);

    const drawPauldron = (sx: number, sy: number, side: 1 | -1): void => {
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

    drawPauldron(j.shoulderL[0], j.shoulderL[1], -1);
    drawPauldron(j.shoulderR[0], j.shoulderR[1], 1);
  }

  private _drawArms(ctx: CanvasRenderingContext2D): void {
    const j = this.current;
    this._capsule(ctx, j.shoulderL[0], j.shoulderL[1], j.elbowL[0], j.elbowL[1], 4.5, 3.6);
    this._capsule(ctx, j.shoulderR[0], j.shoulderR[1], j.elbowR[0], j.elbowR[1], 4.5, 3.6);
    this._capsule(ctx, j.elbowL[0], j.elbowL[1], j.handL[0], j.handL[1], 3.6, 3.2);
    this._capsule(ctx, j.elbowR[0], j.elbowR[1], j.handR[0], j.handR[1], 3.6, 3.2);

    // Hand knobs
    this._fill(ctx, 0.92);
    ctx.beginPath();
    ctx.arc(j.handL[0], j.handL[1], 3.4, 0, Math.PI * 2);
    ctx.arc(j.handR[0], j.handR[1], 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(this.color, 0.8);
    ctx.lineWidth = 1.4;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(j.handL[0], j.handL[1], 3.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(j.handR[0], j.handR[1], 3.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  private _drawLegs(ctx: CanvasRenderingContext2D, weight: number): void {
    const j = this.current;
    this._capsule(ctx, j.hipL[0] + weight, j.hipL[1], j.kneeL[0] + weight * 0.5, j.kneeL[1], 5.5, 4.2);
    this._capsule(ctx, j.hipR[0] + weight, j.hipR[1], j.kneeR[0] + weight * 0.5, j.kneeR[1], 5.5, 4.2);
    this._capsule(ctx, j.kneeL[0] + weight * 0.5, j.kneeL[1], j.footL[0], j.footL[1], 4.2, 3.2);
    this._capsule(ctx, j.kneeR[0] + weight * 0.5, j.kneeR[1], j.footR[0], j.footR[1], 4.2, 3.2);

    // Feet — armored blocks
    this._fill(ctx, 0.9);
    ctx.strokeStyle = rgba(this.color, 0.9);
    ctx.lineWidth = 1.5;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 5;
    const drawFoot = (fx: number, fy: number): void => {
      ctx.beginPath();
      ctx.moveTo(fx - 5, fy - 2);
      ctx.lineTo(fx + 7, fy - 2);
      ctx.lineTo(fx + 7, fy + 4);
      ctx.lineTo(fx - 5, fy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    drawFoot(j.footL[0], j.footL[1]);
    drawFoot(j.footR[0], j.footR[1]);
    ctx.shadowBlur = 0;
  }

  private _drawWeapon(ctx: CanvasRenderingContext2D): void {
    const j = this.current;
    const vis = resolveVisuals(this.build);
    if (vis.weapon === 'none') return;
    const [hx, hy] = j.handR;

    if (vis.weapon === 'disc') {
      // Identity disc — rotates in idle, thrusts on strike
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(this.weaponSpin);
      ctx.strokeStyle = rgba(this.color, 1);
      ctx.lineWidth = 2;
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(this.color, 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = rgba(this.color, 1);
      ctx.beginPath();
      ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (vis.weapon === 'dual-blades') {
      // Codex — forearm blade, both hands
      const drawBlade = (bx: number, by: number, side: 1 | -1): void => {
        ctx.strokeStyle = rgba(this.color, 1);
        ctx.lineWidth = 2.4;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(bx + side * 3, by - 2);
        ctx.lineTo(bx + side * 14, by - 8);
        ctx.stroke();
      };
      drawBlade(j.handR[0], j.handR[1], 1);
      drawBlade(j.handL[0], j.handL[1], -1);
    } else if (vis.weapon === 'staff') {
      // Gemini — energy staff
      ctx.strokeStyle = rgba(this.color, 1);
      ctx.lineWidth = 2.4;
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(hx + 2, hy - 18);
      ctx.lineTo(hx + 6, hy + 22);
      ctx.stroke();
      // Tip gem
      ctx.fillStyle = rgba(this.color, 1);
      ctx.beginPath();
      ctx.arc(hx + 2, hy - 18, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}
