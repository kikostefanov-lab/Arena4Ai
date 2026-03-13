import { eq, and } from 'drizzle-orm';
import { agentProfiles } from './schema.js';
import type { AgentProfile } from '@arena/shared';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = NodePgDatabase<any>;

type CreateInput = {
  id?: string;
  name: string;
  description?: string;
  provider: string;
  modelVariant: string;
  systemPrompt: string;
  avatar?: string;
  tags?: string[];
  createdBy: string;
  forkedFromId?: string;
};

type UpdateInput = Partial<Pick<AgentProfile, 'name' | 'description' | 'systemPrompt' | 'avatar' | 'tags' | 'modelVariant'>>;

type ListFilters = {
  provider?: string;
  retired?: boolean;
  tags?: string[];
};

function rowToProfile(row: typeof agentProfiles.$inferSelect): AgentProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    provider: row.provider as AgentProfile['provider'],
    modelVariant: row.modelVariant,
    systemPrompt: row.systemPrompt,
    avatar: row.avatar ?? undefined,
    tags: (row.tags as string[] | null) ?? undefined,
    retired: row.retired,
    createdBy: row.createdBy,
    forkedFromId: row.forkedFromId ?? undefined,
    statsWins: row.statsWins,
    statsLosses: row.statsLosses,
    statsTotal: row.statsTotal,
    statsAvgScore: row.statsAvgScore ? Number(row.statsAvgScore) : undefined,
    statsLastUsedAt: row.statsLastUsedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class AgentProfileRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateInput): Promise<void> {
    await this.db.insert(agentProfiles).values({
      id: input.id ?? `agent-${randomUUID()}`,
      name: input.name,
      description: input.description,
      provider: input.provider,
      modelVariant: input.modelVariant,
      systemPrompt: input.systemPrompt,
      avatar: input.avatar,
      tags: input.tags ?? null,
      retired: false,
      createdBy: input.createdBy,
      forkedFromId: input.forkedFromId,
      statsWins: 0,
      statsLosses: 0,
      statsTotal: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async get(id: string): Promise<AgentProfile | null> {
    const rows = await this.db.select().from(agentProfiles).where(eq(agentProfiles.id, id));
    return rows[0] ? rowToProfile(rows[0]) : null;
  }

  async getByProviderAndName(provider: string, name: string): Promise<AgentProfile | null> {
    const rows = await this.db
      .select()
      .from(agentProfiles)
      .where(
        and(
          eq(agentProfiles.provider, provider),
          eq(agentProfiles.name, name),
          eq(agentProfiles.retired, false),
        ),
      );
    return rows[0] ? rowToProfile(rows[0]) : null;
  }

  async list(filters: ListFilters = {}): Promise<AgentProfile[]> {
    const conditions = [];
    if (filters.provider) conditions.push(eq(agentProfiles.provider, filters.provider));
    if (filters.retired !== undefined) conditions.push(eq(agentProfiles.retired, filters.retired));

    const query = conditions.length > 0
      ? this.db.select().from(agentProfiles).where(and(...conditions)).orderBy(agentProfiles.createdAt)
      : this.db.select().from(agentProfiles).orderBy(agentProfiles.createdAt);

    const rows = await query;
    let profiles = rows.map(rowToProfile);

    // Tags filter applied in JS (JSONB containment; data set is small)
    if (filters.tags && filters.tags.length > 0) {
      profiles = profiles.filter(p => filters.tags!.every(t => p.tags?.includes(t)));
    }

    return profiles;
  }

  async update(id: string, patch: UpdateInput): Promise<AgentProfile | null> {
    const rows = await this.db
      .update(agentProfiles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(agentProfiles.id, id))
      .returning();
    return rows[0] ? rowToProfile(rows[0]) : null;
  }

  async retire(id: string): Promise<boolean> {
    const rows = await this.db
      .update(agentProfiles)
      .set({ retired: true, updatedAt: new Date() })
      .where(eq(agentProfiles.id, id))
      .returning();
    return rows.length > 0;
  }

  async fork(sourceId: string, name: string, createdBy: string): Promise<AgentProfile> {
    const source = await this.get(sourceId);
    if (!source) throw new Error(`Agent profile ${sourceId} not found`);
    const newId = `agent-${randomUUID()}`;
    await this.create({
      id: newId,
      name,
      description: source.description,
      provider: source.provider,
      modelVariant: source.modelVariant,
      systemPrompt: source.systemPrompt,
      avatar: source.avatar,
      tags: source.tags,
      createdBy,
      forkedFromId: sourceId,
    });
    return (await this.get(newId))!;
  }

  async updateStats(id: string, won: boolean, score: number): Promise<void> {
    const profile = await this.get(id);
    if (!profile) return;
    const newTotal = profile.statsTotal + 1;
    const newWins = profile.statsWins + (won ? 1 : 0);
    const newLosses = profile.statsLosses + (won ? 0 : 1);
    const oldAvg = profile.statsAvgScore ?? 0;
    const newAvg = ((oldAvg * profile.statsTotal) + score) / newTotal;
    await this.db
      .update(agentProfiles)
      .set({
        statsWins: newWins,
        statsLosses: newLosses,
        statsTotal: newTotal,
        statsAvgScore: String(newAvg),
        statsLastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentProfiles.id, id));
  }
}
