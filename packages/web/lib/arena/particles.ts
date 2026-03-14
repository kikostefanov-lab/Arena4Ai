import type { Particle, ParticleType } from './types';
import { hexToRgb } from '../design-tokens';

const MAX_PARTICLES = 50;
const GRAVITY = 0.15;

/**
 * ParticleSystem manages a pool of short-lived visual particles
 * for strike projectiles, power bursts, impact sparks, and triumph explosions.
 */
export class ParticleSystem {
  private particles: Particle[] = [];

  /** Spawn count particles of the given type at (x, y). */
  spawn(type: ParticleType, x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      this.particles.push(this.createParticle(type, x, y, color));
    }
  }

  /** Spawn a directed projectile from (x,y) toward (targetX, targetY). */
  spawnProjectile(x: number, y: number, targetX: number, targetY: number, color: string): void {
    if (this.particles.length >= MAX_PARTICLES) return;

    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = 6;

    this.particles.push({
      type: 'strike_projectile',
      x, y,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      life: 1,
      maxLife: 1,
      color,
      size: 5,
    });
  }

  /** Update all particles. Call each frame with dt in milliseconds. */
  update(dt: number): void {
    const dtScale = dt / 16.67; // normalize to ~60fps

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // Move
      p.x += p.vx * dtScale;
      p.y += p.vy * dtScale;

      // Gravity for triumph_explosion (fountain effect)
      if (p.type === 'triumph_explosion') {
        p.vy += GRAVITY * dtScale;
      }

      // Decay life
      const decayRate = p.type === 'strike_projectile' ? 0.015 : 0.03;
      p.life -= decayRate * dtScale;

      // Remove dead particles
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  /** Draw all particles to a 2D canvas context. */
  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.save();
      const alpha = Math.max(0, p.life);
      const rgb = hexToRgb(p.color);

      if (p.type === 'strike_projectile') {
        // Glowing projectile with trail
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = `rgba(${rgb},0.9)`;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        // Trail
        ctx.globalAlpha = alpha * 0.3;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x - p.vx * 2, p.y - p.vy * 2, p.size * 0.6, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'power_burst') {
        // Expanding ring
        const ringSize = p.size * (1 + (1 - p.life) * 3);
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.shadowColor = `rgba(${rgb},0.6)`;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, ringSize, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // hit_sparks, impact_sparks, triumph_explosion — simple dots
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = `rgba(${rgb},0.5)`;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  /** Remove all particles. */
  clear(): void {
    this.particles.length = 0;
  }

  private createParticle(type: ParticleType, x: number, y: number, color: string): Particle {
    const base: Particle = {
      type, x, y,
      vx: 0, vy: 0,
      life: 1, maxLife: 1,
      color,
      size: 3,
    };

    switch (type) {
      case 'triumph_explosion': {
        // Fountain upward with spread
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
        const speed = 2 + Math.random() * 4;
        base.vx = Math.cos(angle) * speed;
        base.vy = Math.sin(angle) * speed;
        base.size = 2 + Math.random() * 3;
        break;
      }
      case 'power_burst': {
        // Expanding ring — minimal velocity, size drives the visual
        const a = Math.random() * Math.PI * 2;
        base.vx = Math.cos(a) * 0.3;
        base.vy = Math.sin(a) * 0.3;
        base.size = 4 + Math.random() * 4;
        break;
      }
      case 'hit_sparks':
      case 'impact_sparks': {
        // Random scatter
        const sa = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * 3;
        base.vx = Math.cos(sa) * sp;
        base.vy = Math.sin(sa) * sp;
        base.size = 1.5 + Math.random() * 2;
        break;
      }
      case 'strike_projectile': {
        // Directed — handled by spawnProjectile; this is a fallback
        base.vx = 4;
        base.vy = 0;
        base.size = 5;
        break;
      }
    }

    return base;
  }
}
