import { Router } from 'express';
import { spawn } from 'node:child_process';
import { claudeEnv } from '../../utils/claude-env.js';
import { extractJson } from '../../utils/extract-json.js';

export const generatePersonaRouter = Router();

generatePersonaRouter.post('/', async (req, res) => {
  const { mode, idea, systemPrompt } = req.body as {
    mode?: string;
    idea?: string;
    systemPrompt?: string;
  };

  if (mode !== 'full' && mode !== 'expand') {
    res.status(400).json({ error: 'mode must be "full" or "expand"' });
    return;
  }

  if (mode === 'full') {
    if (!idea || typeof idea !== 'string' || idea.trim().length === 0) {
      res.status(400).json({ error: 'idea is required for mode "full"' });
      return;
    }
  } else {
    if (!systemPrompt || typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0) {
      res.status(400).json({ error: 'systemPrompt is required for mode "expand"' });
      return;
    }
  }

  const prompt =
    mode === 'full'
      ? `You are a persona designer for an AI agent competition platform.

The user wants to create a new persona (a system prompt template that shapes an AI agent's mindset).

User's idea: "${idea!.trim()}"

Return a JSON object with exactly these fields:
- name: short kebab-case identifier (e.g. "fast-coder", "deep-thinker")
- description: one-line summary (max 80 chars)
- systemPrompt: 2-4 sentence system prompt defining this persona's approach, priorities, and style
- tags: array of 2-4 short descriptor strings
- avatar: single emoji representing this persona

Respond with ONLY valid JSON. No markdown, no explanation.`
      : `You are a system prompt editor for an AI agent competition platform.

Improve and expand this system prompt while preserving the original intent:

"${systemPrompt!.trim()}"

Return a JSON object with exactly this field:
- systemPrompt: the improved version (2-5 sentences, specific, actionable)

Respond with ONLY valid JSON. No markdown, no explanation.`;

  try {
    const claudeBin = process.env.CLAUDE_BIN ?? 'claude';
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        claudeBin,
        ['-p', '-'],
        { stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() },
      );
      child.stdin!.write(prompt);
      child.stdin!.end();
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });
      const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 60_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out.trim());
        else reject(new Error(`exited ${code}: ${err.slice(0, 300)}`));
      });
      child.on('error', reject);
    });

    const persona = JSON.parse(extractJson(output));
    res.json(persona);
  } catch (err) {
    console.error('[arena] generate-persona failed:', err);
    res.status(500).json({ error: 'Generation failed' });
  }
});
