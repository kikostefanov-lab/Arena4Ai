import { spawn } from 'node:child_process';
import type { Brief, Deliverable, TeamPresentation } from '@arena/shared';
import { claudeEnv } from '../utils/claude-env.js';
import { extractJson } from '../utils/extract-json.js';
import { buildBriefContext, truncateFiles, PRESENTER_CONTEXT } from '../utils/brief-context.js';

export interface PresentationOptions {
  claudeBin?: string;
}

/**
 * Generate a human-readable presentation of what a team produced,
 * mapped back to the rubric criteria from the original brief.
 *
 * The presentation translates raw deliverables (code, markdown, data)
 * into plain-English findings that a non-technical human can understand.
 */
export async function generatePresentation(
  brief: Brief,
  deliverable: Deliverable,
  teamModel: string,
  options: PresentationOptions = {},
): Promise<TeamPresentation | null> {
  const { claudeBin = 'claude' } = options;

  if (deliverable.files.length === 0) {
    return {
      teamId: deliverable.teamId,
      model: teamModel,
      approach: 'This team did not produce any deliverable files.',
      criterionFindings: brief.rubric.criteria.map((c) => ({
        criterionId: c.id,
        finding: 'No deliverable was submitted for this criterion.',
        strength: '',
        gap: 'No output produced.',
      })),
      keyInsight: 'No files were submitted.',
      deliverableSummary: 'No files produced.',
    };
  }

  const briefContext = buildBriefContext(brief, PRESENTER_CONTEXT);
  const filesSections = truncateFiles(deliverable.files, PRESENTER_CONTEXT.fileTruncation!, PRESENTER_CONTEXT.fileBudget!);

  const criterionIds = brief.rubric.criteria.map((c) => c.id);

  const prompt = `You are presenting a team's competition results to a non-technical human audience.
Your job is to translate raw deliverables (code, data, documents) into plain-English findings
that connect back to the original problem and judging criteria.

Write as if you are explaining to a smart person who does NOT read code.

${briefContext}

## Team: ${deliverable.teamId} (${teamModel})
### Deliverables
${filesSections}

## Your Task
For this team, create a structured presentation:
1. **approach**: 1-2 sentences summarizing their overall strategy
2. **criterionFindings**: For EACH criterion, explain what this team found or built in plain language (2-3 sentences), what's strong (1 sentence), and what's missing or weak (1 sentence, empty string if nothing)
3. **keyInsight**: The single most important insight or finding from this team's work (1-2 sentences)
4. **deliverableSummary**: Plain-English summary of what files were produced and what they contain (2-3 sentences)

Return valid JSON (no markdown fences, just raw JSON):
{
  "approach": "...",
  "criterionFindings": [
    { "criterionId": "<id>", "finding": "...", "strength": "...", "gap": "..." },
    ...
  ],
  "keyInsight": "...",
  "deliverableSummary": "..."
}

Valid criterionIds: ${criterionIds.join(', ')}
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
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Presentation generation timed out after 2 minutes'));
      }, 120_000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(out.trim());
        else reject(new Error(`Presentation agent exited with code ${code}`));
      });
      child.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });

    if (!output) return null;

    const jsonStr = extractJson(output);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    const approach = typeof parsed.approach === 'string' ? parsed.approach : '';
    const keyInsight = typeof parsed.keyInsight === 'string' ? parsed.keyInsight : '';
    const deliverableSummary = typeof parsed.deliverableSummary === 'string' ? parsed.deliverableSummary : '';

    const criterionFindings = Array.isArray(parsed.criterionFindings)
      ? (parsed.criterionFindings as Array<Record<string, unknown>>)
          .filter((item) => typeof item === 'object' && item !== null && typeof item.criterionId === 'string')
          .map((item) => ({
            criterionId: item.criterionId as string,
            finding: typeof item.finding === 'string' ? item.finding : '',
            strength: typeof item.strength === 'string' ? item.strength : '',
            gap: typeof item.gap === 'string' ? item.gap : '',
          }))
      : [];

    return {
      teamId: deliverable.teamId,
      model: teamModel,
      approach,
      criterionFindings,
      keyInsight,
      deliverableSummary,
    };
  } catch (err) {
    console.error(`[arena] presentation generation failed for ${deliverable.teamId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Generate presentations for all teams in parallel.
 */
export async function generateAllPresentations(
  brief: Brief,
  deliverables: Deliverable[],
  teamModels: Map<string, string>,
  options: PresentationOptions = {},
): Promise<TeamPresentation[]> {
  const results = await Promise.all(
    deliverables.map((d) =>
      generatePresentation(brief, d, teamModels.get(d.teamId) ?? 'unknown', options),
    ),
  );
  return results.filter((p): p is TeamPresentation => p !== null);
}
