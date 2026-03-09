/** Format milliseconds as "Xm Ys" (e.g. "2m 30s"). */
export function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Format milliseconds as "M:SS" clock string (e.g. "2:30"). */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
