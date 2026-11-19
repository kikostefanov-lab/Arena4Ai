import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadFixture } from '../__fixtures__/load.js';

const DIR = fileURLToPath(new URL('../__fixtures__/squads/', import.meta.url));
const FIXTURES = readdirSync(DIR).filter((f) => f.endsWith('.jsonl'));
const FORBIDDEN = /\/Users\/|kikostefanov|@gmail|mcp__|netsuite|home[-_]assistant|gmail/i;

describe('squad fixtures', () => {
  it('has the expected fixtures', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(8);
  });

  it('contains no operator-identifying content', () => {
    for (const file of readdirSync(DIR)) {
      expect(readFileSync(join(DIR, file), 'utf8'), file).not.toMatch(FORBIDDEN);
    }
  });

  it('keeps each fixture under 60 lines', () => {
    for (const file of FIXTURES) {
      expect(loadFixture(file).length, file).toBeLessThan(60);
    }
  });

  it('holds one JSON object per line', () => {
    for (const file of FIXTURES) {
      for (const line of loadFixture(file)) expect(() => JSON.parse(line), file).not.toThrow();
    }
  });
});
