export interface AgentPersonaSummary {
  id: string;
  name: string;
  avatar?: string | null;
  description?: string | null;
  systemPrompt: string;  // REQUIRED: used by competition-runner for persona resolution
}

export interface Agent {
  id: string;
  name: string;
  persona: AgentPersonaSummary | null;
  personaId: string | null;
  provider: 'claude' | 'codex' | 'gemini';
  modelVariant: string;
  providerOptions?: Record<string, unknown> | null;
  createdBy: string;
  forkedFromId?: string | null;
  retired: boolean;
  statsWins: number;
  statsLosses: number;
  statsTotal: number;
  statsAvgScore?: number | null;
  statsLastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
