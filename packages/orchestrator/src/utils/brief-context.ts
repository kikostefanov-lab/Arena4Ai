import { expectedFileName, type Brief } from '@arena/shared';

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
  fileTruncation: 24000,
  fileBudget: 240000,
};

export const PRESENTER_CONTEXT: BriefContextOptions = {
  include: ['title', 'problem', 'constraints', 'deliverables', 'rubric'],
  rubricDetail: 'weights-only',
  fileTruncation: 12000,
  fileBudget: 120000,
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

/** File names the brief's deliverables name; entries that only describe a file are skipped. */
export function namedDeliverables(brief: Brief): string[] {
  return brief.deliverables.map(expectedFileName).filter((n): n is string => n !== null);
}

/**
 * Render files for an LLM prompt within a character budget.
 *
 * `priority` names (brief deliverables) come first, in the order given, so a
 * large research directory cannot push them out of the prompt; each name matches
 * an exact relative path, or a basename when it has no `/`. The output ends with
 * what was left out, so the model never mistakes a cut manifest for a short one.
 */
export function truncateFiles(
  files: Array<{ path: string; content: string }>,
  perFile: number,
  totalBudget: number,
  priority: string[] = [],
): string {
  if (files.length === 0 && priority.length === 0) return '';

  const matches = (path: string, name: string): boolean => {
    const p = path.replace(/^\.?\//, '').toLowerCase();
    const n = name.replace(/^\.?\//, '').toLowerCase();
    return n.includes('/') ? p === n : p.split('/').pop() === n;
  };

  const ordered: Array<{ path: string; content: string }> = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  const exact = (path: string, name: string): boolean =>
    path.replace(/^\.?\//, '').toLowerCase() === name.replace(/^\.?\//, '').toLowerCase();
  for (const name of priority) {
    // The exact path first, then nested basename matches, as collection ranks them.
    const hits = files
      .filter((f) => !seen.has(f.path) && matches(f.path, name))
      .sort((a, b) => Number(!exact(a.path, name)) - Number(!exact(b.path, name)));
    if (!files.some((f) => matches(f.path, name))) missing.push(name);
    for (const h of hits) { seen.add(h.path); ordered.push(h); }
  }
  for (const f of files) if (!seen.has(f.path)) ordered.push(f);

  const sections: string[] = [];
  let totalChars = 0;
  let included = 0;
  let omittedFiles = 0;
  let omittedChars = 0;

  for (const file of ordered) {
    const cut = Math.max(0, file.content.length - perFile);
    const content = cut > 0
      ? file.content.slice(0, perFile) + `\n[truncated at ${perFile} chars]`
      : file.content;

    const section = `### ${file.path}\n\`\`\`\n${content}\n\`\`\``;

    if (totalChars + section.length > totalBudget && included > 0) {
      omittedFiles++;
      omittedChars += file.content.length;
      continue;
    }

    sections.push(section);
    totalChars += section.length;
    included++;
    omittedChars += cut;
  }

  if (missing.length > 0) {
    sections.push(`(missing named deliverables: ${missing.join(', ')})`);
  }
  if (omittedFiles > 0 || omittedChars > 0) {
    sections.push(`(${omittedFiles} files, ${omittedChars} chars omitted)`);
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
