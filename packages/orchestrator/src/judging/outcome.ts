import type { ScoreCard } from '@arena/shared';

export interface CompetitionOutcome {
  /** The sole rank-one team, or null when there is no unique winner. */
  winnerId: string | null;
  /** Rank-one teams when two or more share the top rank (a draw); empty otherwise. */
  tiedTeamIds: string[];
}

/**
 * Derive the winner from ranked scorecards. `aggregate()` gives teams within its
 * tolerance the SAME rank, so more than one rank-one card is a draw: picking the
 * first would credit an arbitrary team with a win. Persisted as `winnerId: null`;
 * the tied ids are recoverable from the stored scorecards (rank === 1).
 */
export function resolveOutcome(scorecards: ScoreCard[]): CompetitionOutcome {
  const top = scorecards.filter((c) => c.rank === 1).map((c) => c.teamId);
  if (top.length === 1) return { winnerId: top[0]!, tiedTeamIds: [] };
  return { winnerId: null, tiedTeamIds: top };
}
