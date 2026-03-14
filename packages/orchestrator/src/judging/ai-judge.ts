import { spawn } from 'node:child_process';
import type { Brief, Rubric, Deliverable, JudgeResult, CriterionScore } from '@arena/shared';
import { claudeEnv } from '../utils/claude-env.js';
import { computeOverallScore } from './score-aggregator.js';
import { extractJson } from '../utils/extract-json.js';
import { buildBriefContext, truncateFiles, JUDGE_CONTEXT } from '../utils/brief-context.js';

export const JUDGE_IDS = {
  automated: 'automated',
  aiClaude: 'ai-claude',
  aiAdversarial: 'ai-adversarial',
} as const;

export interface AiJudgeOptions {
  /** Model identifier to label this judge, e.g. 'ai-claude'. */
  judgeId: string;
  /** Path to the claude CLI binary. Defaults to 'claude'. */
  claudeBin?: string;
}

/**
 * Build the judge prompt for a deliverable and rubric.
 * When judgeId includes 'adversarial', critical evaluation instructions are added.
 */
export function buildJudgePrompt(
  brief: Brief,
  deliverable: Deliverable,
  rubric: Rubric,
  judgeId: string,
): string {
  const briefContext = buildBriefContext(brief, JUDGE_CONTEXT);

  const perFile = JUDGE_CONTEXT.fileTruncation ?? 12000;
  const totalBudget = JUDGE_CONTEXT.fileBudget ?? 80000;
  const filesText = truncateFiles(deliverable.files, perFile, totalBudget);

  const adversarialClause = judgeId.includes('adversarial')
    ? '\n\nIMPORTANT: You are an adversarial judge. Look for weaknesses, gaps, and missed edge cases. Score critically — be specific about what is missing or wrong.'
    : '';

  return `You are an impartial competition judge. Evaluate the following deliverable against the problem statement and rubric criteria.${adversarialClause}

# Competition Brief
${briefContext}

## Deliverable Files
${filesText || '(no files submitted)'}

## Scoring Instructions
For each rubric criterion, evaluate whether the deliverable:
1. Addresses the stated problem and its requirements
2. Honors the constraints listed above
3. Produced the expected deliverable files
4. Demonstrates quality and completeness relative to the criterion

Return ONLY a JSON object with this exact shape (no markdown, no prose):
{
  "scores": [
    { "criterionId": "<id>", "score": <number 0–maxScore>, "commentary": "<2–3 sentences referencing specific deliverable content>" }
  ]
}`;
}

/**
 * Ask a Claude model to evaluate a deliverable against a rubric.
 *
 * Builds a structured prompt, calls the claude CLI asynchronously,
 * and parses the JSON response back into a JudgeResult.
 *
 * Falls back to zero scores if the CLI call fails or returns
 * unparseable output — the automated scorer acts as the safety net.
 */
export async function aiJudge(
  brief: Brief,
  deliverable: Deliverable,
  rubric: Rubric,
  options: AiJudgeOptions,
): Promise<JudgeResult> {
  const { judgeId, claudeBin = 'claude' } = options;

  const prompt = buildJudgePrompt(brief, deliverable, rubric, judgeId);

  let scores: CriterionScore[] = rubric.criteria.map((c) => ({
    criterionId: c.id,
    score: 0,
    commentary: 'AI judge unavailable — fallback to zero.',
  }));

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        claudeBin,
        ['--print', '-', '--output-format', 'text', '--dangerously-skip-permissions'],
        { env: claudeEnv(), stdio: ['pipe', 'pipe', 'pipe'] },
      );

      child.stdin.write(prompt);
      child.stdin.end();

      let out = '';
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      child.on('close', (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`AI judge exited with code ${code}`));
      });
      child.on('error', reject);

      // Kill after 120s to avoid hanging the judging phase
      setTimeout(() => { child.kill(); reject(new Error('AI judge timed out')); }, 120_000);
    });

    const parsed = JSON.parse(extractJson(stdout)) as { scores: CriterionScore[] };
    if (Array.isArray(parsed.scores)) {
      scores = parsed.scores;
    }
  } catch {
    // Swallow — fallback scores already set above.
  }

  // Clamp scores to [0, maxScore]
  scores = scores.map((s) => {
    const criterion = rubric.criteria.find((c) => c.id === s.criterionId);
    const max = criterion?.maxScore ?? 10;
    return { ...s, score: Math.max(0, Math.min(max, s.score)) };
  });

  return {
    judgeId,
    teamId: deliverable.teamId,
    scores,
    overallScore: computeOverallScore(scores, rubric),
  };
}
