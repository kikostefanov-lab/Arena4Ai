import { and, eq, gt, desc, sql, inArray } from 'drizzle-orm';
import type { Db } from './client.js';
import { competitions, events, results } from './schema.js';
import type { ArenaEvent, Brief, Team } from '@arena/shared';
import { CompetitionState } from '@arena/shared';

export interface StoredResult {
  scorecards: unknown[];
  winner: string | null;
  summary?: string;
  synthesis?: string | null;
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
    if (state === CompetitionState.COMPLETE) patch.completedAt = new Date();
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

  async getEvents(competitionId: string, afterSeq?: number) {
    if (afterSeq !== undefined) {
      return this.db
        .select()
        .from(events)
        .where(and(eq(events.competitionId, competitionId), gt(events.seq, afterSeq)))
        .orderBy(events.seq);
    }

    return this.db
      .select()
      .from(events)
      .where(eq(events.competitionId, competitionId))
      .orderBy(events.seq);
  }

  async saveResult(competitionId: string, result: StoredResult): Promise<void> {
    await this.db.insert(results).values({
      competitionId,
      scorecards: result.scorecards as Record<string, unknown>[],
      winnerId: result.winner,
      summary: result.summary,
      synthesis: result.synthesis ?? null,
    });
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
    return rows[0] ?? null;
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
