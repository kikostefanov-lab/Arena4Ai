import { CompetitionState, VALID_TRANSITIONS } from '@arena/shared';

/**
 * Pure state-transition function.
 *
 * Returns the next state if the transition is valid, otherwise throws.
 */
export function transition(from: CompetitionState, to: CompetitionState): CompetitionState {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid transition: ${from} → ${to}. Allowed next states: [${allowed.join(', ') || 'none'}]`,
    );
  }
  return to;
}
