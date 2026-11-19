/** Highest share of a criterion's maxScore the completeness heuristic can award. */
export const HEURISTIC_CEILING = 0.5;

/** A leading token that looks like a file name: `README.md`, `src/cli.ts`, `scorer.py`. */
const FILENAME_TOKEN = /^`?((?:[\w.-]+\/)*[\w-][\w.-]*\.[A-Za-z][A-Za-z0-9]{0,7})`?(?=$|[\s,:;(—–-])/;

/**
 * The file name a brief deliverable names, or null when the entry only describes
 * one ("A runnable solution file (any language)") and so cannot be checked.
 */
export function expectedFileName(entry: string): string | null {
  const match = FILENAME_TOKEN.exec(entry.trim());
  return match ? match[1].replace(/^\.?\//, '') : null;
}

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
