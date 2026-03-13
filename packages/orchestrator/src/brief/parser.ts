import { readFile } from 'node:fs/promises';
import { load } from 'js-yaml';
import { briefSchema, type BriefInput } from '@arena/shared';

// ─── Known scoreable extensions ──────────────────────────────────────────────
const SCOREABLE_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.rb', '.sh', '.bash', '.go', '.rs', '.java', '.cpp',
  '.c', '.cs', '.php', '.swift', '.kt', '.r', '.pl', '.lua', '.ex', '.exs',
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.html', '.css',
]);

// ─── Shared validation logic ──────────────────────────────────────────────────

function validateParsedBrief(raw: unknown, context: string): BriefInput {
  const result = briefSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Failed to parse brief${context}:\n${issues}`);
  }

  const brief = result.data;

  if (brief.timeLimitMs < 10_000) {
    throw new Error('timeLimitMs must be at least 10 seconds');
  }
  if (brief.timeLimitMs > 3_600_000) {
    throw new Error('timeLimitMs cannot exceed 1 hour');
  }

  if (brief.rubric.criteria.length === 0) {
    throw new Error('Rubric must have at least one criterion');
  }

  const totalWeight = brief.rubric.criteria.reduce((sum, c) => sum + c.weight, 0);
  if (Math.abs(totalWeight - 1.0) > 0.05) {
    console.warn(
      `[arena] Warning: rubric weights sum to ${totalWeight.toFixed(3)}, expected ~1.0. ` +
      `Consider adjusting criterion weights.`,
    );
  }

  for (const d of brief.deliverables) {
    const lastDot = d.lastIndexOf('.');
    const ext = lastDot >= 0 ? d.slice(lastDot).toLowerCase() : '';
    if (!ext || !SCOREABLE_EXTENSIONS.has(ext)) {
      console.warn(
        `[arena] Warning: deliverable '${d}' has no extension — it may not be scoreable by the automated judge`,
      );
    }
  }

  return brief;
}

/**
 * Parse a YAML string directly (synchronous). Used in tests and anywhere
 * a brief is available as a string rather than a file path.
 *
 * @throws Error with a descriptive message if the YAML fails schema validation.
 */
export function parseBriefFromYaml(yamlString: string): BriefInput {
  const raw = load(yamlString);
  return validateParsedBrief(raw, ' (inline)');
}

/**
 * Read a YAML brief file from disk, validate it against briefSchema,
 * and return a fully-typed BriefInput.
 *
 * @throws Error with a descriptive message if the file cannot be read
 *         or the content fails schema validation.
 */
export async function parseBrief(filePath: string): Promise<BriefInput> {
  let raw: unknown;

  try {
    const text = await readFile(filePath, 'utf8');
    raw = load(text);
  } catch (err) {
    throw new Error(
      `Failed to parse brief at "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    return validateParsedBrief(raw, ` at "${filePath}"`);
  } catch (err) {
    // Re-wrap non-"Failed to parse brief" errors to keep the file-path context
    if (err instanceof Error && err.message.startsWith('Failed to parse brief')) {
      throw err;
    }
    throw new Error(
      `Failed to parse brief at "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
