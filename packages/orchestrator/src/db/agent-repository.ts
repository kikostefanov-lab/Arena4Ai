import { eq, and, ilike, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { agents, personas } from './schema.js';

type Db = NodePgDatabase<any>;

export interface AgentPersona {
  id: string;
  name: string;
  avatar?: string | null;
  description?: string | null;
  systemPrompt: string;
}

export interface AgentWithPersona {
  id: string;
  name: string;
  persona: AgentPersona | null;
  personaId: string | null;
  provider: string;
  modelVariant: string;
  providerOptions: Record<string, unknown> | null;
  createdBy: string;
  forkedFromId: string | null;
  retired: boolean;
  statsWins: number;
  statsLosses: number;
  statsTotal: number;
  statsAvgScore: number | null;
  statsLastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  id: string;
  name: string;
  personaId?: string | null;
  provider: 'claude' | 'codex' | 'gemini';
  modelVariant: string;
  providerOptions?: Record<string, unknown> | null;
  createdBy: string;
  forkedFromId?: string | null;
}

export interface UpdateAgentInput {
  name?: string;
  personaId?: string | null;
  modelVariant?: string;
  providerOptions?: Record<string, unknown> | null;
}

function rowToAgent(
  row: typeof agents.$inferSelect,
  personaRow: typeof personas.$inferSelect | null,
): AgentWithPersona {
  return {
    id: row.id,
    name: row.name,
    personaId: row.personaId,
    persona: personaRow
      ? {
          id: personaRow.id,
          name: personaRow.name,
          avatar: personaRow.avatar,
          description: personaRow.description,
          systemPrompt: personaRow.systemPrompt,
        }
      : null,
    provider: row.provider,
    modelVariant: row.modelVariant,
    providerOptions: (row.providerOptions as Record<string, unknown> | null) ?? null,
    createdBy: row.createdBy,
    forkedFromId: row.forkedFromId,
    retired: row.retired,
    statsWins: row.statsWins,
    statsLosses: row.statsLosses,
    statsTotal: row.statsTotal,
    statsAvgScore: row.statsAvgScore !== null && row.statsAvgScore !== undefined ? Number(row.statsAvgScore) : null,
    statsLastUsedAt: row.statsLastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class AgentRepository {
  constructor(private db: Db) {}

  async create(input: CreateAgentInput): Promise<AgentWithPersona> {
    const [row] = await this.db.insert(agents).values({
      id: input.id,
      name: input.name,
      personaId: input.personaId ?? null,
      provider: input.provider,
      modelVariant: input.modelVariant,
      providerOptions: input.providerOptions ?? null,
      createdBy: input.createdBy,
      forkedFromId: input.forkedFromId ?? null,
      retired: false,
    }).returning();
    const personaRow = row.personaId
      ? await this.db.select().from(personas).where(eq(personas.id, row.personaId)).limit(1).then(r => r[0] ?? null)
      : null;
    return rowToAgent(row, personaRow);
  }

  async get(id: string): Promise<AgentWithPersona | null> {
    const rows = await this.db
      .select()
      .from(agents)
      .leftJoin(personas, eq(agents.personaId, personas.id))
      .where(eq(agents.id, id))
      .limit(1);
    if (!rows.length) return null;
    return rowToAgent(rows[0].agents, rows[0].personas ?? null);
  }

  async list(filters: {
    provider?: string;
    retired?: boolean;
    search?: string;
  }): Promise<{ agents: AgentWithPersona[] }> {
    const retired = filters.retired ?? false;
    const conditions = [eq(agents.retired, retired)];
    if (filters.provider) conditions.push(eq(agents.provider, filters.provider));
    if (filters.search) conditions.push(ilike(agents.name, `${filters.search}%`));

    const rows = await this.db
      .select()
      .from(agents)
      .leftJoin(personas, eq(agents.personaId, personas.id))
      .where(and(...conditions));

    return {
      agents: rows.map(row => rowToAgent(row.agents, row.personas ?? null)),
    };
  }

  async update(id: string, input: UpdateAgentInput): Promise<AgentWithPersona | null> {
    const [row] = await this.db.update(agents)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();
    if (!row) return null;
    const personaRow = row.personaId
      ? await this.db.select().from(personas).where(eq(personas.id, row.personaId)).limit(1).then(r => r[0] ?? null)
      : null;
    return rowToAgent(row, personaRow);
  }

  async retire(id: string): Promise<AgentWithPersona | null> {
    const [row] = await this.db.update(agents)
      .set({ retired: true, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();
    if (!row) return null;
    const personaRow = row.personaId
      ? await this.db.select().from(personas).where(eq(personas.id, row.personaId)).limit(1).then(r => r[0] ?? null)
      : null;
    return rowToAgent(row, personaRow);
  }

  async fork(id: string, overrides: { name: string; createdBy: string }): Promise<AgentWithPersona | null> {
    const source = await this.get(id);
    if (!source) return null;
    const newId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return this.create({
      id: newId,
      name: overrides.name,
      personaId: source.personaId,
      provider: source.provider as 'claude' | 'codex' | 'gemini',
      modelVariant: source.modelVariant,
      providerOptions: source.providerOptions,
      createdBy: overrides.createdBy,
      forkedFromId: id,
    });
  }

  async incrementStats(
    id: string,
    result: { won: boolean; score: number },
  ): Promise<void> {
    await this.db.update(agents).set({
      statsWins:       sql`${agents.statsWins} + ${result.won ? 1 : 0}`,
      statsLosses:     sql`${agents.statsLosses} + ${result.won ? 0 : 1}`,
      statsTotal:      sql`${agents.statsTotal} + 1`,
      statsAvgScore:   sql`CASE WHEN ${agents.statsTotal} = 0 THEN ${result.score}
                          ELSE (COALESCE(${agents.statsAvgScore}::numeric, 0) * ${agents.statsTotal} + ${result.score})
                               / (${agents.statsTotal} + 1::numeric) END`,
      statsLastUsedAt: new Date(),
      updatedAt:       new Date(),
    }).where(eq(agents.id, id));
  }

  async getByProviderAndPersonaName(
    provider: string,
    personaName: string,
  ): Promise<AgentWithPersona | null> {
    const rows = await this.db
      .select()
      .from(agents)
      .innerJoin(personas, eq(agents.personaId, personas.id))
      .where(
        and(
          eq(agents.provider, provider),
          eq(personas.name, personaName),
          eq(agents.retired, false),
        ),
      )
      .limit(1);
    if (!rows.length) return null;
    return rowToAgent(rows[0].agents, rows[0].personas);
  }
}
