/* global window */
// Ring + stage rendering. Draws grid floor, inner/outer arena rings,
// tick marks, impact pulses, and phase tinting.

(function(){
  function hexToRgb(hex) {
    const s = hex.replace('#','');
    const v = s.length === 3
      ? s.split('').map(c => parseInt(c+c,16))
      : [0,2,4].map(i => parseInt(s.slice(i,i+2),16));
    return { r: v[0], g: v[1], b: v[2] };
  }
  function rgba(hex, a) { const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; }

  class ArenaRing {
    constructor(cx, cy, rx, ry) {
      this.cx = cx; this.cy = cy; this.rx = rx; this.ry = ry;
      this.pulses = [];           // [{t, dur, color}]
      this.phaseTint = '#00f0ff'; // cyan default
      this.phaseIntensity = 0;    // 0..1 ring glow
    }

    setPhase(phase, winnerColor) {
      // active = cyan; judging = orange; reveal = winner color
      if (phase === 'reveal' && winnerColor) {
        this.phaseTint = winnerColor; this.phaseIntensity = 0.9;
      } else if (phase === 'judging' || phase === 'freeze') {
        this.phaseTint = '#ff6600'; this.phaseIntensity = 0.7;
      } else {
        this.phaseTint = '#00f0ff'; this.phaseIntensity = 0.45;
      }
    }

    pulse(color) {
      this.pulses.push({ t: 0, dur: 500, color });
    }

    update(dtMs) {
      this.pulses = this.pulses.filter(p => (p.t += dtMs) < p.dur);
    }

    drawGrid(ctx, dim = 1) {
      const { cx, cy, rx, ry } = this;
      ctx.save();
      ctx.globalAlpha = 0.5 * dim;

      // Perspective floor grid — skewed rows of cyan lines
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
      // Vertical lines (radial-ish)
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

    drawRing(ctx) {
      const { cx, cy, rx, ry, phaseTint, phaseIntensity } = this;

      ctx.save();

      // Outer ring
      ctx.strokeStyle = rgba(phaseTint, 0.9 * phaseIntensity + 0.1);
      ctx.lineWidth = 2.5;
      ctx.shadowColor = phaseTint;
      ctx.shadowBlur = 18 * phaseIntensity;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Inner ring
      ctx.strokeStyle = rgba(phaseTint, 0.35);
      ctx.lineWidth = 1.2;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * 0.92, ry * 0.92, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Tick marks
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
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
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
        ctx.ellipse(cx, cy, rx * (1 + ease * 0.08), ry * (1 + ease * 0.08), 0, 0, Math.PI*2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  // --- Particle system — shockwaves, sparks, triumph confetti
  class Shockwaves {
    constructor() { this.list = []; }

    spawnShockwave(x, y, color) {
      this.list.push({ kind: 'shock', x, y, color, t: 0, dur: 420, r: 8 });
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 80 + Math.random() * 120;
        this.list.push({
          kind: 'spark', x, y, color, t: 0, dur: 500 + Math.random()*200,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
          size: 1.5 + Math.random() * 1.5,
        });
      }
    }

    spawnConfetti(x, y, color) {
      for (let i = 0; i < 36; i++) {
        const a = -Math.PI/2 + (Math.random() - 0.5) * Math.PI * 0.9;
        const sp = 120 + Math.random() * 180;
        this.list.push({
          kind: 'spark', x, y, color, t: 0, dur: 1200 + Math.random()*500,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          size: 1.5 + Math.random() * 2,
          gravity: 260,
        });
      }
    }

    update(dtMs) {
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
      this.list = this.list.filter(p => p.t < p.dur);
    }

    draw(ctx) {
      ctx.save();
      for (const p of this.list) {
        const k = p.t / p.dur;
        if (p.kind === 'shock') {
          ctx.strokeStyle = rgba(p.color, (1 - k) * 0.8);
          ctx.lineWidth = 2.2 * (1 - k) + 0.5;
          ctx.shadowColor = p.color; ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.stroke();
        } else if (p.kind === 'spark') {
          ctx.fillStyle = rgba(p.color, 1 - k);
          ctx.shadowColor = p.color; ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - k * 0.4), 0, Math.PI*2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  window.ArenaRing = ArenaRing;
  window.Shockwaves = Shockwaves;
})();
