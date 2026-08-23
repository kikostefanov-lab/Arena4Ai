import { pgTable, text, jsonb, timestamp, serial, index, uniqueIndex, boolean, integer, numeric, uuid, check, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
  // Built by migration 0009. Declared here so it is visible to a human reading
  // the schema — adding a provider means widening this list AND the DB check.
  check('agents_provider_check', sql`provider IN ('claude', 'codex', 'gemini')`),
]);


export const resultsHistory = pgTable('results_history', {
  id:              uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  competitionId:   text('competition_id').notNull().references(() => competitions.id),
  archivedAt:      timestamp('archived_at', { withTimezone: true }).notNull().defaultNow(),
  stage:           text('stage').notNull(),
  previousResults: jsonb('previous_results').notNull(),
}, (t) => [
  index('idx_results_history_competition').on(t.competitionId),
]);

export const briefQualitySignals = pgTable('brief_quality_signals', {
  id:                          uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  competitionId:               text('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  computedAt:                  timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  scoreSpread:                 numeric('score_spread'),
  tied:                        boolean('tied'),
  allEights:                   boolean('all_eights'),
  criterionSignals:            jsonb('criterion_signals'),
  judgeReferencedProblem:      boolean('judge_referenced_problem'),
  judgeReferencedConstraints:  boolean('judge_referenced_constraints'),
  judgeReferencedDeliverables: boolean('judge_referenced_deliverables'),
  expectedFilesProduced:       jsonb('expected_files_produced'),
  totalFilesProduced:          integer('total_files_produced'),
  totalContentSize:            integer('total_content_size'),
  forgeDomainMatched:          boolean('forge_domain_matched'),
  forgeArtifactsDownloaded:    integer('forge_artifacts_downloaded').default(0),
  briefWasAiGenerated:         boolean('brief_was_ai_generated'),
  briefEditDistance:            integer('brief_edit_distance'),
  competitionRerun:            boolean('competition_rerun'),
  synthesisTriggered:          boolean('synthesis_triggered'),
  synthesisMeaningful:         boolean('synthesis_meaningful'),
}, (t) => [
  // Migration 0010 built a UNIQUE *constraint* (Postgres auto-named it
  // brief_quality_signals_competition_id_key) plus a separate plain index.
  // Mirrored verbatim — reality, not preference.
  unique('brief_quality_signals_competition_id_key').on(t.competitionId),
  index('idx_quality_signals_competition').on(t.competitionId),
]);

export const briefs = pgTable('briefs', {
  id:           text('id').primaryKey(),
  title:        text('title').notNull(),
  brief:        jsonb('brief').notNull(),
  source:       text('source').notNull(),
  qualityScore: numeric('quality_score'),
  tags:         jsonb('tags').$type<string[]>(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
