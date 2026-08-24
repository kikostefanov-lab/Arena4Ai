import { clamp } from './canvas2d.js';
import type { GridExtent } from './layout.js';

/**
 * The isometric projection, lifted from the prototype and made viewport-aware.
 *
 * World units: 1 = one floor cell, y is up, team A owns x<0 and team B x>0.
 *
 * WHAT CHANGED FROM THE PROTOTYPE
 * The spike projected into the full window (`W/2`, `H*0.54`) and drew the HUD on
 * top. That is the direct cause of the first reported defect — the right team's
 * stat panel sits over its own blocks, because nothing ever told the world it
 * had less room than the window. The camera now projects into a VIEWPORT that
 * the host shrinks by the HUD's own measured insets, so the fix is structural
 * rather than a hand-tuned margin that breaks at the next breakpoint.
 */

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Viewport {
  /** CSS pixels of the drawing surface. */
  width: number;
  height: number;
  /** Device pixel ratio the canvas backing store is scaled by. */
  dpr: number;
  /** Space the HUD occupies. The world is fitted into what is left. */
  insets: Insets;
}

export interface Projected {
  x: number;
  y: number;
  /** Depth along the rotated z axis — used for painter's-algorithm sorting. */
  d: number;
  /** Local scale at this point, for sizing glyphs and labels. */
  u: number;
}

export interface CameraState {
  yaw: number;
  pitch: number;
  zoom: number;
  x: number;
  y: number;
  /** Targets the live values chase, so every move eases. */
  tyaw: number;
  tzoom: number;
  tx: number;
  ty: number;
  shake: number;
  orbit: boolean;
}

export const DEFAULT_YAW = -0.62;
export const DEFAULT_PITCH = 0.6;

export function createCamera(): CameraState {
  return {
    yaw: DEFAULT_YAW,
    pitch: DEFAULT_PITCH,
    zoom: 1,
    x: 0,
    y: 0,
    tyaw: DEFAULT_YAW,
    tzoom: 1,
    tx: 0,
    ty: 0,
    shake: 0,
    orbit: true,
  };
}

/** The rectangle the world may draw into, after the HUD has taken its share. */
export function safeBox(vp: Viewport): { x: number; y: number; w: number; h: number } {
  const w = Math.max(120, vp.width - vp.insets.left - vp.insets.right);
  const h = Math.max(120, vp.height - vp.insets.top - vp.insets.bottom);
  return { x: vp.insets.left, y: vp.insets.top, w, h };
}

/** Tallest a block ever gets, so the fit leaves room for the skyline. */
const MAX_BLOCK_HEIGHT = 3.2;

/**
 * World-to-screen scale: the largest scale at which the whole floor, plus the
 * tallest possible block on it, still fits inside the safe box.
 *
 * The footprint is MEASURED rather than approximated. `project()` is linear in
 * `scale` — its perspective term depends only on the rotated z, which is
 * scale-independent — so projecting the eight corners of the world's bounding
 * box at scale 1 gives the exact aspect, and one division gives the exact fit.
 * The spike used `box.h / (spanZ * 0.62)`, a constant tuned by eye at one yaw
 * and one pitch; the moment the camera orbited, that constant was wrong and the
 * floor drifted out of its box.
 */
export function worldScale(vp: Viewport, cam: CameraState, grid: GridExtent): number {
  const box = safeBox(vp);
  const gx = grid.gx + 1; // +1 of margin keeps the outer frame off the edge
  const gz = grid.gz + 1;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const sx of [-gx, gx]) {
    for (const sz of [-gz, gz]) {
      for (const y of [0, MAX_BLOCK_HEIGHT]) {
        const p = project(sx, y, sz, cam, 1, 0, 0);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }
  const w = Math.max(1e-6, maxX - minX);
  const h = Math.max(1e-6, maxY - minY);
  return Math.min(box.w / w, box.h / h) * cam.zoom;
}

/** Centre of the safe box — the point the world is composed around. */
export function focus(vp: Viewport, cam: CameraState): { cx: number; cy: number } {
  const box = safeBox(vp);
  return { cx: box.x + box.w / 2 + cam.x, cy: box.y + box.h * 0.54 + cam.y };
}

/**
 * Project a world point. `scale` and `focus` are hoisted out by the caller and
 * passed in because this runs once per vertex per block per frame — at four
 * hundred blocks that is ~3,200 calls a frame, and recomputing the safe box
 * inside each one was measurable.
 */
export function project(
  x: number,
  y: number,
  z: number,
  cam: CameraState,
  scale: number,
  cx: number,
  cy: number,
): Projected {
  const c = Math.cos(cam.yaw);
  const s = Math.sin(cam.yaw);
  const rx = x * c - z * s;
  const rz = x * s + z * c;
  const sp = Math.sin(cam.pitch);
  const cp = Math.cos(cam.pitch);
  const persp = 1 / (1 + rz * 0.028); // near cells slightly larger
  const u = scale * persp;
  return { x: cx + rx * u, y: cy + (rz * sp - y * cp) * u, d: rz, u };
}

/** Ease live camera values toward their targets. Call once per frame. */
export function stepCamera(cam: CameraState, reducedMotion: boolean): void {
  cam.yaw += (cam.tyaw - cam.yaw) * 0.05;
  cam.zoom += (cam.tzoom - cam.zoom) * 0.08;
  cam.x += (cam.tx - cam.x) * 0.1;
  cam.y += (cam.ty - cam.y) * 0.1;
  if (cam.shake > 0.01 && !reducedMotion) {
    cam.x += (Math.random() - 0.5) * cam.shake * 12;
    cam.y += (Math.random() - 0.5) * cam.shake * 8;
    cam.shake *= 0.85;
  } else {
    cam.shake = 0;
  }
}

export function setYaw(cam: CameraState, yaw: number): void {
  cam.tyaw = clamp(yaw, -1.4, 0.2);
}
