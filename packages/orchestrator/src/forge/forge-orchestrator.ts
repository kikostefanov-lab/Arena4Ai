import { spawn } from 'node:child_process';
import type { Brief, TeamPresentation, ForgeOutput, ForgeArtifact, ForgeArtifactType } from '@arena/shared';
import { claudeEnv } from '../utils/claude-env.js';

type ArtifactStatus = 'queued' | 'generating' | 'done' | 'error';
type ProgressMap = Record<string, ArtifactStatus>;

const forgeProgressStore = new Map<string, ProgressMap>();

export function getForgeProgress(competitionId: string): ProgressMap | null {
  const progress = forgeProgressStore.get(competitionId);
  return progress ? { ...progress } : null;
}

export interface ForgeInput {
  brief: Brief;
  presentations: TeamPresentation[];
  synthesis: { synthesis: string; perCriterion: Array<{ criterionId: string; teamId: string; rationale: string }> } | null;
  winner: { teamId: string; model: string };
  deliverables: Array<{ teamId: string; files: { path: string; content: string }[] }>;
}

interface ArtifactSpec {
  type: ForgeArtifactType;
  title: string;
  systemPrompt: string;
}

const ARTIFACT_SPECS: ArtifactSpec[] = [
  {
    type: 'roadmap',
    title: 'Implementation Roadmap',
    systemPrompt: `You are a senior technical program manager creating an implementation roadmap.

Given the competition results — the original brief, team presentations, synthesis, and winning deliverables — produce a phased delivery plan.

Include:
- 3-5 phases with clear milestones and success gates
- Effort estimates (days/weeks) per phase
- Dependencies between phases
- MVP scope (what ships first)
- Risk checkpoints between phases

Output clean, well-structured Markdown with headers, tables, and bullet lists.`,
  },
  {
    type: 'task_graph',
    title: 'Task Dependency Graph',
    systemPrompt: `You are a project planner creating a task dependency graph.

Given the competition results, decompose the solution into actionable tasks.

Include for each task:
- Unique task ID (T001, T002, etc.)
- Title and description (1-2 sentences)
- Effort estimate: S (< 2h), M (2-8h), L (1-3 days), XL (3+ days)
- Skill type required (frontend, backend, data, infra, design)
- Dependencies (list of task IDs that must complete first)
- Priority: P0 (critical path), P1 (important), P2 (nice-to-have)

Output as Markdown with a table and a text-based dependency diagram.`,
  },
  {
    type: 'repo_blueprint',
    title: 'Repository Blueprint',
    systemPrompt: `You are a software architect creating a repository blueprint.

Given the competition results, design the directory structure and technology stack for implementation.

Include:
- Full directory tree with file descriptions
- Technology choices with rationale (language, framework, database, etc.)
- Package/module boundaries
- Configuration files needed
- Development tooling (linter, formatter, test framework, CI/CD)

Output as Markdown with code blocks for the directory tree.`,
  },
  {
    type: 'api_contracts',
    title: 'API Contracts',
    systemPrompt: `You are an API architect creating API contracts.

Given the competition results, define the API surface of the solution.

Include:
- REST endpoints (method, path, description)
- Request/response schemas (TypeScript interfaces or JSON Schema)
- Authentication/authorization requirements
- WebSocket protocol (if applicable)
- Error response formats
- Rate limiting considerations

Output as Markdown with code blocks for schemas and endpoint tables.`,
  },
  {
    type: 'risk_register',
    title: 'Risk Register',
    systemPrompt: `You are a risk analyst creating a risk register for a technical implementation.

Given the competition results, identify risks and mitigation strategies.

Include for each risk:
- Risk ID and title
- Category (technical, operational, resource, external)
- Likelihood: Low / Medium / High
- Impact: Low / Medium / High
- Mitigation strategy (concrete actions)
- Owner role (who should handle this)

Output as Markdown with a structured table.`,
  },
  {
    type: 'decision_log',
    title: 'Architectural Decision Log',
    systemPrompt: `You are a software architect documenting architectural decisions (ADRs).

Given the competition results, capture the key decisions made during the competition and the ones still needed for implementation.

Include for each decision:
- Decision ID (ADR-001, etc.)
- Title
- Status: Accepted (from competition) or Proposed (for implementation)
- Context (why this decision was needed)
- Options considered (at least 2)
- Decision and rationale
- Consequences (trade-offs)

Output as Markdown following the ADR format.`,
  },
];

