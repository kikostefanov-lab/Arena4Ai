/**
 * Serialize a Brief to YAML format compatible with the CLI brief files.
 * We don't use a yaml library — hand-serialize since the structure is simple.
 */
export function briefToYaml(brief: {
  id?: string;
  title: string;
  format?: string;
  problem: string;
  constraints?: string[];
  deliverables?: string[];
  timeLimitMs?: number;
  expectedOutput?: string;
  rubric?: {
    criteria: Array<{
      id: string;
      description: string;
      maxScore: number;
      weight: number;
    }>;
  };
}): string {
  const lines: string[] = [];

  if (brief.title) lines.push(`title: "${brief.title.replace(/"/g, '\\"')}"`);
  if (brief.format) lines.push(`format: ${brief.format}`);
  if (brief.timeLimitMs) lines.push(`timeLimitMs: ${brief.timeLimitMs}`);

  // Problem — use YAML block scalar for multiline
  lines.push('problem: |');
  for (const line of brief.problem.split('\n')) {
    lines.push(`  ${line}`);
  }

  if (brief.constraints?.length) {
    lines.push('constraints:');
    for (const c of brief.constraints) {
      lines.push(`  - "${c.replace(/"/g, '\\"')}"`);
    }
  }

  if (brief.deliverables?.length) {
    lines.push('deliverables:');
    for (const d of brief.deliverables) {
      lines.push(`  - ${d}`);
    }
  }

  if (brief.expectedOutput) {
    lines.push('expectedOutput: |');
    for (const line of brief.expectedOutput.split('\n')) {
      lines.push(`  ${line}`);
    }
  }

  if (brief.rubric?.criteria?.length) {
    lines.push('rubric:');
    lines.push('  criteria:');
    for (const c of brief.rubric.criteria) {
      lines.push(`    - id: ${c.id}`);
      lines.push(`      description: "${c.description.replace(/"/g, '\\"')}"`);
      lines.push(`      maxScore: ${c.maxScore}`);
      lines.push(`      weight: ${c.weight}`);
    }
  }

  return lines.join('\n') + '\n';
}

export function downloadYaml(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
