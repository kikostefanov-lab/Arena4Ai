import { spawn } from 'node:child_process';
import type { Rubric, Deliverable, JudgeResult, CriterionScore } from '@arena/shared';
import { claudeEnv } from '../utils/claude-env.js';
import { computeOverallScore } from './score-aggregator.js';

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
  deliverable: Deliverable,
  rubric: Rubric,
  judgeId: string,
): string {
  const criteriaList = rubric.criteria
    .map((c) => `- ${c.id}: ${c.description} (max ${c.maxScore} points)`)
    .join('\n');

  const filesText = deliverable.files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  const adversarialClause = judgeId.includes('adversarial')
    ? '\n\nIMPORTANT: You are an adversarial judge. Look for weaknesses, gaps, and missed edge cases. Score critically — be specific about what is missing or wrong.'
    : '';

  return `You are an impartial competition judge. Evaluate the following deliverable against each rubric criterion.${adversarialClause}

## Rubric Criteria
${criteriaList}

## Deliverable Files
${filesText || '(no files submitted)'}

## Instructions
Return ONLY a JSON object with this exact shape (no markdown, no prose):
{
  "scores": [
    { "criterionId": "<id>", "score": <number 0–maxScore>, "commentary": "<1–2 sentences>" }
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
  deliverable: Deliverable,
  rubric: Rubric,
  options: AiJudgeOptions,
): Promise<JudgeResult> {
  const { judgeId, claudeBin = 'claude' } = options;

  const prompt = buildJudgePrompt(deliverable, rubric, judgeId);

  let scores: CriterionScore[] = rubric.criteria.map((c) => ({
    criterionId: c.id,
    score: 0,
    commentary: 'AI judge unavailable — fallback to zero.',
  }));

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        claudeBin,
        ['--print', prompt, '--output-format', 'text', '--dangerously-skip-permissions'],
        { env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
      );

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

    const jsonMatch = stdout.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { scores: CriterionScore[] };
      if (Array.isArray(parsed.scores)) {
        scores = parsed.scores;
      }
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
