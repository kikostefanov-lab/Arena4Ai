ALTER TABLE "results" ADD COLUMN IF NOT EXISTS "presentations" jsonb;
ALTER TABLE "results" ADD COLUMN IF NOT EXISTS "forge" jsonb;
