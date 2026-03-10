/** Format milliseconds as "Xm Ys" (e.g. "2m 30s"). */
export function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/** Format a time limit in ms to a human-readable string (e.g. "30s", "2m", "1.5h"). */
export function formatTimeLimit(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** Format milliseconds as "M:SS" clock string (e.g. "2:30"). */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Resolve a display label for a team from a list. Falls back to `fallback`. */
export function resolveTeamLabel(
  teams: Array<{ id: string; model: string; persona?: string }>,
  teamId: string,
  fallback: string,
): string {
  const t = teams.find((t) => t.id === teamId);
  if (!t) return fallback;
  return t.persona ? `${t.model}:${t.persona}` : t.model;
}
