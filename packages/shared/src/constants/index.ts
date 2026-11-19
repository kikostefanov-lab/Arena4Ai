export { CompetitionState, VALID_TRANSITIONS, FINISHED_STATES, isFinishedState } from './states.js';
export { CompetitionFormat } from './formats.js';
export { EventType } from './event-types.js';
export { CLI_DEFAULT_MODEL, isCliDefaultModel, formatModelVariant } from './models.js';
export { AUTOMATED_JUDGE_ID, HEURISTIC_CEILING, SYNTHETIC_DEMO_TAG, isSyntheticCompetition, expectedFileName, isHeuristicScore, judgeBreakdown, teamCriterionScores } from './scoring.js';
export type { JudgeBreakdown, JudgeBreakdownRow, TeamCriterionScore } from './scoring.js';
