import { spawn } from 'node:child_process';
import type { BriefInput, Deliverable } from '@arena/shared';
import { claudeEnv } from '../utils/claude-env.js';

export interface SynthesisOptions {
  /** Path to the claude CLI binary. Defaults to 'claude'. */
  claudeBin?: string;
}

/**
 * Synthesize the best elements from multiple team deliverables into a single
 * hybrid solution using Claude as the synthesis agent.
 *
 * Returns markdown text with attribution, or null if there are no deliverables
 * (e.g. both teams produced empty output).
 */
export async function synthesizeDeliverables(
  brief: BriefInput,
  deliverables: Deliverable[],
  options: SynthesisOptions,
): Promise<string | null> {
  const { claudeBin = 'claude' } = options;

  const nonEmpty = deliverables.filter((d) => d.files.length > 0);
  if (nonEmpty.length === 0) return null;

  const deliverablesSections = nonEmpty
    .map((d) => {
      const files = d.files
        .map((f) => `#### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n');
      return `### ${d.teamId} Deliverables\n\n${files}`;
    })
    .join('\n\n---\n\n');

  const criteriaList = brief.rubric.criteria
    .map((c) => `- **${c.id}**: ${c.description}`)
    .join('\n');

  const prompt = `You are a synthesis expert. ${nonEmpty.length} competing AI teams worked on the same problem and produced their best solutions. Your job is to create a hybrid that combines the strongest elements from each.

## Problem
${brief.problem}

## Rubric
${criteriaList}

## Team Submissions
${deliverablesSections}

## Your Task
1. Identify the 2-3 strongest elements from each team's submission
2. Create a synthesized solution that combines these elements into a coherent whole
3. For each major element you include, add an inline attribution comment like <!-- from: team-a --> or <!-- from: team-b -->

Return ONLY the synthesized solution as a markdown document. No preamble, no explanation outside the document itself. Start with a # heading.`;

  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        claudeBin,
        ['--print', prompt, '--output-format', 'text', '--dangerously-skip-permissions'],
        { stdio: ['ignore', 'pipe', 'pipe'], env: claudeEnv() },
      );

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
      child.on('error', reject);
    });

    return output || null;
  } catch (err) {
    console.error('[arena] synthesis failed:', (err as Error).message);
    return null; // Non-fatal — competition still completes
  }
}
