import type { Brief, Team, ForgeSource } from '@arena/shared';

/**
 * Derive a URL-safe slug from a Brief.
 * Uses brief.id if set and non-empty; otherwise slugifies the title.
 * Max 60 chars; lowercase; only a-z, 0-9, hyphens.
 */
export function slugifyBrief(brief: Brief, maxLen = 60): string {
  const source = (brief.id && brief.id.trim()) ? brief.id : brief.title;
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')  // strip leading/trailing hyphens
    .slice(0, maxLen)
    .replace(/-+$/, '');       // strip trailing hyphens created by truncation
}

/**
 * Format a date as YYYYMMDD (compact, sortable).
 * Accepts an ISO 8601 string or a Date object.
 */
export function formatDateCompact(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Format a date as YYYYMMDD-HHMMSS (for per-run forge filenames).
 */
export function formatDateTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const dateStr = formatDateCompact(d);
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${dateStr}-${h}${min}${s}`;
}

/**
 * Build a human-readable ZIP filename for a team's deliverables.
 * Pattern: arena4ai_{brief-slug}_{team-qualifier}_{date}_deliverables.zip
 */
export function buildDeliverableFilename(
  brief: Brief,
  team: Team,
  startedAt?: string
): string {
  const slug = slugifyBrief(brief);
  const date = formatDateCompact(startedAt ?? new Date().toISOString());
  const qualifier = team.model
    ? team.model.replace(':', '-')
    : `team-${team.id}`;
  return `arena4ai_${slug}_${qualifier}_${date}_deliverables.zip`;
}

/**
 * Build a human-readable ZIP filename for a forge run.
 * Pattern: arena4ai_{brief-slug}_{source}_{timestamp}_forge-run.zip
 */
export function buildForgeFilename(
  brief: Brief,
  source: ForgeSource,
  generatedAt?: string
): string {
  const slug = slugifyBrief(brief);
  const ts = formatDateTimestamp(generatedAt ?? new Date().toISOString());
  return `arena4ai_${slug}_${source}_${ts}_forge-run.zip`;
}
