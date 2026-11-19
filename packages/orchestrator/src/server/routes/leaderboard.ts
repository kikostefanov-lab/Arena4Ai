import { Router, type Request, type Response } from 'express';
import { isFinishedState, isSyntheticCompetition } from '@arena/shared';
import { repo } from '../repo.js';

export const leaderboardRouter = Router();

export interface ModelStats {
  model: string;
  wins: number;
  losses: number;
  ties: number;
  totalCompetitions: number;
  avgScore: number;
  winRate: number;
}

export interface LeaderboardEntry extends ModelStats {
  rank: number;
}

interface Scorecard {
  teamId: string;
  /** Aggregated 0-1 score across judges (see ScoreCard in @arena/shared). */
  finalScore?: number;
  /** 1 = first place; shared by tied teams. Absent on results stored before ranks. */
  rank?: number;
  [key: string]: unknown;
}

leaderboardRouter.get('/', async (_req: Request, res: Response) => {
  // Fetch all completed competitions and their results
  const competitions = await repo.list(500);
  const completedComps = competitions.filter((c) => isFinishedState(c.state) && !isSyntheticCompetition(c));

  if (completedComps.length === 0) {
    res.json([]);
    return;
  }

  const allResults = await repo.listResults(completedComps.map((c) => c.id));

  // Build map of competitionId → competition for O(1) lookup
  const compMap = new Map(completedComps.map((c) => [c.id, c]));

  // Accumulate stats per model prefix
  const statsMap = new Map<string, { wins: number; losses: number; ties: number; totalCompetitions: number; scoreTotal: number }>();

  const ensureModel = (model: string) => {
    if (!statsMap.has(model)) {
      statsMap.set(model, { wins: 0, losses: 0, ties: 0, totalCompetitions: 0, scoreTotal: 0 });
    }
    return statsMap.get(model)!;
  };

  for (const result of allResults) {
    const comp = compMap.get(result.competitionId);
    if (!comp) continue;

    const teams = comp.teams as Array<{ id: string; model: string; persona?: string }>;
    if (!teams || teams.length < 2) continue;

    const scorecards = result.scorecards as Scorecard[];
    if (!Array.isArray(scorecards)) continue;

    // Build map of teamId → { model, score }
    const teamInfoMap = new Map<string, { model: string; score: number; rank?: number }>();
    for (const team of teams) {
      const modelPrefix = team.model.split(':')[0].toLowerCase();
      const scorecard = scorecards.find((s) => s.teamId === team.id);
      const finalScore = typeof scorecard?.finalScore === 'number' ? scorecard.finalScore : 0;
      const rank = typeof scorecard?.rank === 'number' ? scorecard.rank : undefined;
      teamInfoMap.set(team.id, { model: modelPrefix, score: finalScore, rank });
    }

    // Determine winner/loser/tie
    const teamIds = teams.map((t) => t.id);
    const winnerId = result.winnerId;

    for (const teamId of teamIds) {
      const info = teamInfoMap.get(teamId);
      if (!info) continue;

      const entry = ensureModel(info.model);
      entry.totalCompetitions += 1;
      entry.scoreTotal += info.score;

      if (!winnerId) {
        // No sole winner. Only the teams sharing first place drew; in a three-
        // or four-way match a team ranked below them lost. Results stored
        // before ranks existed carry none, and those keep the old reading
        // (everyone tied).
        if (info.rank === undefined || info.rank === 1) entry.ties += 1;
        else entry.losses += 1;
      } else if (teamId === winnerId) {
        entry.wins += 1;
      } else {
        entry.losses += 1;
      }
    }
  }

  // Convert to sorted array with ranks
  const sorted = Array.from(statsMap.entries())
    .map(([model, s]): ModelStats => ({
      model,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
      totalCompetitions: s.totalCompetitions,
      avgScore: s.totalCompetitions > 0 ? Number((s.scoreTotal / s.totalCompetitions).toFixed(3)) : 0,
      winRate: s.totalCompetitions > 0 ? Number((s.wins / s.totalCompetitions).toFixed(3)) : 0,
    }))
    .sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
      return b.wins - a.wins;
    });

  // Assign ranks — tied entries share rank
  const leaderboard: LeaderboardEntry[] = [];
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const prev = sorted[i - 1];
    if (i > 0 && prev && (entry.winRate !== prev.winRate || entry.avgScore !== prev.avgScore)) {
      currentRank = i + 1;
    }
    leaderboard.push({ rank: currentRank, ...entry });
  }

  res.json(leaderboard);
});
