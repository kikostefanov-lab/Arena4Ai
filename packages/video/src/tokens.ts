// TRON design tokens for Remotion components.
//
// MODEL_COLORS is NOT defined here any more. It was defined here and again in
// packages/web/lib/design-tokens.ts, under a comment instructing a human to keep
// the two in sync by hand. Those colours are load-bearing brand — a viewer
// identifies a competitor by its colour in the reel and on the live site — and
// two hand-synced copies drift silently, which is the one failure mode that
// costs the most and announces itself the least. Both now re-export from
// @arena/shared, which is the only package web and video both depend on.
export { MODEL_COLORS, getModelColor } from '@arena/shared';

export const BG_DARK    = '#000408';
export const BG_CARD    = '#050f1e';
export const BG_HEADER  = '#020b14';

export const ACCENT_CYAN   = '#00f0ff';
export const ACCENT_BLUE   = '#0080ff';
export const ACCENT_ORANGE = '#ff6600';
/** The judge. Distinct from web's ACCENT_GOLD (#eab308), which is a rank badge. */
export const ACCENT_GOLD   = '#ffd700';

export const TEXT_PRIMARY = '#e4f8ff';
export const TEXT_MUTED   = '#7cc6db';
export const TEXT_DIM     = '#3d7d94';

export const ORBITRON = '"Orbitron", sans-serif';
export const MONO     = '"SF Mono", "Fira Code", monospace';
