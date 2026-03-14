-- 0010_brief_pipeline.sql
-- Sprint 5: Brief Pipeline Overhaul

CREATE TABLE IF NOT EXISTS results_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stage TEXT NOT NULL,
  previous_results JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_history_competition ON results_history(competition_id);

CREATE TABLE IF NOT EXISTS brief_quality_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score_spread NUMERIC,
  tied BOOLEAN,
  all_eights BOOLEAN,
  criterion_signals JSONB,
  judge_referenced_problem BOOLEAN,
  judge_referenced_constraints BOOLEAN,
  judge_referenced_deliverables BOOLEAN,
  expected_files_produced JSONB,
  total_files_produced INTEGER,
  total_content_size INTEGER,
  forge_domain_matched BOOLEAN,
  forge_artifacts_downloaded INTEGER DEFAULT 0,
  brief_was_ai_generated BOOLEAN,
  brief_edit_distance INTEGER,
  competition_rerun BOOLEAN,
  synthesis_triggered BOOLEAN,
  synthesis_meaningful BOOLEAN,
  UNIQUE(competition_id)
);
CREATE INDEX IF NOT EXISTS idx_quality_signals_competition ON brief_quality_signals(competition_id);

CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brief JSONB NOT NULL,
  source TEXT NOT NULL,
  quality_score NUMERIC,
  tags TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
