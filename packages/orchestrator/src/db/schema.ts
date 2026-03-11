import { pgTable, text, jsonb, timestamp, serial, index, uniqueIndex } from 'drizzle-orm/pg-core';
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