function buildForgeUserPrompt(input: ForgeInput): string {
  const { brief, presentations, synthesis, winner, deliverables } = input;

  const sections: string[] = [];

  sections.push(`# Original Brief\n\n**Title:** ${brief.title}\n**Problem:** ${brief.problem}\n**Constraints:** ${brief.constraints.join(', ')}`);

  if (brief.rubric?.criteria) {
    sections.push(`## Judging Criteria\n${brief.rubric.criteria.map((c) => `- **${c.id}** (weight ${c.weight}): ${c.description}`).join('\n')}`);
  }

  // Winning team's presentation
  const winnerPres = presentations.find((p) => p.teamId === winner.teamId);
  if (winnerPres) {
    sections.push(`# Winning Team Presentation (${winner.model})\n\n**Approach:** ${winnerPres.approach}\n**Key Insight:** ${winnerPres.keyInsight}\n**Deliverables:** ${winnerPres.deliverableSummary}`);
    if (winnerPres.criterionFindings.length > 0) {
      sections.push(`## Criterion Findings\n${winnerPres.criterionFindings.map((cf) => `- **${cf.criterionId}**: ${cf.finding}${cf.strength ? ` (+) ${cf.strength}` : ''}${cf.gap ? ` (-) ${cf.gap}` : ''}`).join('\n')}`);
    }
  }

  // Other team presentations (for context)
  const otherPres = presentations.filter((p) => p.teamId !== winner.teamId);
  if (otherPres.length > 0) {
    sections.push(`# Other Team Presentations\n${otherPres.map((p) => `## ${p.teamId} (${p.model})\n**Approach:** ${p.approach}\n**Key Insight:** ${p.keyInsight}`).join('\n\n')}`);
  }

  // Synthesis
  if (synthesis) {
    sections.push(`# Synthesis (Best of Both Teams)\n\n${synthesis.synthesis}`);
    if (synthesis.perCriterion.length > 0) {
      sections.push(`## Per-Criterion Winners\n${synthesis.perCriterion.map((pc) => `- **${pc.criterionId}**: ${pc.teamId} — ${pc.rationale}`).join('\n')}`);
    }
  }

  // Winning team's deliverable files (capped at 40KB total to stay within token limits)
  const winnerDeliverables = deliverables.find((d) => d.teamId === winner.teamId);
  if (winnerDeliverables && winnerDeliverables.files.length > 0) {
    const MAX_TOTAL_BYTES = 40_000;
    let totalBytes = 0;
    const fileParts: string[] = [];
    for (const f of winnerDeliverables.files) {
      if (totalBytes >= MAX_TOTAL_BYTES) {
        fileParts.push(`\n... (${winnerDeliverables.files.length - fileParts.length} more files omitted for size)`);
        break;
      }
      const budget = MAX_TOTAL_BYTES - totalBytes;
      const content = f.content.length > Math.min(6000, budget)
        ? f.content.slice(0, Math.min(6000, budget)) + '\n... [truncated]'
        : f.content;
      totalBytes += content.length;
      fileParts.push(`### ${f.path}\n\`\`\`\n${content}\n\`\`\``);
    }
    sections.push(`# Winning Team Deliverables\n\n${fileParts.join('\n\n')}`);
  }

  return sections.join('\n\n---\n\n');
}

/** Model label for display (uses whatever model the Claude CLI is configured with). */
const FORGE_MODEL_LABEL = 'claude-cli';

function runClaude(prompt: string, systemPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    const proc = spawn('claude', ['-p', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: claudeEnv(),
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Claude CLI timed out after 2 minutes'));
    }, 120_000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Claude CLI exited with code ${code}${stderr ? ` — ${stderr.slice(0, 500)}` : ''}`));
        return;
      }
      resolve(stdout.trim());
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Claude CLI failed to start: ${err.message}`));
    });

    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  });
}

export async function runForge(input: ForgeInput, competitionId: string): Promise<ForgeOutput> {
  const userPrompt = buildForgeUserPrompt(input);

  // Initialize all artifacts as queued
  const initial: ProgressMap = Object.fromEntries(
    ARTIFACT_SPECS.map((s) => [s.type, 'queued' as ArtifactStatus])
  ) as ProgressMap;
  forgeProgressStore.set(competitionId, initial);

  const generateArtifact = async (spec: ArtifactSpec): Promise<ForgeArtifact> => {
    // Mark as generating
    const prog = forgeProgressStore.get(competitionId);
    if (prog) prog[spec.type] = 'generating';

    try {
      const content = await runClaude(userPrompt, spec.systemPrompt);
      if (prog) prog[spec.type] = 'done';
      return { type: spec.type, title: spec.title, content, generatedAt: new Date().toISOString() };
    } catch (err) {
      if (prog) prog[spec.type] = 'error';
      throw err;
    }
  };

  try {
    // Generate all 6 artifacts in parallel
    const artifacts = await Promise.all(ARTIFACT_SPECS.map(generateArtifact));

    return {
      forgeModel: FORGE_MODEL_LABEL,
      artifacts,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    setTimeout(() => forgeProgressStore.delete(competitionId), 5 * 60 * 1000);
  }
}
