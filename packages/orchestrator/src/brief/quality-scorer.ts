// ─── Brief quality scorer — pure heuristic, no LLM ──────────────────────────

export type IssueSeverity = 'error' | 'warning';

export interface QualityIssue {
  check: string;
  severity: IssueSeverity;
  message: string;
}

export interface QualityReport {
  overallScore: number;
  launchReady: boolean;
  issues: QualityIssue[];
  suggestions: string[];
}

/** Domains where 'code' deliverableType is inappropriate. */
const NON_CODE_DOMAINS = new Set(['business', 'research', 'creative', 'strategy', 'ideation']);

/** File extensions that count as "code" deliverables. */
const CODE_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.go', '.rs', '.java', '.cpp', '.c', '.cs',
  '.rb', '.sh', '.php', '.swift', '.kt', '.ex', '.exs', '.lua', '.r', '.pl',
]);

/**
 * Score brief quality using 7 heuristic checks (no LLM).
 *
 * Score starts at 1.0, deducts 0.2 per error, 0.1 per warning.
 * `launchReady` is true only when score >= 0.8 (no errors).
 */
export function scoreBriefQuality(brief: {
  problem: string;
  constraints: string[];
  deliverables: string[];
  rubric: { criteria: { id: string; description: string; weight: number; maxScore: number }[] };
  deliverableType?: string;
  domainHint?: string;
}): QualityReport {
  const issues: QualityIssue[] = [];
  const suggestions: string[] = [];

  // ── Check 1: criterion descriptions > 15 chars ──
  for (const c of brief.rubric.criteria) {
    if (c.description.length <= 15) {
      issues.push({
        check: 'criterion-descriptions',
        severity: 'error',
        message: `Criterion "${c.id}" has a placeholder description (${c.description.length} chars). Descriptions must be >15 characters.`,
      });
    }
  }

  // ── Check 2: constraints array non-empty ──
  if (!brief.constraints || brief.constraints.length === 0) {
    issues.push({
      check: 'constraints-present',
      severity: 'warning',
      message: 'Brief has no constraints. Constraints force design decisions and make competitions more interesting.',
    });
    suggestions.push('Add 2-3 constraints that force agents to make tradeoffs (e.g., time complexity limits, banned libraries, budget caps).');
  }

  // ── Check 3: deliverable filenames match deliverableType ──
  if (brief.deliverableType === 'code') {
    const hasCodeFile = brief.deliverables.some((d) => {
      const ext = d.slice(d.lastIndexOf('.'));
      return CODE_EXTENSIONS.has(ext.toLowerCase());
    });
    if (!hasCodeFile) {
      issues.push({
        check: 'deliverable-type-match',
        severity: 'warning',
        message: 'deliverableType is "code" but no deliverables have code file extensions.',
      });
      suggestions.push('Add at least one code file (e.g., solution.ts, main.py) or change deliverableType.');
    }
  }

  // ── Check 4: problem statement > 200 chars ──
  if (brief.problem.length <= 200) {
    issues.push({
      check: 'problem-length',
      severity: 'warning',
      message: `Problem statement is only ${brief.problem.length} chars. Aim for >200 characters with specific inputs, outputs, and success criteria.`,
    });
    suggestions.push('Expand the problem statement to describe inputs, outputs, edge cases, and what success looks like.');
  }

  // ── Check 5: weights sum to ~1.0 ──
  const weightSum = brief.rubric.criteria.reduce((sum, c) => sum + c.weight, 0);
  if (Math.abs(weightSum - 1.0) > 0.05) {
    issues.push({
      check: 'weights-sum',
      severity: 'error',
      message: `Criterion weights sum to ${weightSum.toFixed(3)}, expected ~1.0 (tolerance ±0.05).`,
    });
    suggestions.push('Adjust criterion weights so they sum to exactly 1.0.');
  }

  // ── Check 6: no duplicate criterion IDs ──
  const ids = new Set<string>();
  for (const c of brief.rubric.criteria) {
    if (ids.has(c.id)) {
      issues.push({
        check: 'duplicate-criteria',
        severity: 'error',
        message: `Duplicate criterion ID "${c.id}". Each criterion must have a unique ID.`,
      });
    }
    ids.add(c.id);
  }

  // ── Check 7: deliverableType not inappropriately 'code' for non-code domains ──
  if (
    brief.deliverableType === 'code' &&
    brief.domainHint &&
    NON_CODE_DOMAINS.has(brief.domainHint)
  ) {
    issues.push({
      check: 'deliverable-type-domain',
      severity: 'warning',
      message: `deliverableType is "code" but domain is "${brief.domainHint}". Consider "document", "analysis", or "plan" instead.`,
    });
    suggestions.push(`For ${brief.domainHint} briefs, deliverableType should typically be "document", "analysis", or "plan".`);
  }

  // ── Compute score ──
  let score = 1.0;
  for (const issue of issues) {
    score -= issue.severity === 'error' ? 0.2 : 0.1;
  }
  score = Math.max(0, score);

  return {
    overallScore: Math.round(score * 100) / 100,
    launchReady: score >= 0.8,
    issues,
    suggestions,
  };
}
