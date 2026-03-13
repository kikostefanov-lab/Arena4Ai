import type { CompetitionState } from '../constants/states.js';
import type { CompetitionFormat } from '../constants/formats.js';

export interface Team {
  id: string;           // 'team-a' | 'team-b' | 'team-c' | 'team-d'
  model: string;        // 'claude:architect'
  persona: string;      // resolved system prompt
  agentId?: string;     // optional DB agent id (new UI path)
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
  /** Expected stdout for automated correctness scoring. If set, the scorer
   *  executes runnable deliverable files and compares output line-by-line. */
  expectedOutput?: string;
  /** Category tags for filtering and library display (e.g. ["Algorithms", "CLI"]) */
  tags?: string[];
  /** Controls agent prompt guidance and Forge domain selection.
   *  Absent on records persisted before this field was introduced; treat undefined as 'code'. */
  deliverableType?: 'code' | 'document' | 'analysis' | 'presentation' | 'plan' | 'mixed';
  /** Explicit Forge domain override. Once wired in forge-orchestrator, skips AI domain
   *  selection entirely. Parsed and stored; consumed by the Forge in Task 3. */
  domainHint?: 'software' | 'research' | 'creative' | 'security' | 'business' | 'ideation';
}

export interface Deliverable {
  teamId: string;
  files: Array<{ path: string; content: string }>;
  collectedAt: string; // ISO 8601
}

export interface Competition {
  id: string;
  brief: Brief;
  teams: Team[];
  state: CompetitionState;
  startedAt?: string;
  completedAt?: string;
}
