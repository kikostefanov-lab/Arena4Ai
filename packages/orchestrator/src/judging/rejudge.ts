import type { Brief, Deliverable, ScoreCard } from '@arena/shared';
import { aiJudge, JUDGE_IDS } from './ai-judge.js';
import type { AiJudgeFailure } from './ai-judge.js';
import { aggregate } from './score-aggregator.js';
import { resolveOutcome } from './outcome.js';

export interface RejudgeOptions {
  /** Also run the adversarial judge and average both. */
  adversarial: boolean;
  /** Injectable for tests; defaults to the real AI judge. */
  judge?: typeof aiJudge;
}

export interface RejudgeFailure extends AiJudgeFailure {
  teamId: string;
  judgeId: string;
}

export type RejudgeResult =
  | { ok: true; scorecards: ScoreCard[]; winnerId: string | null; tiedTeamIds: string[] }
  | { ok: false; failures: RejudgeFailure[]; message: string };

/**
 * Re-run the AI judge over stored deliverables. Shared by the re-judge route and
 * the `re-evaluate` CLI so both rank and break ties exactly like a normal run.
 *
 * If ANY judge reports `failure` the whole re-judge is refused and nothing is
 * returned to persist: zero scores from a failed judge must never replace valid
 * stored results. Failure is read off the explicit `failure` field only.
 */
export async function rejudge(
  brief: Brief,
  deliverables: Deliverable[],
  options: RejudgeOptions,
): Promise<RejudgeResult> {
  const judge = options.judge ?? aiJudge;
  const judgeIds = [JUDGE_IDS.aiClaude, ...(options.adversarial ? [JUDGE_IDS.aiAdversarial] : [])];

  const results = await Promise.all(
    judgeIds.flatMap((judgeId) => deliverables.map((d) => judge(brief, d, brief.rubric, { judgeId }))),
  );

  const failures: RejudgeFailure[] = results
    .filter((r) => r.failure)
    .map((r) => ({ ...r.failure!, teamId: r.teamId, judgeId: r.judgeId }));
  if (failures.length > 0) {
    const reasons = [...new Set(failures.map((f) => `${f.teamId}/${f.judgeId}: ${f.message}`))];
    return {
      ok: false,
      failures,
      message: `Re-judge failed; existing results were not changed. ${reasons.join(' | ')}`,
    };
  }

  const scorecards = aggregate(results);
  return { ok: true, scorecards, ...resolveOutcome(scorecards) };
}
