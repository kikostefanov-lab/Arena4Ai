import { pgTable, text, jsonb, timestamp, serial, index, uniqueIndex, boolean, integer, numeric } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { TeamPresentation, ForgeRun } from '@arena/shared';
import type { ForgeOutput } from '@arena/shared';

export const competitions = pgTable('competitions', {
  id:          text('id').primaryKey(),
  brief:       jsonb('brief').notNull(),
  teams:       jsonb('teams').notNull(),
  state:       text('state').notNull(),
  startedAt:   timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  notes:       text('notes'),
});

export const events = pgTable('events', {
  id:            text('id').primaryKey(),
  competitionId: text('competition_id').notNull().references(() => competitions.id),
  teamId:        text('team_id').notNull(),
  timestamp:     timestamp('timestamp', { withTimezone: true }).notNull(),
  type:          text('type').notNull(),
  payload:       jsonb('payload'),
  metadata:      jsonb('metadata'),
  seq:           serial('seq').notNull(),
}, (t) => [
  index('events_competition_id_idx').on(t.competitionId),
  uniqueIndex('events_competition_seq_uidx').on(t.competitionId, t.seq),
]);

export interface TeamDeliverable {
  teamId: string;
  files: { path: string; content: string }[];
}

export const results = pgTable('results', {
  competitionId:  text('competition_id').primaryKey().references(() => competitions.id),
  scorecards:     jsonb('scorecards').notNull(),
  winnerId:       text('winner_id'),
  summary:        text('summary'),
  synthesis:      text('synthesis'),
  presentations:  jsonb('presentations').$type<TeamPresentation[]>(),
  forge:          jsonb('forge').$type<ForgeRun[] | ForgeOutput>(),
  deliverables:   jsonb('deliverables').$type<TeamDeliverable[]>(),
});

export const tournaments = pgTable('tournaments', {
  id:          text('id').primaryKey(),
  name:        text('name').notNull(),
  brief:       jsonb('brief').notNull(),
  teams:       jsonb('teams').notNull(),
  type:        text('type').notNull().default('ROUND_ROBIN'),
  state:       text('state').notNull().default('PENDING'),
  matchIds:    jsonb('match_ids').notNull().default([]),
  rankings:    jsonb('rankings'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const personas = pgTable('personas', {
  id:           text('id').primaryKey(),
  name:         text('name').notNull(),
  description:  text('description'),
  systemPrompt: text('system_prompt').notNull(),
  avatar:       text('avatar'),
  tags:         jsonb('tags').$type<string[]>(),
  createdBy:    text('created_by').notNull().default('system'),
  retired:      boolean('retired').notNull().default(false),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('personas_name_active_unique').on(table.name).where(sql`retired = false`),
]);

export const agents = pgTable('agents', {
  id:               text('id').primaryKey(),
  name:             text('name').notNull(),
  personaId:        text('persona_id').references(() => personas.id, { onDelete: 'set null' }),
  provider:         text('provider').notNull(),
  modelVariant:     text('model_variant').notNull(),
  providerOptions:  jsonb('provider_options'),
  createdBy:        text('created_by').notNull(),
  forkedFromId:     text('forked_from_id'),
  retired:          boolean('retired').notNull().default(false),
  statsWins:        integer('stats_wins').notNull().default(0),
  statsLosses:      integer('stats_losses').notNull().default(0),
  statsTotal:       integer('stats_total').notNull().default(0),
  statsAvgScore:    numeric('stats_avg_score'),
  statsLastUsedAt:  timestamp('stats_last_used_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('agents_provider_name_active_unique').on(table.provider, table.name).where(sql`retired = false`),
  index('agents_provider_idx').on(table.provider),
  index('agents_persona_id_idx').on(table.personaId),
]);

export const agentProfiles = pgTable('agent_profiles', {
  id:               text('id').primaryKey(),
  name:             text('name').notNull(),
  description:      text('description'),
  provider:         text('provider').notNull(),
  modelVariant:     text('model_variant').notNull(),
  systemPrompt:     text('system_prompt').notNull(),
  avatar:           text('avatar'),
  tags:             jsonb('tags').$type<string[]>(),
  retired:          boolean('retired').default(false).notNull(),
  createdBy:        text('created_by').notNull(),
  forkedFromId:     text('forked_from_id').references((): AnyPgColumn => agentProfiles.id, { onDelete: 'set null' }),
  statsWins:        integer('stats_wins').default(0).notNull(),
  statsLosses:      integer('stats_losses').default(0).notNull(),
  statsTotal:       integer('stats_total').default(0).notNull(),
  statsAvgScore:    numeric('stats_avg_score'),
  statsLastUsedAt:  timestamp('stats_last_used_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
