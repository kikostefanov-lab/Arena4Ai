import type { Brief } from '@arena/shared';

export type IncludeField = 'title' | 'problem' | 'constraints' | 'deliverables' | 'rubric' | 'format' | 'deliverableType';

export interface BriefContextOptions {
  include: IncludeField[];
  rubricDetail: 'full' | 'weights-only' | 'descriptions-only';
  fileTruncation?: number;  // default 8000
  fileBudget?: number;      // default 50000
}

// --------------- Presets ---------------

export const JUDGE_CONTEXT: BriefContextOptions = {
  include: ['title', 'problem', 'constraints', 'deliverables', 'rubric'],
  rubricDetail: 'full',
  fileTruncation: 12000,
  fileBudget: 80000,
};

export const PRESENTER_CONTEXT: BriefContextOptions = {
  include: ['title', 'problem', 'constraints', 'deliverables', 'rubric'],
  rubricDetail: 'weights-only',
  fileTruncation: 8000,
  fileBudget: 50000,
};

export const SYNTHESIS_CONTEXT: BriefContextOptions = {
  include: ['title', 'problem', 'constraints', 'rubric'],
  rubricDetail: 'full',
  fileTruncation: 8000,
  fileBudget: 50000,
};

export const FORGE_CONTEXT: BriefContextOptions = {
  include: ['title', 'problem', 'constraints', 'rubric'],
  rubricDetail: 'full',
  fileTruncation: 6000,
  fileBudget: 40000,
};

// --------------- truncateFiles ---------------

export function truncateFiles(
  files: Array<{ path: string; content: string }>,
  perFile: number,
  totalBudget: number,
): string {
  if (files.length === 0) return '';

  const sections: string[] = [];
  let totalChars = 0;
  let included = 0;

  for (const file of files) {
    const content = file.content.length > perFile
      ? file.content.slice(0, perFile) + `\n[truncated at ${perFile} chars]`
      : file.content;

    const section = `### ${file.path}\n\`\`\`\n${content}\n\`\`\``;

    if (totalChars + section.length > totalBudget && included > 0) {
      const remaining = files.length - included;
      if (remaining > 0) {
        sections.push(`(${remaining} more files omitted)`);
      }
      break;
    }

    sections.push(section);
    totalChars += section.length;
    included++;
  }

  return sections.join('\n\n');
}

// --------------- buildBriefContext ---------------

function formatRubricCriterion(
  c: { id: string; description: string; weight: number; maxScore: number },
  detail: BriefContextOptions['rubricDetail'],
): string {
  const pct = Math.round(c.weight * 100);
  switch (detail) {
    case 'full':
      return `- **${c.id}** (weight ${pct}%, max ${c.maxScore}): ${c.description}`;
    case 'weights-only':
      return `- **${c.id}** (weight ${pct}%): ${c.description}`;
    case 'descriptions-only':
      return `- **${c.id}**: ${c.description}`;
  }
}

export function buildBriefContext(brief: Brief, options: BriefContextOptions): string {
  const sections: string[] = [];
  const has = (f: IncludeField) => options.include.includes(f);

  if (has('title')) {
    sections.push(`## Title\n\n${brief.title}`);
  }

  if (has('problem')) {
    sections.push(`## Problem\n\n${brief.problem}`);
  }

  if (has('constraints') && brief.constraints.length > 0) {
    const items = brief.constraints.map((c) => `- ${c}`).join('\n');
    sections.push(`## Constraints\n\n${items}`);
  }

  if (has('deliverables')) {
    const items = brief.deliverables.map((d) => `- ${d}`).join('\n');
    sections.push(`## Deliverables\n\n${items}`);
  }

  if (has('rubric')) {
    const items = brief.rubric.criteria
      .map((c) => formatRubricCriterion(c, options.rubricDetail))
      .join('\n');
    sections.push(`## Rubric\n\n${items}`);
  }

  if (has('format')) {
    sections.push(`## Format\n\n${brief.format}`);
  }

  if (has('deliverableType') && brief.deliverableType) {
    sections.push(`## Deliverable Type\n\n${brief.deliverableType}`);
  }

  return sections.join('\n\n');
}
