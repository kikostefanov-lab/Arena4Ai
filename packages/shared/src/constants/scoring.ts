/** Highest share of a criterion's maxScore the completeness heuristic can award. */
export const HEURISTIC_CEILING = 0.5;

/** Judge id the automated fallback scorer (`rubric-scorer.ts`) reports under. */
export const AUTOMATED_JUDGE_ID = 'automated';

/**
 * True when a team's score came from the automated fallback scorer rather than
 * an AI judge. That scorer only checks completeness against the brief's named
 * deliverables (capped, quality not assessed), so the UI must label it.
 *
 * Reads the explicit `heuristic` flag, or the `automated` judge id for results
 * stored before the flag existed. Never infer this from the score values.
 */
export function isHeuristicScore(
  judgeResults: ReadonlyArray<{ judgeId?: string; heuristic?: boolean }> | null | undefined,
): boolean {
  return (judgeResults ?? []).some((r) => r.heuristic === true || r.judgeId === AUTOMATED_JUDGE_ID);
}
