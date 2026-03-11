import { Router } from 'express';
import type { Request, Response } from 'express';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const briefsRouter = Router();

// Resolve repo root: go up from src/server/routes/ → src/server/ → src/ → packages/orchestrator/ → packages/ → repo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..');
const BRIEFS_DIR = join(REPO_ROOT, 'briefs');

interface BriefYaml {
  id?: string;
  title?: string;
  format?: string;
  tags?: string[];
  timeLimitMs?: number;
  problem?: string;
  [key: string]: unknown;
}

// GET /briefs — returns metadata for all brief YAML files
briefsRouter.get('/', (_req: Request, res: Response) => {
  try {
    const files = readdirSync(BRIEFS_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

    const briefs = files.map((filename) => {
      try {
        const raw = readFileSync(join(BRIEFS_DIR, filename), 'utf-8');
        const parsed = yaml.load(raw) as BriefYaml;
        const problem = typeof parsed?.problem === 'string' ? parsed.problem : '';
        return {
          id: parsed?.id ?? filename.replace(/\.(yml|yaml)$/, ''),
          title: parsed?.title ?? filename,
          format: parsed?.format ?? 'SPRINT',
          tags: parsed?.tags ?? [],
          timeLimitMs: parsed?.timeLimitMs ?? 120000,
          problemSnippet: problem.trim().slice(0, 200),
          filename,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    res.json(briefs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read briefs directory', details: String(err) });
  }
});
