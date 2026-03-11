/**
 * Shared design tokens for Arena4Ai web UI.
 *
 * Single source of truth for model colors, state colors, and brand values.
 * Import from here — never hardcode hex values in components.
 */

/** Model identity colors — TRON palette. */
export const MODEL_COLORS: Record<string, string> = {
  claude: '#ff6600', // recognizer orange
  codex:  '#0066ff', // TRON blue
  gemini: '#00f0ff', // electric cyan
};

export function getModelColor(model: string): string {
  const base = model.toLowerCase().split(':')[0];
  return MODEL_COLORS[base] ?? '#4a8fa8';
}

/** Lane colors for multi-team scenarios (indexed by team position). */
export const LANE_COLORS = [
  MODEL_COLORS.claude,  // team-a default
  MODEL_COLORS.gemini,  // team-b default
  MODEL_COLORS.codex,
  '#ffd700',
  '#00d4ff',
];

/** Model badge colors used in the arena lane headers. */
export const MODEL_BADGE_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  claude: { bg: 'rgba(255,102,0,0.15)',  fg: '#ff6600', border: 'rgba(255,102,0,0.4)' },
  codex:  { bg: 'rgba(0,102,255,0.15)',  fg: '#0066ff', border: 'rgba(0,102,255,0.4)' },
  gemini: { bg: 'rgba(0,240,255,0.15)',  fg: '#00f0ff', border: 'rgba(0,240,255,0.4)' },
};

/** Competition state badge colors — TRON tinted. */
export const STATE_STYLES: Record<string, { bg: string; color: string }> = {
  COMPLETE:       { bg: 'rgba(0,240,255,0.12)',  color: '#00f0ff' },
  RUNNING:        { bg: 'rgba(255,102,0,0.15)',  color: '#ff6600' },
  JUDGING:        { bg: 'rgba(255,102,0,0.12)',  color: '#ff6600' },
  SCORED:         { bg: 'rgba(0,240,255,0.12)',  color: '#00f0ff' },
  SYNTHESIZING:   { bg: 'rgba(0,128,255,0.12)',  color: '#0080ff' },
  DRAFT:          { bg: 'rgba(30,74,90,0.15)',   color: '#1e4a5a' },
  CONFIGURED:     { bg: 'rgba(30,74,90,0.15)',   color: '#1e4a5a' },
  LAUNCHING:      { bg: 'rgba(0,212,255,0.12)',  color: '#00d4ff' },
  TIME_UP:        { bg: 'rgba(255,102,0,0.12)',  color: '#ff6600' },
  COLLECTING:     { bg: 'rgba(0,128,255,0.12)',  color: '#0080ff' },
  PRESENTING:     { bg: 'rgba(0,102,255,0.12)',  color: '#0066ff' },
  FORGING:        { bg: 'rgba(255,102,0,0.12)',  color: '#ff6600' },
  FORGE_COMPLETE: { bg: 'rgba(0,240,255,0.12)',  color: '#00f0ff' },
  FAILED:         { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
  CANCELLED:      { bg: 'rgba(30,74,90,0.10)',   color: '#1e4a5a' },
  // Arena page aliases
  PENDING:        { bg: 'rgba(30,74,90,0.10)',   color: '#1e4a5a' },
  ERROR:          { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
};

export function getStateStyle(state: string): { bg: string; color: string } {
  return STATE_STYLES[state] ?? { bg: 'rgba(30,74,90,0.10)', color: '#1e4a5a' };
}

/** Format badge styles for brief formats. */
export const FORMAT_BADGES: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  SPRINT:      { bg: 'rgba(0,212,255,0.12)',  color: '#00d4ff', label: 'SPRINT',    icon: '⚡' },
  HACKATHON:   { bg: 'rgba(0,128,255,0.12)',  color: '#0080ff', label: 'HACKATHON', icon: '🔨' },
  RED_VS_BLUE: { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444', label: 'RED×BLUE',  icon: '⚔️' },
  RELAY_RACE:  { bg: 'rgba(0,240,255,0.12)',  color: '#00f0ff', label: 'RELAY',     icon: '🔄' },
};

/**
 * Convert a 6-digit hex color to an "r,g,b" string for use in rgba().
 * e.g. hexToRgb('#ff6600') → '255,102,0'
 */
export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

/** Brand background colors — TRON palette. */
export const BG_DARK    = '#000408';
export const BG_CARD    = '#050f1e';
export const BG_HEADER  = '#020b14';
export const BG_INPUT   = '#010810';
export const BORDER_DIM = '#0a2235';
export const BORDER_MID = '#0e3050';
export const TEXT_PRIMARY = '#e4f8ff';
export const TEXT_MUTED   = '#7cc6db';
export const TEXT_DIM     = '#3d7d94';
export const ACCENT_CYAN   = '#00f0ff';
export const ACCENT_BLUE   = '#0080ff';
export const ACCENT_ORANGE = '#ff6600';

/** Glow shadow helper for TRON-style glow effects. */
export function glowShadow(color: string, intensity: number = 1): string {
  const rgb = hexToRgb(color);
  return `0 0 ${5 * intensity}px rgba(${rgb},${0.25 * intensity}), 0 0 ${10 * intensity}px rgba(${rgb},${0.1 * intensity})`;
}
