import { and, eq, gt, desc } from 'drizzle-orm';
import type { Db } from './client.js';
import { competitions, events, results } from './schema.js';
import type { ArenaEvent, Brief, Team, CompetitionState } from '@arena/shared';

export interface StoredResult {
  scorecards: unknown[];
  winner: string | null;
  summary?: string;
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
    const patch: Record<string, unknown> = { state };
    if (state === 'RUNNING') patch.startedAt = new Date();
    if (state === 'COMPLETE') patch.completedAt = new Date();
    await this.db.update(competitions).set(patch as never).where(eq(competitions.id, id));
  }

  async appendEvent(event: ArenaEvent): Promise<void> {
    const existing = await this.db
      .select({ seq: events.seq })
      .from(events)
      .where(eq(events.competitionId, event.competitionId))
      .orderBy(desc(events.seq))
      .limit(1);

    const seq = (existing[0]?.seq ?? 0) + 1;

    await this.db.insert(events).values({
      id: event.eventId,
      competitionId: event.competitionId,
      teamId: event.teamId,
      timestamp: new Date(event.timestamp),
      type: event.type,
      payload: event.payload as Record<string, unknown>,
      metadata: event.metadata as Record<string, unknown>,
      seq,
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
    });
  }

  async getResult(competitionId: string) {
    const rows = await this.db.select().from(results).where(eq(results.competitionId, competitionId)).limit(1);
    return rows[0] ?? null;
  }

  async list(limit = 20) {
    return this.db
      .select()
      .from(competitions)
      .orderBy(desc(competitions.startedAt))
      .limit(limit);
  }
}
