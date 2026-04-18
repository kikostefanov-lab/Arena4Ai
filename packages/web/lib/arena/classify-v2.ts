import type { FlashPose, BasePose } from './types';

/**
 * V2 event classifier — simple map from competition event type to gladiator
 * flash/base pose. Mirrors the prototype's EVENT_TYPES table.
 *
 * Returns null for events that should not trigger choreography
 * (COMMENTARY, STATE_CHANGE, etc).
 */
export interface Choreography {
  flash?: FlashPose;
  basePose?: BasePose;
}

export function classifyEventV2(type: string): Choreography | null {
  switch (type) {
    case 'REASONING':
      return { basePose: 'thinking' };
    case 'FILE_CREATE':
    case 'FILE_MODIFY':
      return { flash: 'strike' };
    case 'TOOL_CALL':
      return { flash: 'power' };
    case 'ERROR':
      return { flash: 'hit' };
    default:
      return null;
  }
}

/**
 * Map a competition's state to an arena phase.
 * Replaces the prototype's time-normalized phase machine.
 */
export function stateToPhase(state: string): 'active' | 'freeze' | 'judging' | 'reveal' {
  switch (state) {
    case 'RUNNING':
    case 'LAUNCHING':
      return 'active';
    case 'TIME_UP':
    case 'COLLECTING':
    case 'PRESENTING':
      return 'freeze';
    case 'JUDGING':
      return 'judging';
    case 'SCORED':
    case 'COMPLETE':
    case 'FORGING':
    case 'FORGE_COMPLETE':
      return 'reveal';
    default:
      return 'active';
  }
}
