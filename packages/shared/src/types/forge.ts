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
  | 'hypothesis_backlog';

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
  content: string;         // markdown
  generatedAt: string;     // ISO 8601
  universal?: boolean;     // true for the 3 universal artifacts
}

export interface ForgeOutput {
  forgeModel: string;      // model that generated the artifacts
  artifacts: ForgeArtifact[];
  generatedAt: string;     // ISO 8601
  domain?: ForgeDomain;    // detected domain
  selectedTypes?: ForgeArtifactType[];  // which domain artifacts were selected
}
