import { readFile } from 'node:fs/promises';
import { load } from 'js-yaml';
import { briefSchema, type BriefInput } from '@arena/shared';

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

  const result = briefSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Failed to parse brief at "${filePath}":\n${issues}`);
  }

  return result.data;
}
