import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { CompetitionRunner } from './competition-runner.js';
import type { RunOptions } from './competition-runner.js';
import type { Brief } from '@arena/shared';

export interface TournamentOptions extends RunOptions {
  name?: string;
  /** Tournament format. Default: 'ROUND_ROBIN' */
  type?: 'ROUND_ROBIN' | 'SWISS';
  /** Swiss only: number of rounds. Default: ceil(log2(teams.length)) */
  swissRounds?: number;
}

export interface TournamentRanking {
  model: string;
  wins: number;
  losses: number;
  draws: number;
  totalScore: number;
  matchesPlayed: number;
  /** Swiss: sum of opponents' win counts at time of ranking calculation */
  buchholz?: number;
}

export interface TournamentResult {
  tournamentId: string;
  name: string;
  matchIds: string[];
  rankings: TournamentRanking[];
  /** Swiss metadata attached to result for DB persistence */
  swissMeta?: SwissMeta;
}

/** Swiss state stored in rankings jsonb field alongside standard ranking fields */
export interface SwissMeta {
  currentRound: number;
  totalRounds: number;
  roundPairings: Array<{ round: number; pairs: Array<[string, string]> }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type ScoreMap = Map<string, {
  wins: number;
  losses: number;
  draws: number;
  totalScore: number;
  matchesPlayed: number;
}>;

/** Fisher-Yates shuffle (in-place) */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate Swiss round pairings.
 * - Groups teams by win count.
 * - Pairs within groups; overflows to next group.
 * - Avoids rematches (best-effort greedy).
 */
function generateSwissPairings(
  teams: string[],
  scores: ScoreMap,
  playedPairs: Set<string>,
): [string, string][] {
  // Sort teams: wins desc, then totalScore desc
  const sorted = [...teams].sort((a, b) => {
    const sa = scores.get(a)!;
    const sb = scores.get(b)!;
    return sb.wins - sa.wins || sb.totalScore - sa.totalScore;
  });

  const paired = new Set<string>();
  const pairs: [string, string][] = [];
  const unpaired: string[] = [];

  for (const team of sorted) {
    if (paired.has(team)) continue;

    // Find best opponent: same win count first, no rematch, not already paired
    const teamWins = scores.get(team)!.wins;
    const candidates = sorted.filter((t) =>
      t !== team &&
      !paired.has(t) &&
      !playedPairs.has([team, t].sort().join('|||'))
    );

    // Prefer same win count
    const sameWin = candidates.filter((t) => scores.get(t)!.wins === teamWins);
    const pool = sameWin.length > 0 ? sameWin : candidates;

    if (pool.length === 0) {
      // No valid opponent found — allow rematch as fallback
      const fallback = sorted.find((t) => t !== team && !paired.has(t));
      if (fallback) {
        pairs.push([team, fallback]);
        paired.add(team);
        paired.add(fallback);
      } else {
        unpaired.push(team);
      }
      continue;
    }

    const opponent = pool[0];
    pairs.push([team, opponent]);
    paired.add(team);
    paired.add(opponent);
  }

  // If odd number of teams, one team gets a bye (skip) — just leave unpaired

  return pairs;
}

/** Compute Buchholz score: sum of opponents' win counts */
function computeBuchholz(
  team: string,
  opponentHistory: Map<string, string[]>,
  scores: ScoreMap,
): number {
  const opponents = opponentHistory.get(team) ?? [];
  return opponents.reduce((sum, opp) => sum + (scores.get(opp)?.wins ?? 0), 0);
}

// ─── Match execution helper ───────────────────────────────────────────────────

async function runMatch(
  brief: Brief,
  teamA: string,
  teamB: string,
  options: RunOptions,
  emitter: EventEmitter,
): Promise<{ matchId: string; winner: string | null; scorecards: Array<{ teamId: string; finalScore?: number }> }> {
  const teamAEntry = { id: 'team-a', model: teamA, persona: teamA.split(':')[1] ?? 'default' };
  const teamBEntry = { id: 'team-b', model: teamB, persona: teamB.split(':')[1] ?? 'default' };

  const runner = new CompetitionRunner(brief, [teamAEntry, teamBEntry], options);
  emitter.emit('matchStart', { teamA, teamB, competitionId: runner.competitionId, runner });

  const result = await runner.run();

  const resolvedWinner =
    result.winner === 'team-a' ? teamA :
    result.winner === 'team-b' ? teamB :
    null;

  emitter.emit('matchEnd', {
    teamA,
    teamB,
    competitionId: runner.competitionId,
    winner: resolvedWinner,
  });

  return { matchId: runner.competitionId, winner: result.winner, scorecards: result.scorecards };
}

// ─── TournamentRunner ─────────────────────────────────────────────────────────

/**
 * Runs a tournament in either round-robin or Swiss format.
 * - Round-robin: every pair of teams competes once.
 * - Swiss: N rounds (default: ceil(log2(teams))), pairing by win group each round.
 *
 * Matches run sequentially to avoid resource exhaustion.
 * Emits: 'matchStart', 'matchEnd', 'roundComplete' (Swiss), 'complete', 'error'
 */
export class TournamentRunner extends EventEmitter {
  readonly tournamentId = randomUUID();
  private _cancelled = false;

  constructor(
    private readonly brief: Brief,
    private readonly teams: string[],  // model:persona strings
    private readonly options: TournamentOptions = {},
  ) {
    super();
    if (teams.length < 2) throw new Error('Tournament requires at least 2 teams');
  }

  async run(): Promise<TournamentResult> {
    const type = this.options.type ?? 'ROUND_ROBIN';
    if (type === 'SWISS') {
      return this._runSwiss();
    }
    return this._runRoundRobin();
  }

