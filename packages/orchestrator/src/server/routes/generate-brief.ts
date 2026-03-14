import { Router } from 'express';
import { spawn } from 'node:child_process';
import { claudeEnv } from '../../utils/claude-env.js';
import { extractJson } from '../../utils/extract-json.js';
import { runIntake } from '../../brief/intake.js';
import {
  DOMAIN_TEMPLATES,
  buildGenerationPrompt,
  type BriefDomain,
  type DeliverableType,
} from '../../brief/domain-templates.js';
import { scoreBriefQuality } from '../../brief/quality-scorer.js';

export const generateBriefRouter = Router();

// ─── Helper: spawn Claude and collect output ─────────────────────────────────

async function spawnClaude(prompt: string, timeoutMs = 90_000): Promise<string> {
  const claudeBin = process.env.CLAUDE_BIN ?? 'claude';
  return new Promise<string>((resolve, reject) => {
    const child = spawn(claudeBin, ['-p', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: claudeEnv(),
    });

    child.stdin!.write(prompt);
    child.stdin!.end();

    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('claude timed out'));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
    });
    child.on('error', reject);
  });
}

// ─── POST /generate-brief/intake ─────────────────────────────────────────────
// Classifies domain and returns targeted follow-up questions.

generateBriefRouter.post('/intake', async (req, res) => {
  const { idea } = req.body as { idea?: string };

  if (!idea || typeof idea !== 'string' || idea.trim().length < 10) {
    res.status(400).json({ error: 'Idea too short (minimum 10 characters)' });
    return;
  }

  try {
    const result = await runIntake(idea);
    res.json(result);
  } catch (err) {
    console.error('[arena] intake failed:', err);
    res.status(500).json({ error: 'Intake classification failed' });
  }
});

// ─── POST /generate-brief/generate ──────────────────────────────────────────
// Domain-aware generation using template + intake answers.

generateBriefRouter.post('/generate', async (req, res) => {
  const {
    idea,
    answers = [],
    domain,
    deliverableType,
    format = 'SPRINT',
    learnings,
  } = req.body as {
    idea?: string;
    answers?: Record<string, string> | string[];
    domain?: BriefDomain;
    deliverableType?: DeliverableType;
    format?: string;
    learnings?: string[];
  };

  if (!idea || typeof idea !== 'string' || idea.trim().length < 10) {
    res.status(400).json({ error: 'Idea too short (minimum 10 characters)' });
    return;
  }

  const resolvedDomain: BriefDomain = domain && domain in DOMAIN_TEMPLATES ? domain : 'software';
  const template = { ...DOMAIN_TEMPLATES[resolvedDomain] };

  // Allow overriding deliverableType
  if (deliverableType) {
    template.deliverableType = deliverableType;
  }

  const prompt = buildGenerationPrompt(idea, answers, template, learnings);

  try {
    const output = await spawnClaude(prompt);
    const brief = JSON.parse(extractJson(output));
    // Ensure format is carried through
    brief.format = brief.format || format;
    res.json(brief);
  } catch (err) {
    console.error('[arena] generate-brief/generate failed:', err);
    res.status(500).json({ error: 'Brief generation failed' });
  }
});

// ─── POST /generate-brief/quality ────────────────────────────────────────────
// Heuristic quality check on a brief (no LLM).

generateBriefRouter.post('/quality', (req, res) => {
  const { brief } = req.body as { brief?: unknown };

  if (!brief || typeof brief !== 'object') {
    res.status(400).json({ error: 'Missing or invalid brief object' });
    return;
  }

  try {
    const report = scoreBriefQuality(brief as Parameters<typeof scoreBriefQuality>[0]);
    res.json(report);
  } catch (err) {
    console.error('[arena] quality check failed:', err);
    res.status(500).json({ error: 'Quality check failed' });
  }
});

// ─── POST /generate-brief ───────────────────────────────────────────────────
// Legacy single-shot endpoint: chains intake + generate internally.
// Backward compatible with the original API.

generateBriefRouter.post('/', async (req, res) => {
  const { idea, format = 'SPRINT' } = req.body as { idea?: string; format?: string };

  if (!idea || typeof idea !== 'string' || idea.trim().length < 10) {
    res.status(400).json({ error: 'Idea too short' });
    return;
  }

  try {
    // Step 1: intake classification
    let domain: BriefDomain = 'software';
    try {
      const intake = await runIntake(idea);
      domain = intake.detectedDomain;
    } catch {
      // Fall through to software domain on intake failure
      console.warn('[arena] intake failed, falling back to software domain');
    }

    // Step 2: generate with domain template (no answers since this is single-shot)
    const template = DOMAIN_TEMPLATES[domain];
    const prompt = buildGenerationPrompt(idea, [], template);

    const output = await spawnClaude(prompt);
    const brief = JSON.parse(extractJson(output));
    brief.format = brief.format || format;
    res.json(brief);
  } catch (err) {
    console.error('[arena] generate-brief failed:', err);
    res.status(500).json({ error: 'Generation failed' });
  }
});
