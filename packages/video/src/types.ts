export interface ReelCriterionScore {
  name: string;        // display name from brief.rubric.criteria[].description
  score: number;       // 0–1
  commentary: string;
}

export interface ReelTeam {
  teamId: string;
  label: string;       // e.g. "claude:architect"
  model: string;       // e.g. "claude"
  persona: string;     // e.g. "architect"
  color: string;       // hex color for this model
  score: number;       // 0–1 total score
  criteriaScores: ReelCriterionScore[];
}

export interface ReelKeyMoment {
  relativeMs: number;  // ms from competition startedAt
  teamId: string;
  label: string;       // e.g. "Created fizzbuzz.py"
  type: 'FILE_CREATE' | 'TOOL_CALL' | 'ERROR';
}

/** Key event for BattleHighlights scene — maps to a gladiator animation */
export interface ReelKeyEvent {
  frameOffset: number;   // frame within the 180-frame BattleHighlights scene
  teamId: string;        // which gladiator reacts
  type: 'strike' | 'power' | 'hit';  // animation to trigger
}

export interface ReelData {
  competitionId: string;
  briefTitle: string;
  briefDescription: string;
  criteria: string[];              // display names in order
  teams: ReelTeam[];
  winnerId: string | null;
  keyMoments: ReelKeyMoment[];
  keyEvents: ReelKeyEvent[];
  synthesisQuote?: string;         // first sentence of synthesis, markdown stripped
  hasSynthesis: boolean;
  hasForge: boolean;
}
