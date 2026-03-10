export type ForgeArtifactType =
  | 'roadmap'
  | 'task_graph'
  | 'repo_blueprint'
  | 'api_contracts'
  | 'risk_register'
  | 'decision_log';

export interface ForgeArtifact {
  type: ForgeArtifactType;
  title: string;
  content: string;         // markdown
  generatedAt: string;     // ISO 8601
}

export interface ForgeOutput {
  forgeModel: string;      // model that generated the artifacts
  artifacts: ForgeArtifact[];
  generatedAt: string;     // ISO 8601
}
