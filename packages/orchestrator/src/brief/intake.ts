import { spawn } from 'node:child_process';
import { claudeEnv } from '../utils/claude-env.js';
import { extractJson } from '../utils/extract-json.js';
import { buildIntakePrompt, DOMAIN_TEMPLATES, type BriefDomain, type DeliverableType } from './domain-templates.js';

export interface IntakeResult {
  detectedDomain: BriefDomain;
  detectedDeliverableType: DeliverableType;
  questions: string[];
}

const VALID_DOMAINS = new Set<string>(Object.keys(DOMAIN_TEMPLATES));

const VALID_DELIVERABLE_TYPES = new Set<string>([
  'code', 'document', 'analysis', 'presentation', 'plan', 'mixed',
]);

/**
 * Spawn Claude to classify a rough idea into a domain and generate
 * targeted follow-up questions.
 *
 * Falls back to 'software' if the detected domain is unrecognized.
 */
export async function runIntake(idea: string, claudeBin?: string): Promise<IntakeResult> {
  const bin = claudeBin ?? process.env.CLAUDE_BIN ?? 'claude';
  const prompt = buildIntakePrompt(idea);

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, ['-p', '-'], {
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
      reject(new Error('intake timed out after 60s'));
    }, 60_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
    });
    child.on('error', reject);
  });

  const parsed = JSON.parse(extractJson(output)) as {
    detectedDomain?: string;
    detectedDeliverableType?: string;
    questions?: string[];
  };

  const domain: BriefDomain = VALID_DOMAINS.has(parsed.detectedDomain ?? '')
    ? (parsed.detectedDomain as BriefDomain)
    : 'software';

  const deliverableType: DeliverableType = VALID_DELIVERABLE_TYPES.has(parsed.detectedDeliverableType ?? '')
    ? (parsed.detectedDeliverableType as DeliverableType)
    : DOMAIN_TEMPLATES[domain].deliverableType;

  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter((q): q is string => typeof q === 'string').slice(0, 3)
    : [];

  return { detectedDomain: domain, detectedDeliverableType: deliverableType, questions };
}
