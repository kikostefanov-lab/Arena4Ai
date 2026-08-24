/**
 * OBSERVER design tokens — the single source of truth for Arena4Ai's visual
 * identity, shared by the web UI, the Remotion reels, and the arena renderer.
 *
 * WHY THIS FILE EXISTS
 * MODEL_COLORS was defined twice: once in `packages/web/lib/design-tokens.ts`
 * and once in `packages/video/src/tokens.ts`, the latter carrying the comment
 * "Keep in sync with packages/web/lib/design-tokens.ts manually." Those colours
 * are load-bearing brand — a viewer identifies a competitor by its colour in the
 * reel and on the live site, and the two drifting apart would break that
 * identification silently. Both files now re-export from here.
 *
 * It lives in @arena/shared because that is the only package both `web` and
 * `video` already depend on, and because this module has NO imports at all:
 * `dist/design/tokens.js` can be loaded natively by a browser as ESM, which is
 * what lets the arena renderer core stay framework-free (see ../arena/).
 *
 * NOT UNIFIED, DELIBERATELY:
 *   - `hexToRgb` exists in web returning an "r,g,b" STRING for CSS `rgba()`.
 *     This module exports `hexToRgbTuple` (a numeric triple) under a different
 *     name rather than colliding with it. Two different contracts should not
 *     share one name.
 *   - `ACCENT_GOLD` is '#ffd700' in video and '#eab308' in web. They are not the
 *     same token: web's is a leaderboard rank badge, video's is the judge. Both
 *     are kept, named for their meaning (JUDGE_GOLD here).
 */

// ─── Model identity ──────────────────────────────────────────────────────────

/**
 * Competitor identity colours — TRON palette. LOAD-BEARING BRAND.
 * Changing a value here changes it in the live arena, the site and every reel.
 */
export const MODEL_COLORS: Record<string, string> = {
  claude: '#ff6600', // recognizer orange
  codex: '#0066ff', // TRON blue
  gemini: '#00f0ff', // electric cyan
};

/** Fallback for an unrecognised provider — muted, never mistaken for a brand colour. */
export const MODEL_COLOR_FALLBACK = '#4a8fa8';

/** Resolve a colour from a model string, tolerating a `provider:persona` form. */
export function getModelColor(model: string): string {
  const base = model.toLowerCase().split(':')[0];
  return MODEL_COLORS[base] ?? MODEL_COLOR_FALLBACK;
}

// ─── Observer palette ────────────────────────────────────────────────────────

/**
 * Chrome and ground tones for the arena surface. `VOID` sits deliberately
 * between the marketing site's #04070d and the app's #01060c so the renderer
 * can be dropped into either without a seam.
 */
export const OBSERVER = {
  void: '#03060b',
  floor: '#071018',
  line: '#0f2234',
  ice: '#d7e9f2',
  ice2: '#7fa6b8',
  ice3: '#3d6478',
  /** UI chrome accent — deliberately NOT gemini cyan, so chrome never reads as a competitor. */
  chrome: '#9fd4e6',
  /** The judge. */
  gold: '#ffd700',
  /** Errors, and only errors. */
  red: '#ff3b5c',
  white: '#ffffff',
} as const;

// ─── Typography ──────────────────────────────────────────────────────────────

export const FONT_DISPLAY = '"Inter Tight","Inter",ui-sans-serif,system-ui,sans-serif';
export const FONT_MONO = '"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace';

/** Type scale in px — the arena HUD is px-based to bypass the app's html{font-size:120%}. */
export const TYPE = {
  micro: 9.5,
  tiny: 10.5,
  small: 11,
  body: 12,
  lead: 15,
  stat: 20,
} as const;

export const TRACKING = {
  tight: '-0.02em',
  normal: '0.04em',
  wide: '0.12em',
  wider: '0.18em',
  widest: '0.32em',
} as const;

// ─── Spacing ─────────────────────────────────────────────────────────────────

/** Spacing scale in px, for canvas and for the HUD alike. */
export const SPACE = { xs: 6, sm: 10, md: 16, lg: 22, xl: 32 } as const;

// ─── Motion ──────────────────────────────────────────────────────────────────

export const EASE = {
  settle: 'cubic-bezier(0.16,1,0.3,1)',
  wipe: 'cubic-bezier(0.76,0,0.24,1)',
} as const;

/**
 * Motion durations in ms. Every animated element in the arena draws its timing
 * from here so a `prefers-reduced-motion` pass has one place to look.
 */
export const MOTION = {
  /** Structure rise, tool beam, error decay. */
  beam: 650,
  streak: 260,
  label: 2600,
  ring: 900,
  confetti: 2600,
  /** Per-frame lerp factors — how fast a value chases its target. */
  lerpHeight: 0.12,
  lerpPose: 0.22,
  lerpCamera: 0.05,
} as const;

// ─── Colour maths ────────────────────────────────────────────────────────────

/**
 * Hex → [r,g,b]. Named `Tuple` to avoid colliding with web's `hexToRgb`, which
 * returns the "r,g,b" string that CSS `rgba()` wants. Both are correct for their
 * caller; sharing a name would guarantee someone gets the wrong one.
 */
export function hexToRgbTuple(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Hex + alpha → a CSS `rgba()` string. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgbTuple(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Linear blend of two hex colours, `t` in [0,1]. Returns a CSS `rgb()` string. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgbTuple(a);
  const y = hexToRgbTuple(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}
