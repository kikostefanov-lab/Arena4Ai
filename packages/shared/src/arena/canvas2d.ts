/**
 * A structural subset of CanvasRenderingContext2D.
 *
 * WHY NOT JUST USE THE DOM TYPE
 * `@arena/shared` compiles with `lib: ["ES2022"]` — no DOM. It is imported by
 * `@arena/orchestrator`, a Node server, and giving shared the DOM lib would put
 * `document`, `window` and friends into the orchestrator's type universe, where
 * they do not exist at runtime. That is a real hazard, not a stylistic one.
 *
 * Declaring the surface we actually use costs forty lines and buys three things:
 *   1. shared keeps its DOM-free type universe;
 *   2. a real `CanvasRenderingContext2D` is structurally assignable to this, so
 *      browser callers pass one with no cast;
 *   3. the core is genuinely host-free — node-canvas, an OffscreenCanvas in a
 *      worker, or a test double all satisfy it. "Framework-free" that stops at
 *      the browser boundary is not framework-free.
 */

export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface TextMetricsLike {
  width: number;
}

export interface Ctx2D {
  // state
  fillStyle: string | CanvasGradientLike;
  strokeStyle: string | CanvasGradientLike;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  lineDashOffset: number;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  font: string;
  textAlign: string;
  textBaseline: string;

  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  setLineDash(segments: number[]): void;

  // paths
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
  ): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;

  // shapes + text
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): TextMetricsLike;

  // gradients
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): CanvasGradientLike;
}

/** The minimum a canvas element must offer for the renderer to size itself. */
export interface CanvasLike {
  width: number;
  height: number;
}

// ─── small maths shared across the arena modules ─────────────────────────────

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Trace a closed polygon. Callers follow with fill() or stroke(). */
export function poly(ctx: Ctx2D, pts: Array<{ x: number; y: number }>): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
    else ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
}

/** Rounded rectangle path (roundRect is not universally available). */
export function rrect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
