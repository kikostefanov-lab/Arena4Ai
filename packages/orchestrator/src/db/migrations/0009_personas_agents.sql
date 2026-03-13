-- Step 1: Create personas table
CREATE TABLE IF NOT EXISTS personas (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  system_prompt TEXT NOT NULL,
  avatar        TEXT,
  tags          JSONB,
  created_by    TEXT NOT NULL DEFAULT 'system',
  retired       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS personas_name_active_unique ON personas (name) WHERE retired = FALSE;

-- Step 2: Seed the 9 system personas (idempotent)
INSERT INTO personas (id, name, description, system_prompt, avatar, tags, created_by) VALUES
  ('persona-architect',   'architect',       'Systems-first thinker focused on long-term quality',
   'You are The Architect: methodical, structured, focused on long-term quality and clean design patterns. You write complete, production-ready solutions.',
   '🏗️', '["thorough","design"]', 'system'),
  ('persona-speedrunner', 'speedrunner',     'Ruthlessly efficient minimal-solution shipper',
   'You are The Speedrunner: ruthlessly efficient, shipping the minimal working solution first. You optimize for time-to-completion above all.',
   '⚡', '["fast","minimal"]', 'system'),
  ('persona-pragmatist',  'pragmatist',      'Balances speed and quality with proven patterns',
   'You are The Pragmatist: balancing speed and quality, choosing proven patterns, avoiding over-engineering. You deliver working solutions fast.',
   '🔧', '["practical","balanced"]', 'system'),
  ('persona-researcher',  'researcher',      'Deep analyst who explores before committing',
   'You are The Researcher: deep analysis, comprehensive documentation, exploring edge cases and trade-offs before committing to an approach.',
   '🔬', '["thorough","analysis"]', 'system'),
  ('persona-adversarial', 'adversarial',     'Red-team attacker finding weaknesses and vulnerabilities',
   'You are The Adversarial: focused on breaking assumptions, finding vulnerabilities, writing adversarial tests, and hardening implementations.',
   '⚔️', '["security","testing"]', 'system'),
  ('persona-defender',    'defender',        'Blue-team hardener focused on robustness and security',
   'You are The Defender: prioritizing robustness, error handling, security, and defensive programming patterns in every solution.',
   '🛡️', '["security","quality"]', 'system'),
  ('persona-pioneer',     'pioneer',         'Creative first-mover exploring unconventional approaches',
   'You are The Pioneer: exploring unconventional approaches, experimenting with creative solutions, pushing boundaries while staying practical.',
   '🚀', '["creative","innovative"]', 'system'),
  ('persona-standard',          'standard',         'General-purpose Codex coding agent',
   'You are a Codex coding agent. Write clean, efficient code to solve the given problem.',
   '💻', '["coding"]', 'system'),
  ('persona-standard-gemini',   'standard-gemini',  'General-purpose Gemini agent',
   'You are a Gemini agent. Approach the problem creatively and deliver a comprehensive solution.',
   '✨', '["versatile"]', 'system')
ON CONFLICT (id) DO NOTHING;

-- Step 3: Create agents table
CREATE TABLE IF NOT EXISTS agents (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  persona_id        TEXT REFERENCES personas(id) ON DELETE SET NULL,
  provider          TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini')),
  model_variant     TEXT NOT NULL,
  provider_options  JSONB,
  created_by        TEXT NOT NULL,
  forked_from_id    TEXT,
  retired           BOOLEAN NOT NULL DEFAULT FALSE,
  stats_wins        INTEGER NOT NULL DEFAULT 0,
  stats_losses      INTEGER NOT NULL DEFAULT 0,
  stats_total       INTEGER NOT NULL DEFAULT 0,
  stats_avg_score   NUMERIC,
  stats_last_used_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_provider_name_active_unique ON agents (provider, name) WHERE retired = FALSE;
CREATE INDEX IF NOT EXISTS agents_provider_idx   ON agents (provider);
CREATE INDEX IF NOT EXISTS agents_persona_id_idx ON agents (persona_id);

-- Step 4: Migrate agent_profiles → agents (only if agent_profiles exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'agent_profiles') THEN
    INSERT INTO agents (
      id, name, persona_id, provider, model_variant,
      created_by, forked_from_id, retired,
      stats_wins, stats_losses, stats_total,
      stats_avg_score, stats_last_used_at,
      created_at, updated_at
    )
    SELECT
      ap.id,
      ap.name,
      p.id AS persona_id,
      ap.provider,
      ap.model_variant,
      ap.created_by,
      ap.forked_from_id,
      ap.retired,
      ap.stats_wins,
      ap.stats_losses,
      ap.stats_total,
      ap.stats_avg_score,
      ap.stats_last_used_at,
      ap.created_at,
      ap.updated_at
    FROM agent_profiles ap
    LEFT JOIN personas p ON p.name = ap.name AND p.retired = FALSE
    ON CONFLICT (id) DO NOTHING;

    -- Step 5: Drop agent_profiles
    DROP TABLE agent_profiles;
  END IF;
END $$;
