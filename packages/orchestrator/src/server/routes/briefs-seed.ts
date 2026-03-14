import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { BriefsRepository } from '../../db/repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const BRIEFS_DIR = join(REPO_ROOT, 'briefs');

export async function seedYamlBriefs(repo: BriefsRepository): Promise<void> {
  try {
    const files = readdirSync(BRIEFS_DIR).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    const entries = files.map(filename => {
      const raw = readFileSync(join(BRIEFS_DIR, filename), 'utf-8');
      const parsed = yaml.load(raw) as Record<string, any>;
      return {
        id: parsed?.id ?? filename.replace(/\.(yml|yaml)$/, ''),
        title: parsed?.title ?? filename,
        brief: parsed,
        source: 'yaml' as const,
        tags: parsed?.tags ?? [],
      };
    });
    await repo.seedFromYaml(entries);
    console.log(`[arena] seeded ${entries.length} YAML briefs into DB`);
  } catch (err) {
    console.error('[arena] YAML brief seeding failed:', (err as Error).message);
  }
}
