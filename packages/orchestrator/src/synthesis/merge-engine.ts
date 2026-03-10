import { spawn } from 'node:child_process';
import type { BriefInput, Deliverable, TeamPresentation } from '@arena/shared';
import { claudeEnv } from '../utils/claude-env.js';
import { extractJson } from '../utils/extract-json.js';

export interface SynthesisOptions {
  /** Path to the claude CLI binary. Defaults to 'claude'. */
  claudeBin?: string;
}

export interface SynthesisResult {
  synthesis: string;          // the combined markdown solution
  overallRationale: string;   // 2-3 sentence thesis of the hybrid
  perCriterion: Array<{       // per-criterion analysis
    criterionId: string;
    teamId: string;           // which team won this criterion
    rationale: string;        // why this team's approach was better
    winningApproach: string;  // 2-3 sentences: what was selected
    losingApproach: string;   // 1-2 sentences: what the other team did
  }>;
}

/**
 * Synthesize the best elements from multiple team deliverables into a single
 * hybrid solution using Claude as the synthesis agent.
 *
 * Returns a SynthesisResult with a markdown synthesis and per-criterion analysis,
 * or null if there are no deliverables (e.g. both teams produced empty output).
 */
export async function synthesizeDeliverables(
  brief: BriefInput,
  deliverables: Deliverable[],
  options: SynthesisOptions,
  presentations?: TeamPresentation[],
): Promise<SynthesisResult | null> {
  const { claudeBin = 'claude' } = options;

  const nonEmpty = deliverables.filter((d) => d.files.length > 0);
  if (nonEmpty.length === 0) return null;

  const criteriaList = brief.rubric.criteria
    .map((c) => `- **${c.id}** (weight ${c.weight}): ${c.description}`)
    .join('\n');

  const criteriaIds = brief.rubric.criteria.map((c) => c.id);
  const teamIds = nonEmpty.map((d) => d.teamId);

  // Build context from presentations (human-readable) if available, otherwise raw files
  let teamContext: string;
  if (presentations && presentations.length > 0) {
    teamContext = presentations.map((pres) => {
      const findings = pres.criterionFindings
        .map((cf) => `  - **${cf.criterionId}**: ${cf.finding}${cf.strength ? ` (+) ${cf.strength}` : ''}${cf.gap ? ` (-) ${cf.gap}` : ''}`)
        .join('\n');
      return `### ${pres.teamId} (${pres.model})\n**Approach:** ${pres.approach}\n**Key Insight:** ${pres.keyInsight}\n**Deliverables:** ${pres.deliverableSummary}\n**Criterion Findings:**\n${findings}`;
    }).join('\n\n---\n\n');
  } else {
    teamContext = nonEmpty
      .map((d) => {
        const files = d.files
          .map((f) => {
            const content = f.content.length > 6000
              ? f.content.slice(0, 6000) + '\n... [truncated]'
              : f.content;
            return `#### ${f.path}\n\`\`\`\n${content}\n\`\`\``;
          })
          .join('\n\n');
        return `### ${d.teamId} Deliverables\n\n${files}`;
      })
      .join('\n\n---\n\n');
  }

  const prompt = `You are a synthesis expert presenting results to a human decision-maker. ${nonEmpty.length} competing AI teams worked on the same problem. Your job is to analyze both approaches criterion-by-criterion, then create a hybrid solution that combines the strongest elements.

Write for a smart person who wants to understand WHY each choice was made, not just WHAT was chosen.

## Problem
${brief.problem}

## Judging Criteria
${criteriaList}

## Team Submissions
${teamContext}

## Your Task

For each criterion:
1. Identify which team's approach was stronger
2. Explain what the winning team did well (2-3 sentences)
3. Explain what the losing team did differently (1-2 sentences)
4. Give a clear rationale for why the winner's approach is better

Then:
5. Write an overall thesis (2-3 sentences) explaining the philosophy of the hybrid
6. Create the synthesized solution as clean markdown

Return valid JSON (no markdown fences, just raw JSON):
{
  "overallRationale": "<2-3 sentence thesis of the hybrid solution>",
  "perCriterion": [
    {
      "criterionId": "<id>",
      "teamId": "<winning-team-id>",
      "winningApproach": "<2-3 sentences: what was selected from this team>",
      "losingApproach": "<1-2 sentences: what the other team did differently>",
      "rationale": "<1-2 sentences: why the winner's approach is better>"
    },
    ...
  ],
  "synthesis": "<full synthesized markdown solution starting with # heading>"
}

Valid criterionIds: ${criteriaIds.join(', ')}
Valid teamIds: ${teamIds.join(', ')}
You MUST include one entry per criterionId, in the same order.`;

  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        claudeBin,
        ['--print', '-', '--output-format', 'text', '--dangerously-skip-permissions'],
        { stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() },
      );

      child.stdin.write(prompt);
      child.stdin.end();

      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      // Cap at 3 minutes — synthesis is post-competition, blocking COMPLETE
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Synthesis timed out after 3 minutes'));
      }, 180_000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(out.trim());
        else reject(new Error(`Synthesis agent exited with code ${code}`));
      });
      child.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });

    if (!output) return null;

    // Parse JSON response — Claude sometimes adds preamble text before the JSON.
    // extractJson uses balanced-brace walking (not greedy regex) to handle synthesis
    // content that contains `}` characters (e.g. code blocks, CSS rules).
    const jsonStr = extractJson(output);
    try {
      const parsed = JSON.parse(jsonStr) as { synthesis?: unknown; perCriterion?: unknown; overallRationale?: unknown };
      const synthesis = typeof parsed.synthesis === 'string' ? parsed.synthesis.trim() : '';
      if (!synthesis) {
        // JSON parsed but synthesis field is missing/empty — treat entire output as synthesis
        return { synthesis: output, overallRationale: '', perCriterion: [] };
      }
      const overallRationale = typeof parsed.overallRationale === 'string' ? parsed.overallRationale : '';
      const perCriterion = Array.isArray(parsed.perCriterion)
        ? (parsed.perCriterion as Array<Record<string, unknown>>)
            .filter(
              (item) =>
                typeof item === 'object' &&
                item !== null &&
                typeof item['criterionId'] === 'string' &&
                typeof item['teamId'] === 'string',
            )
            .map((item) => ({
              criterionId: item['criterionId'] as string,
              teamId: item['teamId'] as string,
              rationale: typeof item['rationale'] === 'string' ? item['rationale'] as string : '',
              winningApproach: typeof item['winningApproach'] === 'string' ? item['winningApproach'] as string : '',
              losingApproach: typeof item['losingApproach'] === 'string' ? item['losingApproach'] as string : '',
            }))
        : [];
      return { synthesis, overallRationale, perCriterion };
    } catch {
      // JSON parse failed — treat entire output as synthesis with no per-criterion data
      return { synthesis: output, overallRationale: '', perCriterion: [] };
    }
  } catch (err) {
    console.error('[arena] synthesis failed:', (err as Error).message);
    return null; // Non-fatal — competition still completes
  }
}
