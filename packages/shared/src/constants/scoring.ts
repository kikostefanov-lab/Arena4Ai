/** Brief tag marking a competition seeded by dev/seed-squad-demo.ts. Never a real result. */
export const SYNTHETIC_DEMO_TAG = 'synthetic-demo';

/** True for a stored competition whose brief carries the synthetic-demo tag. */
export function isSyntheticCompetition(comp: { brief?: unknown }): boolean {
  const tags = (comp.brief as { tags?: unknown } | null | undefined)?.tags;
  return Array.isArray(tags) && tags.includes(SYNTHETIC_DEMO_TAG);
}

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

/** One judge's line in a team's per-judge breakdown. */
export interface JudgeBreakdownRow {
  judgeId: string;
  provider: string;
  model: string;
  /** The judge's overall score in [0, 1]; null when it failed and was dropped. */
  overallScore: number | null;
  /** Failure kind of a dropped panel judge ('auth', 'timeout'...). */
  failure?: string;
}

export interface JudgeBreakdown {
  /** 'Cross-vendor panel' for a panel match; 'Judges' for another multi-judge one (adversarial). */
  label: 'Cross-vendor panel' | 'Judges';
  rows: JudgeBreakdownRow[];
  /** Mean of the judges that scored; null when none did. */
  average: number | null;
}

type StoredJudgeResult = { judgeId?: string; overallScore?: number; provider?: string; model?: string; heuristic?: boolean };
type StoredPanelSeat = { provider: string; model: string; judgeId: string; failure?: string };

/** `ai-<provider>/<model>[+adversarial]`, the panel's self-describing judge id. */
const PANEL_JUDGE_ID = /^ai-(claude|codex|gemini)\/(.+?)(\+adversarial)?$/;

/**
 * Per-judge rows for a scorecard judged by more than one AI judge, or by the
 * cross-vendor panel (whose dropped judges are listed too), for the Scores tab.
 * Null for a single-judge or heuristic-only scorecard: nothing to break down.
 */
export function judgeBreakdown(scorecard: {
  judgeResults?: ReadonlyArray<StoredJudgeResult> | null;
  judgePanel?: ReadonlyArray<StoredPanelSeat> | null;
}): JudgeBreakdown | null {
  const ai = (scorecard.judgeResults ?? []).filter(
    (r) => r.heuristic !== true && r.judgeId !== AUTOMATED_JUDGE_ID && typeof r.overallScore === 'number',
  );
  const describe = (r: StoredJudgeResult): JudgeBreakdownRow => {
    const parsed = PANEL_JUDGE_ID.exec(r.judgeId ?? '');
    return {
      judgeId: r.judgeId ?? '',
      provider: r.provider ?? parsed?.[1] ?? 'claude',
      model: r.model ?? parsed?.[2] ?? '',
      overallScore: r.overallScore ?? null,
    };
  };

  let label: JudgeBreakdown['label'];
  let rows: JudgeBreakdownRow[];
  if (scorecard.judgePanel && scorecard.judgePanel.length > 0) {
    label = 'Cross-vendor panel';
    rows = scorecard.judgePanel.map((seat) => {
      const result = seat.failure ? undefined : ai.find((r) => r.judgeId === seat.judgeId);
      return {
        judgeId: seat.judgeId,
        provider: seat.provider,
        model: seat.model,
        overallScore: result?.overallScore ?? null,
        ...(seat.failure ? { failure: seat.failure } : {}),
      };
    });
  } else if (ai.length > 1) {
    label = 'Judges';
    rows = ai.map(describe);
  } else {
    return null;
  }

  const scored = rows.map((r) => r.overallScore).filter((s): s is number => s !== null);
  const average = scored.length > 0 ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
  return { label, rows, average };
}
