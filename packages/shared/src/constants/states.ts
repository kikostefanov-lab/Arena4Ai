export enum CompetitionState {
  DRAFT = 'DRAFT',
  CONFIGURED = 'CONFIGURED',
  LAUNCHING = 'LAUNCHING',
  RUNNING = 'RUNNING',
  TIME_UP = 'TIME_UP',
  COLLECTING = 'COLLECTING',
  PRESENTING = 'PRESENTING',
  JUDGING = 'JUDGING',
  SCORED = 'SCORED',
  SYNTHESIZING = 'SYNTHESIZING',
  COMPLETE = 'COMPLETE',
  FORGING = 'FORGING',
  FORGE_COMPLETE = 'FORGE_COMPLETE',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Terminal states — no further transitions are valid. */
export const TERMINAL_STATES = new Set([
  CompetitionState.COMPLETE,
  CompetitionState.FORGE_COMPLETE,
  CompetitionState.FAILED,
  CompetitionState.CANCELLED,
]);

export const VALID_TRANSITIONS: Record<CompetitionState, CompetitionState[]> = {
  [CompetitionState.DRAFT]: [CompetitionState.CONFIGURED],
  [CompetitionState.CONFIGURED]: [CompetitionState.LAUNCHING],
  [CompetitionState.LAUNCHING]: [CompetitionState.RUNNING, CompetitionState.FAILED],
  [CompetitionState.RUNNING]: [CompetitionState.TIME_UP, CompetitionState.FAILED, CompetitionState.CANCELLED],
  [CompetitionState.TIME_UP]: [CompetitionState.COLLECTING],
  [CompetitionState.COLLECTING]: [CompetitionState.PRESENTING],
  [CompetitionState.PRESENTING]: [CompetitionState.JUDGING, CompetitionState.FAILED],
  [CompetitionState.JUDGING]: [CompetitionState.SCORED, CompetitionState.FAILED],
  [CompetitionState.SCORED]: [CompetitionState.COMPLETE, CompetitionState.SYNTHESIZING],
  [CompetitionState.SYNTHESIZING]: [CompetitionState.COMPLETE],
  [CompetitionState.COMPLETE]: [CompetitionState.FORGING],
  [CompetitionState.FORGING]: [CompetitionState.FORGE_COMPLETE, CompetitionState.FAILED],
  [CompetitionState.FORGE_COMPLETE]: [],
  [CompetitionState.FAILED]: [],
  [CompetitionState.CANCELLED]: [],
};
