import { eq, and, ilike, sql, count } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { personas, agents } from './schema.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = NodePgDatabase<any>;

export interface CreatePersonaInput {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  avatar?: string;
  tags?: readonly string[];
  createdBy: string;
}

export interface UpdatePersonaInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  avatar?: string;
  tags?: readonly string[];
}

export interface PersonaWithCount {
  id: string;
  name: string;
  description?: string | null;
  systemPrompt: string;
  avatar?: string | null;
  tags?: string[] | null;
  createdBy: string;
  retired: boolean;
  createdAt: string;
  updatedAt: string;
  agentCount: number;
}

function rowToPersona(row: typeof personas.$inferSelect): Omit<PersonaWithCount, 'agentCount'> {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    systemPrompt: row.systemPrompt,
    avatar: row.avatar ?? undefined,
    tags: (row.tags as string[] | null) ?? undefined,
    createdBy: row.createdBy,
    retired: row.retired,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PersonaRepository {
  constructor(private db: Db) {}

  async create(input: CreatePersonaInput): Promise<PersonaWithCount> {
    const [row] = await this.db.insert(personas).values({
      id: input.id,
      name: input.name,
      description: input.description,
      systemPrompt: input.systemPrompt,
      avatar: input.avatar,
      tags: (input.tags ?? null) as any,
      createdBy: input.createdBy,
      retired: false,
    }).returning();
    return { ...rowToPersona(row), agentCount: 0 };
  }

  async get(id: string): Promise<PersonaWithCount | null> {
    const [row] = await this.db.select().from(personas).where(eq(personas.id, id)).limit(1);
    if (!row) return null;
    const count = await this.getAgentCount(id);
    return { ...rowToPersona(row), agentCount: count };
  }

  async list(filters: { retired?: boolean; search?: string }): Promise<PersonaWithCount[]> {
    const retired = filters.retired ?? false;
    const conditions = [eq(personas.retired, retired)];
    if (filters.search) conditions.push(ilike(personas.name, `${filters.search}%`));

    const rows = await this.db
      .select({
        persona: personas,
        agentCount: sql<number>`count(${agents.id})::int`,
      })
      .from(personas)
      .leftJoin(agents, and(eq(agents.personaId, personas.id), eq(agents.retired, false)))
      .where(and(...conditions))
      .groupBy(personas.id);

    return rows.map(row => ({
      ...rowToPersona(row.persona),
      agentCount: row.agentCount,
    }));
  }

  async update(id: string, input: UpdatePersonaInput): Promise<PersonaWithCount | null> {
    const setValues: Record<string, unknown> = { ...input, updatedAt: new Date() };
    if (input.tags !== undefined) {
      setValues.tags = (input.tags ?? null) as any;
    }
    const [row] = await this.db.update(personas)
      .set(setValues as any)
      .where(eq(personas.id, id))
      .returning();
    if (!row) return null;
    const count = await this.getAgentCount(id);
    return { ...rowToPersona(row), agentCount: count };
  }

  async retire(id: string): Promise<{ retired: boolean; blockedByAgents?: number; notFound?: boolean }> {
    const existing = await this.get(id);
    if (!existing) return { retired: false, notFound: true };
    if (existing.agentCount > 0) {
      return { retired: false, blockedByAgents: existing.agentCount };
    }
    await this.db.update(personas)
      .set({ retired: true, updatedAt: new Date() })
      .where(eq(personas.id, id));
    return { retired: true };
  }

  private async getAgentCount(personaId: string): Promise<number> {
    const [result] = await this.db.select({ count: sql<number>`count(*)::int` })
      .from(agents)
      .where(and(eq(agents.personaId, personaId), eq(agents.retired, false)));
    return result?.count ?? 0;
  }
}
