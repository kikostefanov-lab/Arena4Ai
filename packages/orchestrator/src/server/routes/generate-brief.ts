import { Router } from 'express';
import { spawn } from 'node:child_process';
import { claudeEnv } from '../../utils/claude-env.js';

export const generateBriefRouter = Router();

generateBriefRouter.post('/', async (req, res) => {
  const { idea, format = 'SPRINT' } = req.body as { idea?: string; format?: string };

  if (!idea || typeof idea !== 'string' || idea.trim().length < 10) {
    res.status(400).json({ error: 'Idea too short' });
    return;
  }

  const prompt = `You are a competition brief writer for an AI coding competition platform. A user has provided a rough idea. Expand it into a structured brief.

User's idea: "${idea.trim()}"
Format: ${format}

Return ONLY valid JSON with this exact structure (no markdown, no preamble):
{
  "title": "Short compelling title (5-8 words)",
  "problem": "Clear 2-4 sentence problem description. Be specific about inputs, outputs, and constraints.",
  "constraints": "Constraint 1\\nConstraint 2\\nConstraint 3",
  "deliverables": "main_file.py\\nREADME.md",
  "expectedOutput": "exact expected output if deterministic, otherwise empty string",
  "criteria": [
    { "id": "correctness", "description": "Solution correctness and completeness", "maxScore": 10, "weight": 0.5 },
    { "id": "code-quality", "description": "Code quality and maintainability", "maxScore": 10, "weight": 0.3 },
    { "id": "efficiency", "description": "Performance and algorithmic efficiency", "maxScore": 10, "weight": 0.2 }
  ]
}`;

  try {
    const claudeBin = process.env.CLAUDE_BIN ?? 'claude';
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        claudeBin,
        ['--print', prompt, '--output-format', 'text', '--dangerously-skip-permissions'],
        { stdio: ['ignore', 'pipe', 'ignore'], env: claudeEnv() },
      );
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 30_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out.trim());
        else reject(new Error(`exited ${code}`));
      });
      child.on('error', reject);
    });

    // Parse JSON — handle code fences if Claude adds them
    const jsonStr = output.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    const brief = JSON.parse(jsonStr);
    res.json(brief);
  } catch (err) {
    console.error('[arena] generate-brief failed:', err);
    res.status(500).json({ error: 'Generation failed' });
  }
});
