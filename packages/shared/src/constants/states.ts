export enum CompetitionState {
  DRAFT = 'DRAFT',
  CONFIGURED = 'CONFIGURED',
  LAUNCHING = 'LAUNCHING',
  RUNNING = 'RUNNING',
  TIME_UP = 'TIME_UP',
  COLLECTING = 'COLLECTING',
  JUDGING = 'JUDGING',
  SCORED = 'SCORED',
  SYNTHESIZING = 'SYNTHESIZING',   // NEW
  COMPLETE = 'COMPLETE',
}

export const VALID_TRANSITIONS: Record<CompetitionState, CompetitionState[]> = {
  [CompetitionState.DRAFT]: [CompetitionState.CONFIGURED],
  [CompetitionState.CONFIGURED]: [CompetitionState.LAUNCHING],
  [CompetitionState.LAUNCHING]: [CompetitionState.RUNNING],
  [CompetitionState.RUNNING]: [CompetitionState.TIME_UP],
  [CompetitionState.TIME_UP]: [CompetitionState.COLLECTING],
  [CompetitionState.COLLECTING]: [CompetitionState.JUDGING],
  [CompetitionState.JUDGING]: [CompetitionState.SCORED],
  [CompetitionState.SCORED]: [CompetitionState.SYNTHESIZING],   // changed
  [CompetitionState.SYNTHESIZING]: [CompetitionState.COMPLETE], // NEW
  [CompetitionState.COMPLETE]: [],
};
