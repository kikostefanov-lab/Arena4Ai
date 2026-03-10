import { and, eq, gt, asc, desc, sql, inArray } from 'drizzle-orm';
import type { Db } from './client.js';
import { competitions, events, results, tournaments } from './schema.js';
import type { TeamDeliverable } from './schema.js';
import type { ArenaEvent, Brief, Team, TeamPresentation, ForgeOutput } from '@arena/shared';
import { CompetitionState } from '@arena/shared';
import type { SynthesisResult } from '../synthesis/merge-engine.js';

export interface StoredResult {
  scorecards: unknown[];
  winner: string | null;
  summary?: string;
  synthesis?: SynthesisResult | null;
  presentations?: TeamPresentation[];
  forge?: ForgeOutput | null;
  deliverables?: TeamDeliverable[];
}

export class CompetitionRepository {
  constructor(private readonly db: Db) {}

  async create(id: string, brief: Brief, teams: [Team, Team]): Promise<void> {
    await this.db.insert(competitions).values({
      id,
      brief: brief as unknown as Record<string, unknown>,
      teams: teams as unknown as Record<string, unknown>,
      state: 'DRAFT',
    });
  }

  async getCompetition(id: string) {
    const rows = await this.db.select().from(competitions).where(eq(competitions.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async updateState(id: string, state: CompetitionState): Promise<void> {
    const patch: Partial<typeof competitions.$inferInsert> = { state: state as string };
    if (state === CompetitionState.RUNNING) patch.startedAt = new Date();
    if (state === CompetitionState.COMPLETE || state === CompetitionState.FORGE_COMPLETE) patch.completedAt = new Date();
    await this.db.update(competitions).set(patch).where(eq(competitions.id, id));
  }

  async appendEvent(event: ArenaEvent): Promise<void> {
    await this.db.insert(events).values({
      id: event.eventId,
      competitionId: event.competitionId,
      teamId: event.teamId,
      timestamp: new Date(event.timestamp),
      type: event.type,
      payload: event.payload as Record<string, unknown>,
      metadata: event.metadata as Record<string, unknown>,
      // seq is serial — auto-assigned by Postgres
    });
  }

  async getEvents(competitionId: string, offset?: number) {
    // offset is a per-competition event count (not a global DB serial).
    // Using OFFSET ensures the cursor is stable regardless of how DB serials
    // are distributed across concurrent competitions.
    const query = this.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .orderBy(asc(events.seq));
    if (offset) {
      return query.offset(offset);
    }
    return query;
  }

  async saveResult(competitionId: string, result: StoredResult): Promise<void> {
    await this.db.insert(results).values({
      competitionId,
      scorecards: result.scorecards as Record<string, unknown>[],
      winnerId: result.winner,
      summary: result.summary,
      // Serialize SynthesisResult to JSON text for storage
      synthesis: result.synthesis ? JSON.stringify(result.synthesis) : null,
      presentations: result.presentations ?? null,
      forge: result.forge ?? null,
      deliverables: result.deliverables ?? null,
    });
  }

  async saveForge(competitionId: string, forge: ForgeOutput): Promise<void> {
    await this.db.update(results).set({ forge }).where(eq(results.competitionId, competitionId));
  }

  async countEvents(competitionId: string): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(eq(events.competitionId, competitionId));
    return rows[0]?.count ?? 0;
  }

  async getResult(competitionId: string) {
    const rows = await this.db.select().from(results).where(eq(results.competitionId, competitionId)).limit(1);
    const row = rows[0] ?? null;
    if (!row) return null;
    // Deserialize synthesis from JSON text to SynthesisResult object
    let parsedSynthesis: SynthesisResult | null = null;
    if (row.synthesis) {
      try {
        parsedSynthesis = JSON.parse(row.synthesis) as SynthesisResult;
      } catch {
        // Legacy: if stored as plain markdown text (not JSON), wrap it
        parsedSynthesis = { synthesis: row.synthesis, overallRationale: '', perCriterion: [] };
      }
    }
    return { ...row, synthesis: parsedSynthesis };
  }

  async listResults(competitionIds: string[]) {
    if (competitionIds.length === 0) return [];
    return this.db.select().from(results).where(inArray(results.competitionId, competitionIds));
  }

  async list(limit = 20) {
    return this.db
      .select()
      .from(competitions)
      .orderBy(desc(competitions.startedAt))
      .limit(limit);
  }

  async listSummary(limit = 50) {
    const rows = await this.db
      .select({
        id: competitions.id,
        brief: competitions.brief,
        teams: competitions.teams,
        state: competitions.state,
        startedAt: competitions.startedAt,
        completedAt: competitions.completedAt,
        winnerId: results.winnerId,
      })
      .from(competitions)
      .leftJoin(results, eq(results.competitionId, competitions.id))
      .orderBy(desc(competitions.startedAt))
      .limit(limit);
    return rows;
  }

  async delete(id: string): Promise<boolean> {
    // cascade: events and results first (FK), then competition row
    await this.db.delete(events).where(eq(events.competitionId, id));
    await this.db.delete(results).where(eq(results.competitionId, id));
    const deleted = await this.db.delete(competitions).where(eq(competitions.id, id)).returning({ id: competitions.id });
    return deleted.length > 0;
  }
}

export interface TournamentRanking {
  model: string;
  wins: number;
  losses: number;
  draws: number;
  totalScore: number;
  matchesPlayed: number;
}

export interface StoredTournament {
  id: string;
  name: string;
  brief: Brief;
  teams: string[];
  type: string;
  state: string;
  matchIds: string[];
  rankings: TournamentRanking[] | null;
  createdAt: string;
  completedAt: string | null;
}

export class TournamentRepository {
  constructor(private readonly db: Db) {}

  async createTournament(tournament: Omit<StoredTournament, 'createdAt' | 'completedAt'>): Promise<void> {
    await this.db.insert(tournaments).values({
      id: tournament.id,
      name: tournament.name,
      brief: tournament.brief as unknown as Record<string, unknown>,
      teams: tournament.teams as unknown as Record<string, unknown>,
      type: tournament.type,
      state: tournament.state,
      matchIds: tournament.matchIds as unknown as Record<string, unknown>,
      rankings: tournament.rankings as unknown as Record<string, unknown> | null,
    });
  }

  async getTournament(id: string): Promise<StoredTournament | null> {
    const rows = await this.db.select().from(tournaments).where(eq(tournaments.id, id)).limit(1);
    const row = rows[0] ?? null;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      brief: row.brief as unknown as Brief,
      teams: row.teams as unknown as string[],
      type: row.type,
      state: row.state,
      matchIds: row.matchIds as unknown as string[],
      rankings: row.rankings as unknown as TournamentRanking[] | null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
  }

  async updateTournamentState(id: string, state: string, completedAt?: string): Promise<void> {
    const patch: Partial<typeof tournaments.$inferInsert> = { state };
    if (completedAt) patch.completedAt = new Date(completedAt);
    await this.db.update(tournaments).set(patch).where(eq(tournaments.id, id));
  }

  async updateTournamentProgress(id: string, matchIds: string[], rankings: TournamentRanking[] | null): Promise<void> {
    await this.db.update(tournaments).set({
      matchIds: matchIds as unknown as Record<string, unknown>,
      rankings: rankings as unknown as Record<string, unknown> | null,
    }).where(eq(tournaments.id, id));
  }

  async deleteTournament(id: string): Promise<boolean> {
    const rows = await this.db.delete(tournaments).where(eq(tournaments.id, id)).returning({ id: tournaments.id });
    return rows.length > 0;
  }

  async listTournaments(limit = 20): Promise<StoredTournament[]> {
    const rows = await this.db
      .select()
      .from(tournaments)
      .orderBy(desc(tournaments.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      brief: row.brief as unknown as Brief,
      teams: row.teams as unknown as string[],
      type: row.type,
      state: row.state,
      matchIds: row.matchIds as unknown as string[],
      rankings: row.rankings as unknown as TournamentRanking[] | null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    }));
  }
}
