export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  provider: 'claude' | 'codex' | 'gemini';
  modelVariant: string;
  systemPrompt: string;
  avatar?: string;
  tags?: string[];
  retired: boolean;
  createdBy: string;
  forkedFromId?: string;
  statsWins: number;
  statsLosses: number;
  statsTotal: number;
  statsAvgScore?: number;
  statsLastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}
