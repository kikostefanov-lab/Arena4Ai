/**
 * Shared design tokens for Agent Arena web UI.
 *
 * Single source of truth for model colors, state colors, and brand values.
 * Import from here — never hardcode hex values in components.
 */

/** Model identity colors — consistent across gallery, arena, analytics. */
export const MODEL_COLORS: Record<string, string> = {
  claude: '#f97316', // orange
  codex:  '#22c55e', // green
  gemini: '#a855f7', // purple
};

export function getModelColor(model: string): string {
  const base = model.toLowerCase().split(':')[0];
  return MODEL_COLORS[base] ?? '#8896ab';
}

/** Lane colors for multi-team scenarios (indexed by team position). */
export const LANE_COLORS = [
  MODEL_COLORS.claude,  // team-a default
  MODEL_COLORS.gemini,  // team-b default
  MODEL_COLORS.codex,
  '#eab308',
  '#06b6d4',
];

/** Model badge colors used in the arena lane headers. */
export const MODEL_BADGE_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  claude: { bg: 'rgba(249,115,22,0.15)', fg: '#f97316', border: 'rgba(249,115,22,0.4)' },
  codex:  { bg: 'rgba(34,197,94,0.15)',  fg: '#22c55e', border: 'rgba(34,197,94,0.4)' },
  gemini: { bg: 'rgba(168,85,247,0.15)', fg: '#a855f7', border: 'rgba(168,85,247,0.4)' },
};

/** Competition state badge colors. */
export const STATE_STYLES: Record<string, { bg: string; color: string }> = {
  COMPLETE:    { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e' },
  RUNNING:     { bg: 'rgba(249,115,22,0.15)',  color: '#f97316' },
  JUDGING:     { bg: 'rgba(234,179,8,0.12)',   color: '#eab308' },
  SCORED:      { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e' },
  SYNTHESIZING:{ bg: 'rgba(168,85,247,0.12)', color: '#a855f7' },
  DRAFT:       { bg: 'rgba(136,150,171,0.08)', color: '#8896ab' },
  CONFIGURED:  { bg: 'rgba(136,150,171,0.08)', color: '#8896ab' },
  LAUNCHING:   { bg: 'rgba(6,182,212,0.12)',   color: '#06b6d4' },
  TIME_UP:     { bg: 'rgba(234,179,8,0.12)',   color: '#eab308' },
  COLLECTING:  { bg: 'rgba(168,85,247,0.12)', color: '#a855f7' },
  PRESENTING:  { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6' },
  FORGING:     { bg: 'rgba(234,179,8,0.12)',   color: '#eab308' },
  FORGE_COMPLETE: { bg: 'rgba(34,197,94,0.12)', color: '#22c55e' },
  FAILED:      { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444' },
  CANCELLED:   { bg: 'rgba(136,150,171,0.08)', color: '#8896ab' },
  // Arena page aliases
  PENDING:     { bg: 'rgba(136,150,171,0.1)',  color: '#8896ab' },
  ERROR:       { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444' },
};

export function getStateStyle(state: string): { bg: string; color: string } {
  return STATE_STYLES[state] ?? { bg: 'rgba(136,150,171,0.08)', color: '#8896ab' };
}

/** Format badge styles for brief formats. */
export const FORMAT_BADGES: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  SPRINT:      { bg: 'rgba(6,182,212,0.12)',   color: '#06b6d4', label: 'SPRINT',    icon: '⚡' },
  HACKATHON:   { bg: 'rgba(168,85,247,0.12)', color: '#a855f7', label: 'HACKATHON', icon: '🔨' },
  RED_VS_BLUE: { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', label: 'RED×BLUE',  icon: '⚔️' },
  RELAY_RACE:  { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e', label: 'RELAY',     icon: '🔄' },
};

/**
 * Convert a 6-digit hex color to an "r,g,b" string for use in rgba().
 * e.g. hexToRgb('#f97316') → '249,115,22'
 */
export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

/** Brand background color. */
export const BG_DARK = '#0a0e17';
export const BG_CARD = '#111827';
export const BG_HEADER = '#0f1724';
export const BORDER_DIM = '#1e2d45';
export const BORDER_MID = '#2d4060';
export const TEXT_PRIMARY = '#e2e8f0';
export const TEXT_MUTED = '#8896ab';
export const TEXT_DIM = '#4a5568';
export const ACCENT_ORANGE = '#f97316';
