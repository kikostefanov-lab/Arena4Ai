import type { CompetitionState } from '../constants/states.js';
import type { CompetitionFormat } from '../constants/formats.js';

export interface Team {
  id: string;           // 'team-a' | 'team-b'
  model: string;        // 'claude:architect'
  persona: string;      // resolved system prompt
}

export interface RubricCriterion {
  id: string;
  description: string;
  weight: number;       // 0–1, all criteria weights must sum to 1
  maxScore: number;     // typically 10
}

export interface Rubric {
  criteria: RubricCriterion[];
}

export interface Brief {
  id: string;
  title: string;
  problem: string;
  constraints: string[];
  deliverables: string[];
  rubric: Rubric;
  format: CompetitionFormat;
  timeLimitMs: number;
}

export interface Deliverable {
  teamId: string;
  files: Array<{ path: string; content: string }>;
  collectedAt: string; // ISO 8601
}

export interface Competition {
  id: string;
  brief: Brief;
  teams: [Team, Team];
  state: CompetitionState;
  startedAt?: string;
  completedAt?: string;
}
