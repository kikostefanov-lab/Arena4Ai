CREATE TABLE "competitions" (
	"id" text PRIMARY KEY NOT NULL,
	"brief" jsonb NOT NULL,
	"teams" jsonb NOT NULL,
	"state" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_id" text NOT NULL,
	"team_id" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"metadata" jsonb,
	"seq" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "results" (
	"competition_id" text PRIMARY KEY NOT NULL,
	"scorecards" jsonb NOT NULL,
	"winner_id" text,
	"summary" text
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_competition_id_idx" ON "events" USING btree ("competition_id");