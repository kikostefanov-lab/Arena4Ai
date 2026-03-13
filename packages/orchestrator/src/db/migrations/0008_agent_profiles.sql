CREATE TABLE "agent_profiles" (
  "id"                 TEXT PRIMARY KEY,
  "name"               TEXT NOT NULL,
  "description"        TEXT,
  "provider"           TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini')),
  "model_variant"      TEXT NOT NULL,
  "system_prompt"      TEXT NOT NULL,
  "avatar"             TEXT,
  "tags"               JSONB,
  "retired"            BOOLEAN NOT NULL DEFAULT FALSE,
  "created_by"         TEXT NOT NULL,
  "forked_from_id"     TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
  "stats_wins"         INTEGER NOT NULL DEFAULT 0,
  "stats_losses"       INTEGER NOT NULL DEFAULT 0,
  "stats_total"        INTEGER NOT NULL DEFAULT 0,
  "stats_avg_score"    NUMERIC,
  "stats_last_used_at" TIMESTAMPTZ,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_profiles_provider ON agent_profiles(provider);
CREATE INDEX idx_agent_profiles_retired  ON agent_profiles(retired);
-- Enforce unique (provider, name) among active profiles for stats lookup
CREATE UNIQUE INDEX idx_agent_profiles_provider_name_active ON agent_profiles(provider, name) WHERE retired = FALSE;
