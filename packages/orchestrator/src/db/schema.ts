import { pgTable, text, jsonb, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const competitions = pgTable('competitions', {
  id:          text('id').primaryKey(),
  brief:       jsonb('brief').notNull(),
  teams:       jsonb('teams').notNull(),
  state:       text('state').notNull(),
  startedAt:   timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const events = pgTable('events', {
  id:            text('id').primaryKey(),
  competitionId: text('competition_id').notNull().references(() => competitions.id),
  teamId:        text('team_id').notNull(),
  timestamp:     timestamp('timestamp', { withTimezone: true }).notNull(),
  type:          text('type').notNull(),
  payload:       jsonb('payload'),
  metadata:      jsonb('metadata'),
  seq:           integer('seq').notNull(),
}, (t) => [
  index('events_competition_id_idx').on(t.competitionId),
  uniqueIndex('events_competition_seq_uidx').on(t.competitionId, t.seq),
]);

export const results = pgTable('results', {
  competitionId: text('competition_id').primaryKey().references(() => competitions.id),
  scorecards:    jsonb('scorecards').notNull(),
  winnerId:      text('winner_id'),
  summary:       text('summary'),
});