  // ── Round-Robin ─────────────────────────────────────────────────────────────

  private async _runRoundRobin(): Promise<TournamentResult> {
    const { teams, brief, options } = this;
    const name = options.name ?? `Tournament ${this.tournamentId.slice(0, 8)}`;

    // Generate all pairs (round-robin)
    const pairs: [string, string][] = [];
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        pairs.push([teams[i], teams[j]]);
      }
    }

    const matchIds: string[] = [];
    const scores: ScoreMap = new Map();
    for (const team of teams) {
      scores.set(team, { wins: 0, losses: 0, draws: 0, totalScore: 0, matchesPlayed: 0 });
    }

    for (const [teamA, teamB] of pairs) {
      if (this._cancelled) break;

      try {
        const { matchId, winner, scorecards } = await runMatch(brief, teamA, teamB, options, this);
        matchIds.push(matchId);

        // Accumulate scores
        for (const scorecard of scorecards) {
          const model = scorecard.teamId === 'team-a' ? teamA : teamB;
          const entry = scores.get(model)!;
          entry.totalScore += scorecard.finalScore ?? 0;
          entry.matchesPlayed++;
        }

        // Determine win/loss/draw
        if (winner === 'team-a') {
          scores.get(teamA)!.wins++;
          scores.get(teamB)!.losses++;
        } else if (winner === 'team-b') {
          scores.get(teamB)!.wins++;
          scores.get(teamA)!.losses++;
        } else {
          scores.get(teamA)!.draws++;
          scores.get(teamB)!.draws++;
        }
      } catch (err) {
        console.error(`[tournament] match ${teamA} vs ${teamB} failed:`, err);
        this.emit('matchEnd', { teamA, teamB, winner: null, error: true });
      }
    }

    // Compute rankings: sort by wins desc, then totalScore desc
    const rankings: TournamentRanking[] = Array.from(scores.entries())
      .map(([model, stats]) => ({ model, ...stats }))
      .sort((a, b) => b.wins - a.wins || b.totalScore - a.totalScore);

    const result: TournamentResult = {
      tournamentId: this.tournamentId,
      name,
      matchIds,
      rankings,
    };

    this.emit('complete', result);
    return result;
  }

  // ── Swiss ───────────────────────────────────────────────────────────────────

  private async _runSwiss(): Promise<TournamentResult> {
    const { teams, brief, options } = this;
    const name = options.name ?? `Swiss Tournament ${this.tournamentId.slice(0, 8)}`;
    const totalRounds = options.swissRounds ?? Math.ceil(Math.log2(teams.length));

    const matchIds: string[] = [];
    const scores: ScoreMap = new Map();
    for (const team of teams) {
      scores.set(team, { wins: 0, losses: 0, draws: 0, totalScore: 0, matchesPlayed: 0 });
    }

    // Track played pairs (sorted key) to avoid rematches
    const playedPairs = new Set<string>();
    // Track per-team opponent history for Buchholz
    const opponentHistory = new Map<string, string[]>();
    for (const team of teams) opponentHistory.set(team, []);

    const roundPairings: SwissMeta['roundPairings'] = [];

    for (let round = 1; round <= totalRounds; round++) {
      if (this._cancelled) break;

      const pairs = generateSwissPairings(teams, scores, playedPairs);
      roundPairings.push({ round, pairs });

      this.emit('roundStart', { round, totalRounds, pairs });

      for (const [teamA, teamB] of pairs) {
        if (this._cancelled) break;

        try {
          const { matchId, winner, scorecards } = await runMatch(brief, teamA, teamB, options, this);
          matchIds.push(matchId);

          // Track played pair
          playedPairs.add([teamA, teamB].sort().join('|||'));
          opponentHistory.get(teamA)!.push(teamB);
          opponentHistory.get(teamB)!.push(teamA);

          // Accumulate scores
          for (const scorecard of scorecards) {
            const model = scorecard.teamId === 'team-a' ? teamA : teamB;
            const entry = scores.get(model)!;
            entry.totalScore += scorecard.finalScore ?? 0;
            entry.matchesPlayed++;
          }

          // Determine win/loss/draw
          if (winner === 'team-a') {
            scores.get(teamA)!.wins++;
            scores.get(teamB)!.losses++;
          } else if (winner === 'team-b') {
            scores.get(teamB)!.wins++;
            scores.get(teamA)!.losses++;
          } else {
            scores.get(teamA)!.draws++;
            scores.get(teamB)!.draws++;
          }
        } catch (err) {
          console.error(`[swiss] match ${teamA} vs ${teamB} failed:`, err);
          this.emit('matchEnd', { teamA, teamB, winner: null, error: true });
        }
      }

      this.emit('roundComplete', { round, totalRounds });
    }

    // Final rankings: wins desc → Buchholz desc → totalScore desc
    const rankings: TournamentRanking[] = Array.from(scores.entries())
      .map(([model, stats]) => ({
        model,
        ...stats,
        buchholz: computeBuchholz(model, opponentHistory, scores),
      }))
      .sort((a, b) =>
        b.wins - a.wins ||
        (b.buchholz ?? 0) - (a.buchholz ?? 0) ||
        b.totalScore - a.totalScore
      );

    const swissMeta: SwissMeta = {
      currentRound: Math.min(totalRounds, totalRounds),
      totalRounds,
      roundPairings,
    };

    const result: TournamentResult = {
      tournamentId: this.tournamentId,
      name,
      matchIds,
      rankings,
      swissMeta,
    };

    this.emit('complete', result);
    return result;
  }

  cancel(): void {
    this._cancelled = true;
  }
}
