/* global React */
// GladiatorRenderer v2 — TRON Broadcast direction
// Canvas 2D. Armored silhouette, team color stroke, idle swagger, flash choreography.
//
// Public API mirrors the real renderer so porting back is a near-copy:
//   const g = new GladiatorV2({ teamId, build, color, x, y, scale, facing });
//   g.setBase('idle' | 'thinking');
//   g.setTerminal('triumph' | 'kneel' | 'salute' | null);
//   g.flash('strike' | 'power' | 'hit');       // 400–500ms auto-clear
//   g.setEnergy(0..1);                         // affects stance aggression
//   g.update(dtMs, now);
//   g.draw(ctx);
//
// Joints use the same 14-joint schema as lib/arena/types.ts.

(function(){
  const JOINT_NAMES = [
    'head','neck','shoulderL','shoulderR','elbowL','elbowR',
    'handL','handR','hipL','hipR','kneeL','kneeR','footL','footR',
  ];

  // --- Pose library — upright TRON Ares stance
  // Figure is ~160 tall at scale=1. 8-heads-tall proportion.
  // y=0 is hip line. Head crown around y=-112. Feet at y=+80.
  const POSES = {
    idle: {
      head:[0,-100], neck:[0,-82],
      shoulderL:[-20,-74], shoulderR:[20,-74],
      elbowL:[-24,-42], elbowR:[24,-42],
      handL:[-22,-10], handR:[22,-10],
      hipL:[-12,0], hipR:[12,0],
      kneeL:[-12,38], kneeR:[12,38],
      footL:[-13,78], footR:[13,78],
    },
    thinking: {
      head:[2,-100], neck:[0,-82],
      shoulderL:[-20,-74], shoulderR:[20,-74],
      elbowL:[-26,-46], elbowR:[18,-48],
      handL:[-20,-14], handR:[8,-78], // chin-rub
      hipL:[-12,0], hipR:[12,0],
      kneeL:[-12,38], kneeR:[12,38],
      footL:[-13,78], footR:[13,78],
    },
    strike: {
      head:[-2,-98], neck:[0,-80],
      shoulderL:[-18,-73], shoulderR:[22,-72],
      elbowL:[-28,-48], elbowR:[36,-60],
      handL:[-26,-18], handR:[58,-52],  // thrust forward
      hipL:[-12,0], hipR:[14,0],
      kneeL:[-14,36], kneeR:[16,40],
      footL:[-20,78], footR:[16,78],
    },
    power: {
      head:[0,-104], neck:[0,-84],
      shoulderL:[-24,-76], shoulderR:[24,-76],
      elbowL:[-36,-58], elbowR:[36,-58],
      handL:[-34,-96], handR:[34,-96], // arms raised high
      hipL:[-12,0], hipR:[12,0],
      kneeL:[-12,38], kneeR:[12,38],
      footL:[-13,78], footR:[13,78],
    },
    hit: {
      head:[6,-92], neck:[3,-76], // knocked back
      shoulderL:[-14,-68], shoulderR:[22,-66],
      elbowL:[-20,-42], elbowR:[28,-38],
      handL:[-18,-12], handR:[30,-6],
      hipL:[-10,4], hipR:[14,4],
      kneeL:[-12,40], kneeR:[16,42],
      footL:[-18,80], footR:[18,80],
    },
    triumph: {
      head:[0,-108], neck:[0,-88],
      shoulderL:[-22,-80], shoulderR:[22,-80],
      elbowL:[-34,-100], elbowR:[34,-100],
      handL:[-32,-140], handR:[32,-140], // fists high
      hipL:[-12,0], hipR:[12,0],
      kneeL:[-12,38], kneeR:[12,38],
      footL:[-13,78], footR:[13,78],
    },
    kneel: {
      head:[4,-72], neck:[2,-58],
      shoulderL:[-18,-52], shoulderR:[20,-52],
      elbowL:[-22,-28], elbowR:[24,-28],
      handL:[-20,-4], handR:[22,-4],
      hipL:[-12,20], hipR:[12,20],
      kneeL:[-14,60], kneeR:[14,40],  // one knee down
      footL:[-14,82], footR:[14,82],
    },
    salute: {
      head:[0,-100], neck:[0,-82],
      shoulderL:[-20,-74], shoulderR:[20,-74],
      elbowL:[-24,-42], elbowR:[12,-66],
      handL:[-22,-10], handR:[2,-98], // hand to brow
      hipL:[-12,0], hipR:[12,0],
      kneeL:[-12,38], kneeR:[12,38],
      footL:[-13,78], footR:[13,78],
    },
  };

  // Deep clone a pose
  function clonePose(p) {
    const out = {};
    for (const k of JOINT_NAMES) out[k] = [p[k][0], p[k][1]];
    return out;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpPose(a, b, t) {
    const out = {};
    for (const k of JOINT_NAMES) out[k] = [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)];
    return out;
  }

  // Per-model visual config
  const MODEL_VISUALS = {
    claude:  { helmet: 'tall-crown',   weapon: 'disc',        shoulders: 'sharp' },
    codex:   { helmet: 'heavy-flat',   weapon: 'dual-blades', shoulders: 'bulky' },
    gemini:  { helmet: 'sleek-pointed',weapon: 'staff',       shoulders: 'asymmetric' },
    default: { helmet: 'hexagonal',    weapon: 'none',        shoulders: 'symmetric' },
  };

  // Hex → rgb helper (local so this file is portable)
  function hexToRgb(hex) {
    const s = hex.replace('#','');
    const v = s.length === 3
      ? s.split('').map(c => parseInt(c+c,16))
      : [0,2,4].map(i => parseInt(s.slice(i,i+2),16));
    return { r: v[0], g: v[1], b: v[2] };
  }
  function rgba(hex, a) { const c = hexToRgb(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; }

  class GladiatorV2 {
    constructor(opts) {
      this.teamId = opts.teamId;
      this.build = opts.build || 'default';
      this.color = opts.color;
      this.x = opts.x;
      this.y = opts.y;
      this.baseScale = opts.scale || 1;
      this.facing = opts.facing ?? 1;

      this.basePoseName = 'idle';
      this.terminalPoseName = null;
      this.flashPoseName = null;
      this.flashTime = 0;
      this.flashDuration = 0;

      this.current = clonePose(POSES.idle);
      this.target = clonePose(POSES.idle);

      this.breathPhase = Math.random() * Math.PI * 2;
      this.weightPhase = Math.random() * Math.PI * 2;
      this.energy = 0;         // 0..1
      this.hitShake = 0;       // extra recoil shake
      this.weaponSpin = 0;     // disc rotation accumulator

      // Pre-parsed color
      const c = hexToRgb(this.color);
      this._r = c.r; this._g = c.g; this._b = c.b;

      this._updateTarget();
    }

    setBase(pose) {
      if (pose !== this.basePoseName) {
        this.basePoseName = pose;
        this._updateTarget();
      }
    }
    setTerminal(pose) {
      this.terminalPoseName = pose;
      this._updateTarget();
    }
    flash(pose, duration) {
      this.flashPoseName = pose;
      this.flashDuration = duration ?? (pose === 'hit' ? 420 : 500);
      this.flashTime = 0;
      if (pose === 'hit') this.hitShake = 1;
      this._updateTarget();
    }
    setEnergy(e) { this.energy = Math.max(0, Math.min(1, e)); }

    _updateTarget() {
      let poseName;
      if (this.flashPoseName) poseName = this.flashPoseName;
      else if (this.terminalPoseName) poseName = this.terminalPoseName;
      else poseName = this.basePoseName;
      this.target = POSES[poseName];
    }

    update(dtMs, now) {
      // Flash timer
      if (this.flashPoseName) {
        this.flashTime += dtMs;
        if (this.flashTime >= this.flashDuration) {
          this.flashPoseName = null;
          this.flashTime = 0;
          this._updateTarget();
        }
      }

      // Joint lerp toward target — faster during flash for snappy reads
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

    draw(ctx) {
      const s = this.baseScale;
      const breath = Math.sin(this.breathPhase) * 3.5; // y-bob, amplitude px
      const weight = Math.sin(this.weightPhase) * 1.4;  // hip sway
      const shake = this.hitShake * (Math.random() - 0.5) * 8;

      ctx.save();
      ctx.translate(this.x + shake, this.y + breath);
      ctx.scale(s * this.facing, s);

      // Ground reflection / aura
      this._drawGround(ctx);

      // Armor layers, back to front
      this._drawLegs(ctx, weight);
      this._drawHip(ctx);
      this._drawTorso(ctx);
      this._drawArms(ctx);
      this._drawShoulders(ctx);
      this._drawNeck(ctx);
      this._drawHelmet(ctx);
      this._drawWeapon(ctx);

      // Impact bloom overlay when flashing
      if (this.flashPoseName) {
        const k = 1 - this.flashTime / this.flashDuration;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba(this.color, 0.08 * k);
        ctx.fillRect(-60, -90, 120, 160);
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.restore();
    }

    // ---------------- drawing helpers ----------------

    _drawGround(ctx) {
      const grad = ctx.createRadialGradient(0, 82, 6, 0, 82, 80);
      grad.addColorStop(0, rgba(this.color, 0.55));
      grad.addColorStop(1, rgba(this.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 82, 56, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    _stroke(ctx, w, a) {
      ctx.strokeStyle = rgba(this.color, a ?? 1);
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 8;
    }
    _fill(ctx, darkness = 0.93) {
      // Near-black armor interior tinted with team color
      const r = Math.floor(this._r * (1 - darkness));
      const g = Math.floor(this._g * (1 - darkness));
      const b = Math.floor(this._b * (1 - darkness));
      ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
    }

    /**
     * Draw a filled capsule limb segment from (x1,y1) to (x2,y2).
     * Produces a dark armored cylinder with a bright TRON edge line piped down
     * one side. Reads as "muscular limb" rather than "wire".
     */
    _capsule(ctx, x1, y1, x2, y2, widthStart, widthEnd) {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;   // unit normal
      const w1 = widthStart, w2 = widthEnd ?? widthStart;

      // Body fill
      this._fill(ctx, 0.94);
      ctx.beginPath();
      ctx.moveTo(x1 + nx * w1, y1 + ny * w1);
      ctx.lineTo(x2 + nx * w2, y2 + ny * w2);
      ctx.lineTo(x2 - nx * w2, y2 - ny * w2);
      ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
      ctx.closePath();
      ctx.fill();

      // End caps (so capsule isn't flat)
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

      // Bright glow line down one side (TRON circuit)
      ctx.strokeStyle = rgba(this.color, 1);
      ctx.lineWidth = 2;
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(x1 + nx * (w1 - 0.8), y1 + ny * (w1 - 0.8));
      ctx.lineTo(x2 + nx * (w2 - 0.8), y2 + ny * (w2 - 0.8));
      ctx.stroke();

      // Secondary thin inner line on the opposite side
      ctx.strokeStyle = rgba(this.color, 0.5);
      ctx.lineWidth = 1;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(x1 - nx * (w1 - 0.8), y1 - ny * (w1 - 0.8));
      ctx.lineTo(x2 - nx * (w2 - 0.8), y2 - ny * (w2 - 0.8));
      ctx.stroke();

      ctx.shadowBlur = 0;
    }

    _drawHelmet(ctx) {
      const j = this.current;
      const [hx, hy] = j.head;
      const vis = MODEL_VISUALS[this.build];
      this._stroke(ctx, 2.4);
      this._fill(ctx, 0.9);
      ctx.beginPath();
      if (vis.helmet === 'tall-crown') {
        // Claude: tall crown
        ctx.moveTo(hx-10, hy-4);
        ctx.lineTo(hx-7, hy-20);
        ctx.lineTo(hx+7, hy-20);
        ctx.lineTo(hx+10, hy-4);
        ctx.lineTo(hx+8, hy+8);
        ctx.lineTo(hx, hy+12);
        ctx.lineTo(hx-8, hy+8);
        ctx.closePath();
      } else if (vis.helmet === 'heavy-flat') {
        // Codex: heavy flat brick
        ctx.moveTo(hx-11, hy-6);
        ctx.lineTo(hx-11, hy-14);
        ctx.lineTo(hx+11, hy-14);
        ctx.lineTo(hx+11, hy-6);
        ctx.lineTo(hx+9, hy+10);
        ctx.lineTo(hx-9, hy+10);
        ctx.closePath();
      } else if (vis.helmet === 'sleek-pointed') {
        // Gemini: sleek pointed
        ctx.moveTo(hx-10, hy-4);
        ctx.lineTo(hx-4, hy-18);
        ctx.lineTo(hx+4, hy-18);
        ctx.lineTo(hx+10, hy-4);
        ctx.lineTo(hx+7, hy+10);
        ctx.lineTo(hx-7, hy+10);
        ctx.closePath();
      } else {
        // hexagonal
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI/3)*i - Math.PI/2;
          const px = hx + Math.cos(a)*10;
          const py = hy + Math.sin(a)*11;
          if (i === 0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
        }
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();

      // Visor slit
      this._stroke(ctx, 1.3, 0.8);
      ctx.beginPath();
      ctx.moveTo(hx-7, hy+2);
      ctx.lineTo(hx+7, hy+2);
      ctx.stroke();
    }

    _drawNeck(ctx) {
      const j = this.current;
      // Thick neck column — capsule from head base to neck joint
      this._capsule(ctx, j.head[0], j.head[1] + 10, j.neck[0], j.neck[1], 4.5, 5.5);
    }

    _drawTorso(ctx) {
      const j = this.current;
      const sl = j.shoulderL, sr = j.shoulderR, hl = j.hipL, hr = j.hipR;

      // Upper chest — shoulder-wide, square top (plate)
      this._fill(ctx, 0.94);
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 1.2;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(sl[0] - 2, sl[1] + 2);
      ctx.lineTo(sr[0] + 2, sr[1] + 2);
      ctx.lineTo(sr[0] - 2, sr[1] + 26);  // rib taper
      ctx.lineTo(hr[0] + 4, hr[1] - 4);
      ctx.lineTo(hl[0] - 4, hl[1] - 4);
      ctx.lineTo(sl[0] + 2, sl[1] + 26);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Outer color stroke (team tint)
      ctx.strokeStyle = rgba(this.color, 0.95);
      ctx.lineWidth = 2;
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 10;
      ctx.stroke();

      // Center chest seam — the signature TRON circuit line
      ctx.strokeStyle = rgba(this.color, 1);
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(0, sl[1] + 6);
      ctx.lineTo(0, hl[1] - 2);
      ctx.stroke();

      // Sternum branches — short diagonals
      ctx.strokeStyle = rgba(this.color, 0.7);
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 6;
      const midY = (sl[1] + hl[1]) / 2;
      ctx.beginPath();
      ctx.moveTo(-8, midY - 6); ctx.lineTo(0, midY - 12);
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

    _drawHip(ctx) {
      const j = this.current;
      // Hip plate — trapezoid, wider at top
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

      // Belt glow line across hips
      ctx.strokeStyle = rgba(this.color, 1);
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(j.hipL[0] - 2, j.hipL[1] + 2);
      ctx.lineTo(j.hipR[0] + 2, j.hipR[1] + 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    _drawShoulders(ctx) {
      const j = this.current;
      const vis = MODEL_VISUALS[this.build];
      this._stroke(ctx, 2.2);
      this._fill(ctx, 0.9);

      const drawPauldron = (sx, sy, side) => {
        ctx.beginPath();
        if (vis.shoulders === 'sharp') {
          ctx.moveTo(sx - side*12, sy - 4);
          ctx.lineTo(sx + side*2, sy - 8);
          ctx.lineTo(sx + side*5, sy + 4);
          ctx.lineTo(sx - side*10, sy + 8);
        } else if (vis.shoulders === 'bulky') {
          ctx.moveTo(sx - side*14, sy - 2);
          ctx.lineTo(sx + side*2, sy - 10);
          ctx.lineTo(sx + side*4, sy + 6);
          ctx.lineTo(sx - side*12, sy + 10);
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
          ctx.moveTo(sx - side*10, sy - 4);
          ctx.lineTo(sx + side*2, sy - 6);
          ctx.lineTo(sx + side*2, sy + 6);
          ctx.lineTo(sx - side*8, sy + 6);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };

      drawPauldron(j.shoulderL[0], j.shoulderL[1], -1);
      drawPauldron(j.shoulderR[0], j.shoulderR[1],  1);
    }

    _drawArms(ctx) {
      const j = this.current;
      // Upper arm (shoulder → elbow), thicker at shoulder
      this._capsule(ctx, j.shoulderL[0], j.shoulderL[1], j.elbowL[0], j.elbowL[1], 4.5, 3.6);
      this._capsule(ctx, j.shoulderR[0], j.shoulderR[1], j.elbowR[0], j.elbowR[1], 4.5, 3.6);
      // Forearm (elbow → hand)
      this._capsule(ctx, j.elbowL[0], j.elbowL[1], j.handL[0], j.handL[1], 3.6, 3.2);
      this._capsule(ctx, j.elbowR[0], j.elbowR[1], j.handR[0], j.handR[1], 3.6, 3.2);

      // Hands — small rounded knobs
      this._fill(ctx, 0.92);
      ctx.beginPath();
      ctx.arc(j.handL[0], j.handL[1], 3.4, 0, Math.PI*2);
      ctx.arc(j.handR[0], j.handR[1], 3.4, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = rgba(this.color, 0.8);
      ctx.lineWidth = 1.4;
      ctx.shadowColor = this.color; ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(j.handL[0], j.handL[1], 3.4, 0, Math.PI*2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(j.handR[0], j.handR[1], 3.4, 0, Math.PI*2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    _drawLegs(ctx, weight) {
      const j = this.current;
      // Thigh (hip → knee), thick
      this._capsule(ctx, j.hipL[0]+weight, j.hipL[1], j.kneeL[0]+weight*0.5, j.kneeL[1], 5.5, 4.2);
      this._capsule(ctx, j.hipR[0]+weight, j.hipR[1], j.kneeR[0]+weight*0.5, j.kneeR[1], 5.5, 4.2);
      // Shin (knee → foot)
      this._capsule(ctx, j.kneeL[0]+weight*0.5, j.kneeL[1], j.footL[0], j.footL[1], 4.2, 3.2);
      this._capsule(ctx, j.kneeR[0]+weight*0.5, j.kneeR[1], j.footR[0], j.footR[1], 4.2, 3.2);

      // Feet — short armored blocks
      this._fill(ctx, 0.9);
      ctx.strokeStyle = rgba(this.color, 0.9);
      ctx.lineWidth = 1.4;
      ctx.shadowColor = this.color; ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.rect(j.footL[0] - 5, j.footL[1] - 2, 10, 5);
      ctx.rect(j.footR[0] - 5, j.footR[1] - 2, 10, 5);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    _drawWeapon(ctx) {
      const j = this.current;
      const vis = MODEL_VISUALS[this.build];
      if (vis.weapon === 'none') return;

      ctx.shadowColor = this.color; ctx.shadowBlur = 10;

      if (vis.weapon === 'disc') {
        // Identity disc in right hand, spinning
        const [hx, hy] = j.handR;
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(this.weaponSpin);
        ctx.strokeStyle = rgba(this.color, 1);
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI*2);
        ctx.stroke();
        ctx.fillStyle = rgba(this.color, 0.9);
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI*2);
        ctx.fill();
        // cross bars
        ctx.strokeStyle = rgba(this.color, 0.6);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-9,0); ctx.lineTo(9,0);
        ctx.moveTo(0,-9); ctx.lineTo(0,9);
        ctx.stroke();
        ctx.restore();
      } else if (vis.weapon === 'dual-blades') {
        // Short daggers at each hand, angled
        const blade = (hx, hy, dir) => {
          ctx.save();
          ctx.translate(hx, hy);
          ctx.rotate(dir * 0.4);
          ctx.strokeStyle = rgba(this.color, 1);
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(0, 0); ctx.lineTo(dir*14, -4);
          ctx.stroke();
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(dir*3, 4); ctx.lineTo(dir*3, -4);
          ctx.stroke();
          ctx.restore();
        };
        blade(j.handL[0], j.handL[1], -1);
        blade(j.handR[0], j.handR[1],  1);
      } else if (vis.weapon === 'staff') {
        // Long staff gripped in right hand
        const [hx, hy] = j.handR;
        ctx.strokeStyle = rgba(this.color, 1);
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(hx - 2, hy - 40);
        ctx.lineTo(hx + 2, hy + 40);
        ctx.stroke();
        // head
        ctx.fillStyle = rgba(this.color, 0.9);
        ctx.beginPath();
        ctx.arc(hx - 2, hy - 40, 4, 0, Math.PI*2);
        ctx.fill();
        // tip spark
        const flick = 0.7 + Math.sin(this.breathPhase * 4) * 0.3;
        ctx.fillStyle = rgba(this.color, flick);
        ctx.beginPath();
        ctx.arc(hx - 2, hy - 44, 2, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
  }

  // Expose
  window.GladiatorV2 = GladiatorV2;
  window.POSES = POSES;
  window.MODEL_VISUALS = MODEL_VISUALS;
})();
