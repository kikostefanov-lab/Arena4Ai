import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reads a scrubbed squad transcript from `__fixtures__/squads/` and returns its
 * non-empty lines. `name` is the file name with or without the `.jsonl` suffix.
 */
export function loadFixture(name: string): string[] {
  const file = name.endsWith('.jsonl') ? name : `${name}.jsonl`;
  const path = fileURLToPath(new URL(`./squads/${file}`, import.meta.url));
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}
