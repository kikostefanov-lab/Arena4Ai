// TRON design tokens — standalone copy for use in Remotion components.
// Keep in sync with packages/web/lib/design-tokens.ts manually.

export const BG_DARK    = '#000408';
export const BG_CARD    = '#050f1e';
export const BG_HEADER  = '#020b14';

export const ACCENT_CYAN   = '#00f0ff';
export const ACCENT_BLUE   = '#0080ff';
export const ACCENT_ORANGE = '#ff6600';
export const ACCENT_GOLD   = '#ffd700';

export const TEXT_PRIMARY = '#e4f8ff';
export const TEXT_MUTED   = '#7cc6db';
export const TEXT_DIM     = '#3d7d94';

export const MODEL_COLORS: Record<string, string> = {
  claude: '#ff6600',
  codex:  '#0066ff',
  gemini: '#00f0ff',
};

export function getModelColor(model: string): string {
  const base = model.toLowerCase().split(':')[0];
  return MODEL_COLORS[base] ?? '#4a8fa8';
}

export const ORBITRON = '"Orbitron", sans-serif';
export const MONO     = '"SF Mono", "Fira Code", monospace';
