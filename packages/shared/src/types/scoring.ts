export interface CriterionScore {
  criterionId: string;
  score: number;
  commentary: string;
}

export interface JudgeResult {
  judgeId: string;        // 'automated' | 'ai-claude-<model>'
  teamId: string;
  scores: CriterionScore[];
  overallScore: number;   // weighted sum
  /**
   * Set by the automated fallback scorer (`rubric-scorer.ts`), which runs when
   * the AI judge fails. It checks completeness against the brief's named
   * deliverables and cannot assess quality, so its scores are capped. The UI
   * labels these results; branch on this flag, never on the score values.
   */
  heuristic?: boolean;
}

/**
 * One seat of the cross-vendor judge panel (Claude, Codex and Gemini each judge
 * every team). Recorded per team so a reader can see which judges the
 * team's finalScore averages, and which dropped out and why.
 */
export interface JudgePanelSeat {
  provider: 'claude' | 'codex' | 'gemini';
  /** Model the judge ran on (the CLI's own report when it ran on its default). */
  model: string;
  judgeId: string;
  /** Present iff this judge failed and is not in `judgeResults`. Failure kind, e.g. 'auth', 'timeout'. */
  failure?: string;
}

export interface ScoreCard {
  teamId: string;
  judgeResults: JudgeResult[];
  /**
   * Set when the match was judged by the cross-vendor panel. `judgeResults`
   * then holds the judges that succeeded, and `finalScore` is their mean; when
   * every seat failed it holds the automated fallback instead.
   */
  judgePanel?: JudgePanelSeat[];
  finalScore: number;     // aggregated across judges
  rank: number;           // 1 = winner
  /**
   * Set when the team's agent CLI crashed before producing any files (bad model
   * id, expired login, rate limit). The team was not judged: finalScore 0 and
   * last rank mean "did not compete", not "lost on merit".
   */
  agentFailure?: { message: string; exitCode: number };
}
