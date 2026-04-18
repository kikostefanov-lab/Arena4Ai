import type { ArenaPhase } from './types';
import { hexToRgb as hexToRgbTriplet } from '../design-tokens';

function rgba(hex: string, a: number): string {
  return `rgba(${hexToRgbTriplet(hex)},${a})`;
}

interface RingPulse {
  t: number;
  dur: number;
  color: string;
}

/**
 * ArenaRingV2 — floor grid, outer/inner rings, tick marks, phase tint, impact pulses.
 * Ported from handoff-bundle/design-handoff/ring.jsx.
 */
export class ArenaRingV2 {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  private pulses: RingPulse[] = [];
  phaseTint = '#00f0ff';
  phaseIntensity = 0;
  confettiFired = false;

  constructor(cx: number, cy: number, rx: number, ry: number) {
    this.cx = cx;
    this.cy = cy;
    this.rx = rx;
    this.ry = ry;
  }

  setPhase(phase: ArenaPhase, winnerColor?: string): void {
    if (phase === 'reveal' && winnerColor) {
      this.phaseTint = winnerColor;
      this.phaseIntensity = 0.9;
    } else if (phase === 'judging' || phase === 'freeze') {
      this.phaseTint = '#ff6600';
      this.phaseIntensity = 0.7;
    } else {
      this.phaseTint = '#00f0ff';
      this.phaseIntensity = 0.45;
    }
  }

  pulse(color: string): void {
    this.pulses.push({ t: 0, dur: 500, color });
  }

  update(dtMs: number): void {
    this.pulses = this.pulses.filter((p) => {
      p.t += dtMs;
      return p.t < p.dur;
    });
  }

  reset(): void {
    this.pulses = [];
    this.confettiFired = false;
  }

  drawGrid(ctx: CanvasRenderingContext2D, dim = 1): void {
    const { cx, cy, rx, ry } = this;
    ctx.save();
    ctx.globalAlpha = 0.5 * dim;

    ctx.strokeStyle = rgba('#00f0ff', 0.18);
    ctx.lineWidth = 1;
    const rows = 10;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const y = cy - ry * 0.3 + t * ry * 1.3;
      const widthT = 0.3 + t * 0.9;
      const w = rx * widthT;
      ctx.beginPath();
      ctx.moveTo(cx - w, y);
      ctx.lineTo(cx + w, y);
      ctx.stroke();
    }

    const cols = 12;
    for (let i = 0; i <= cols; i++) {
      const t = i / cols;
      const x0 = cx + (t - 0.5) * rx * 0.6;
      const x1 = cx + (t - 0.5) * rx * 2.4;
      ctx.beginPath();
      ctx.moveTo(x0, cy - ry * 0.3);
      ctx.lineTo(x1, cy + ry);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRing(ctx: CanvasRenderingContext2D): void {
    const { cx, cy, rx, ry, phaseTint, phaseIntensity } = this;
    ctx.save();

    // Outer
    ctx.strokeStyle = rgba(phaseTint, 0.9 * phaseIntensity + 0.1);
    ctx.lineWidth = 2.5;
    ctx.shadowColor = phaseTint;
    ctx.shadowBlur = 18 * phaseIntensity;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Inner
    ctx.strokeStyle = rgba(phaseTint, 0.35);
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.92, ry * 0.92, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Ticks
    ctx.strokeStyle = rgba(phaseTint, 0.6);
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 4;
    const ticks = 36;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2;
      const long = i % 3 === 0;
      const l = long ? 10 : 5;
      const x0 = cx + Math.cos(a) * rx;
      const y0 = cy + Math.sin(a) * ry;
      const x1 = cx + Math.cos(a) * (rx + l);
      const y1 = cy + Math.sin(a) * (ry + l);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Pulses
    for (const p of this.pulses) {
      const k = p.t / p.dur;
      const ease = 1 - Math.pow(1 - k, 3);
      const alpha = (1 - k) * 0.6;
      ctx.strokeStyle = rgba(p.color, alpha);
      ctx.lineWidth = 2 + (1 - k) * 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * (1 + ease * 0.08), ry * (1 + ease * 0.08), 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// ── Particle system ─────────────────────────────────────────────

interface ShockParticle {
  kind: 'shock';
  x: number; y: number;
  color: string;
  t: number; dur: number;
  r: number;
}

interface SparkParticle {
  kind: 'spark';
  x: number; y: number;
  color: string;
  t: number; dur: number;
  vx: number; vy: number;
  size: number;
  gravity?: number;
}

type Particle = ShockParticle | SparkParticle;

export class ShockwavesV2 {
  private list: Particle[] = [];

  spawnShockwave(x: number, y: number, color: string): void {
    this.list.push({ kind: 'shock', x, y, color, t: 0, dur: 420, r: 8 });
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 120;
      this.list.push({
        kind: 'spark', x, y, color, t: 0, dur: 500 + Math.random() * 200,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        size: 1.5 + Math.random() * 1.5,
      });
    }
  }

  spawnConfetti(x: number, y: number, color: string): void {
    for (let i = 0; i < 36; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
      const sp = 120 + Math.random() * 180;
      this.list.push({
        kind: 'spark', x, y, color, t: 0, dur: 1200 + Math.random() * 500,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        size: 1.5 + Math.random() * 2,
        gravity: 260,
      });
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const p of this.list) {
      p.t += dtMs;
      if (p.kind === 'spark') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += (p.gravity ?? 120) * dt;
      } else if (p.kind === 'shock') {
        p.r = 8 + (p.t / p.dur) * 55;
      }
    }
    this.list = this.list.filter((p) => p.t < p.dur);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.list) {
      const k = p.t / p.dur;
      if (p.kind === 'shock') {
        ctx.strokeStyle = rgba(p.color, (1 - k) * 0.8);
        ctx.lineWidth = 2.2 * (1 - k) + 0.5;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = rgba(p.color, 1 - k);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - k * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  reset(): void {
    this.list = [];
  }
}
