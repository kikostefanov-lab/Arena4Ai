export interface Persona {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  avatar?: string;
  tags?: string[];
  createdBy: string;
  retired: boolean;
  agentCount: number;
  createdAt: string;
  updatedAt: string;
}
