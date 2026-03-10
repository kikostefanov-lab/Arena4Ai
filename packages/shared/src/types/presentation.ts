export interface CriterionFinding {
  criterionId: string;
  finding: string;        // 2-3 sentences: what did this team produce for this criterion?
  strength: string;       // 1 sentence: what's strong about their approach?
  gap: string;            // 1 sentence: what's missing or weak? (empty string if nothing)
}

export interface TeamPresentation {
  teamId: string;
  model: string;                          // e.g. "codex:defender"
  approach: string;                       // 1-2 sentence summary of overall approach
  criterionFindings: CriterionFinding[];  // one per rubric criterion
  keyInsight: string;                     // the single most important insight
  deliverableSummary: string;             // plain-English summary of files produced
}
