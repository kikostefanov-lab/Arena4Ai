/** Row shape from the competitions table (only the fields we need). */
interface CompetitionRow {
  id: string;
  teams: unknown;  // jsonb → parse as TeamInRow[]
  state: string;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
}

interface ResultRow {
  competitionId: string;
  winnerId: string | null;
}

interface TeamInRow {
  id: string;
  model: string;
  persona?: string;
}

/**
 * Compute win rates per model prefix from raw DB rows.
 */
export function computeWinRate(
  competitions: CompetitionRow[],
  results: ResultRow[],
): Record<string, { wins: number; total: number }> {
  const resultMap = new Map(results.map((r) => [r.competitionId, r.winnerId]));
  const stats: Record<string, { wins: number; total: number }> = {};

  for (const comp of competitions) {
    const teams = comp.teams as TeamInRow[];
    const winnerId = resultMap.get(comp.id) ?? null;

    for (const team of teams) {
      const key = team.persona ? `${team.model}:${team.persona}` : team.model;
      if (!stats[key]) stats[key] = { wins: 0, total: 0 };
      stats[key].total += 1;
      if (team.id === winnerId) stats[key].wins += 1;
    }
  }

  return stats;
}

/**
 * Compute the fraction of competitions that reached COMPLETE state.
 */
export function computeCompletionRate(competitions: CompetitionRow[]): number {
  if (competitions.length === 0) return 0;
  const completed = competitions.filter((c) => c.state === 'COMPLETE').length;
  return completed / competitions.length;
}

/**
 * Compute average duration in ms for COMPLETE competitions.
 * Returns null if no completed competitions exist.
 */
export function computeAvgDurationMs(competitions: CompetitionRow[]): number | null {
  const completed = competitions.filter(
    (c) => c.state === 'COMPLETE' && c.startedAt && c.completedAt,
  );
  if (completed.length === 0) return null;
  const total = completed.reduce((sum, c) => {
    const start = c.startedAt instanceof Date ? c.startedAt.getTime() : new Date(c.startedAt as string).getTime();
    const end = c.completedAt instanceof Date ? c.completedAt.getTime() : new Date(c.completedAt as string).getTime();
    return sum + (end - start);
  }, 0);
  return Math.round(total / completed.length);
}
