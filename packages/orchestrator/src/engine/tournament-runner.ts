import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { CompetitionRunner } from './competition-runner.js';
import type { RunOptions } from './competition-runner.js';
import type { Brief } from '@arena/shared';

export interface TournamentOptions extends RunOptions {
  name?: string;
}

export interface TournamentRanking {
  model: string;
  wins: number;
  losses: number;
  draws: number;
  totalScore: number;
  matchesPlayed: number;
}

export interface TournamentResult {
  tournamentId: string;
  name: string;
  matchIds: string[];
  rankings: TournamentRanking[];
}

/**
 * Runs a round-robin tournament: every pair of teams competes once.
 * Matches run sequentially to avoid resource exhaustion.
 * Emits: 'matchStart', 'matchEnd', 'complete', 'error'
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
    const scores: Map<string, { wins: number; losses: number; draws: number; totalScore: number; matchesPlayed: number }> = new Map();
    for (const team of teams) {
      scores.set(team, { wins: 0, losses: 0, draws: 0, totalScore: 0, matchesPlayed: 0 });
    }

    for (const [teamA, teamB] of pairs) {
      if (this._cancelled) break;

      const teamAEntry = { id: 'team-a', model: teamA, persona: teamA.split(':')[1] ?? 'default' };
      const teamBEntry = { id: 'team-b', model: teamB, persona: teamB.split(':')[1] ?? 'default' };

      try {
        const runner = new CompetitionRunner(
          brief,
          [teamAEntry, teamBEntry],
          options,
        );

        this.emit('matchStart', { teamA, teamB, competitionId: runner.competitionId, runner });

        const result = await runner.run();
        matchIds.push(runner.competitionId);

        // Accumulate scores
        for (const scorecard of result.scorecards) {
          const model = scorecard.teamId === 'team-a' ? teamA : teamB;
          const entry = scores.get(model)!;
          entry.totalScore += scorecard.finalScore ?? 0;
          entry.matchesPlayed++;
        }

        // Determine win/loss/draw
        const winner = result.winner;
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

        this.emit('matchEnd', {
          teamA,
          teamB,
          competitionId: runner.competitionId,
          winner: winner === 'team-a' ? teamA : winner === 'team-b' ? teamB : null,
        });
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

  cancel(): void {
    this._cancelled = true;
  }
}
