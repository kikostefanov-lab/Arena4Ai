export type ForgeArtifactType =
  // Universal — always generated for every competition
  | 'executive_summary'
  | 'next_steps'
  | 'tool_recommendations'
  // Software development
  | 'roadmap'
  | 'task_graph'
  | 'repo_blueprint'
  | 'api_contracts'
  | 'risk_register'
  | 'decision_log'
  // Research / procurement
  | 'evaluation_matrix'
  | 'vendor_scorecard'
  | 'decision_framework'
  // Creative / communications
  | 'content_outline'
  | 'presentation_structure'
  | 'messaging_guide'
  // Security / adversarial
  | 'threat_model'
  | 'attack_surface'
  | 'remediation_plan'
  // Business / strategy
  | 'business_case'
  | 'go_to_market'
  | 'stakeholder_map'
  // Ideation / exploration
  | 'concept_canvas'
  | 'mvp_definition'
  | 'hypothesis_backlog'
  // Structured / domain-specific outputs (Sprint 1)
  | 'sql_schema'           // raw SQL schema for software domain
  | 'environment_template' // .env.example template for software domain
  | 'slide_deck'           // slide-by-slide outline with copy for creative domain
  | 'spreadsheet_export'   // CSV comparison matrix for research domain
  // Sprint 4 additions
  | 'dockerfile'
  | 'github_actions'
  | 'gantt_timeline'
  | 'reference_implementation'
  | 'test_suite_template'
  | 'project_readme';

export type ForgeOutputFormat =
  | 'markdown'
  | 'sql'
  | 'csv'
  | 'yaml'
  | 'json'
  | 'text'
  | 'dockerfile';

export type ForgeDomain =
  | 'software'
  | 'research'
  | 'creative'
  | 'security'
  | 'business'
  | 'ideation';

export interface ForgeArtifact {
  type: ForgeArtifactType;
  title: string;
  content: string;                   // artifact content (format determined by outputFormat)
  generatedAt: string;               // ISO 8601
  universal?: boolean;               // true for the 3 universal artifacts
  outputFormat: ForgeOutputFormat;   // format of the content field
  filename: string;                  // suggested filename for download (e.g. "roadmap.md")
}

export interface ForgeOutput {
  forgeModel: string;      // model that generated the artifacts
  artifacts: ForgeArtifact[];
  generatedAt: string;     // ISO 8601
  domain?: ForgeDomain;    // detected domain
  selectedTypes?: ForgeArtifactType[];  // which domain artifacts were selected
}

/** Source for a forge run — which team's work (or the synthesis) to base artifacts on. */
export type ForgeSource = 'winner' | 'loser' | 'synthesis';

/**
 * A single forge run. Multiple runs can exist per competition (stacked).
 * Replaces the single ForgeOutput stored in results.forge.
 */
export interface ForgeRun {
  id: string;                        // uuid generated at run time
  source: ForgeSource;
  sourceTeamId?: string;             // set when source is 'winner' or 'loser'
  forgeModel: string;
  artifacts: ForgeArtifact[];
  generatedAt: string;               // ISO 8601
  domain?: ForgeDomain;
  selectedTypes?: ForgeArtifactType[];
}
