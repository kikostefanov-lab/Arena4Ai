CREATE SEQUENCE events_seq_seq;
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "seq" SET DEFAULT nextval('events_seq_seq');
--> statement-breakpoint
ALTER SEQUENCE events_seq_seq OWNED BY events.seq;
