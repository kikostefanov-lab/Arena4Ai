import { spawn } from 'node:child_process';
import { randomUUID } from 'crypto';
import type { Brief, TeamPresentation, ForgeOutput, ForgeArtifact, ForgeArtifactType, ForgeOutputFormat, ForgeDomain, ForgeRun, ForgeSource } from '@arena/shared';
import { claudeEnv } from '../utils/claude-env.js';
import { extractJson } from '../utils/extract-json.js';

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
  source: ForgeSource;          // 'winner' | 'loser' | 'synthesis'
  sourceTeamId?: string;        // which team's deliverables to use
}

interface ArtifactSpec {
  type: ForgeArtifactType;
  title: string;
  systemPrompt: string;
  universal?: boolean;      // existing — preserve
  outputFormat: ForgeOutputFormat;  // NEW
  filename: string;                  // NEW
}

// ─── Universal artifacts (always generated) ───────────────────────────────────

const UNIVERSAL_SPECS: ArtifactSpec[] = [
  {
    type: 'executive_summary',
    title: 'Executive Summary',
    universal: true,
    outputFormat: 'markdown',
    filename: 'executive_summary.md',
    systemPrompt: `You are a senior strategist writing an executive summary of a competitive evaluation.

Given the competition results — the brief, team presentations, scores, and synthesis — produce a concise executive summary.

Include:
- What was evaluated and why it matters (2-3 sentences)
- Who won and what made the difference (decisive factor)
- Key strengths of each approach (1-2 bullet points per team)
- The single most important insight from this competition
- A one-paragraph recommendation for stakeholders

Keep the tone confident, clear, and jargon-free. Suitable for a C-suite audience who won't read further.

Output clean, well-structured Markdown.`,
  },
  {
    type: 'next_steps',
    title: 'Recommended Next Steps',
    universal: true,
    outputFormat: 'markdown',
    filename: 'next_steps.md',
    systemPrompt: `You are an action-oriented advisor creating a next steps plan based on competition results.

Given the competition context, produce a clear prioritized action plan.

Structure:
## Immediate (This Week)
2-4 concrete actions the team/individual should take right now based on these results.

## Near-Term (Next Month)
3-5 actions to build momentum and validate the direction.

## Strategic (3-6 Months)
2-3 bigger moves that these results are pointing toward.

## How to Use These Forge Documents
Explain specifically how to consume the other artifacts in this Forge package:
- Which document to share with which audience (e.g., "Share the Executive Summary with stakeholders")
- How to use these docs with AI tools: Claude.ai Projects (upload all artifacts as project knowledge for ongoing planning), Claude Code (use the task graph and repo blueprint as your coding spec), Cursor/Windsurf (drop artifacts as context)
- How to use them with a human team (kick-off meeting agenda, sprint planning input, etc.)

Be specific to the competition domain — don't give generic advice. Reference actual content from the brief and results.

Output clean, well-structured Markdown.`,
  },
  {
    type: 'tool_recommendations',
    title: 'Tool Recommendations',
    universal: true,
    outputFormat: 'markdown',
    filename: 'tool_recommendations.md',
    systemPrompt: `You are a tools and technology advisor recommending specific tools based on competition results.

Given the competition context, recommend concrete named tools — never generic categories like "a project management tool."

Structure each recommendation as:
| Category | Tool | Why This Fits | Getting Started |
|---|---|---|---|

Include 8-15 tools across relevant categories for this specific domain.

Always include a section "For Working with These Forge Documents" recommending:
- Claude.ai Projects — for uploading forge artifacts as project knowledge and having an ongoing AI conversation about them
- Claude Code — for using task graphs and blueprints as coding specs
- Notion or Obsidian — for organizing and sharing the markdown docs

Base every other recommendation on what the competition was actually about. For software: GitHub, CI tools, monitoring platforms, hosting. For research/procurement: CRMs, evaluation platforms. For presentations: Figma, Pitch, Canva. For strategy: Miro, Notion, Airtable. Etc.

Output clean Markdown with the table and short paragraphs per category.`,
  },
];

// ─── Domain artifact catalog ───────────────────────────────────────────────────

export const ARTIFACT_CATALOG: Record<string, ArtifactSpec> = {
  // Software development
  roadmap: {
    type: 'roadmap',
    title: 'Implementation Roadmap',
    outputFormat: 'markdown',
    filename: 'roadmap.md',
    systemPrompt: `You are a senior technical program manager creating an implementation roadmap.

Given the competition results, produce a phased delivery plan.

Include:
- 3-5 phases with clear milestones and success gates
- Effort estimates (days/weeks) per phase
- Dependencies between phases
- MVP scope (what ships first)
- Risk checkpoints between phases

Output clean, well-structured Markdown with headers, tables, and bullet lists.`,
  },
  task_graph: {
    type: 'task_graph',
    title: 'Task Dependency Graph',
    outputFormat: 'markdown',
    filename: 'task_graph.md',
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
  repo_blueprint: {
    type: 'repo_blueprint',
    title: 'Repository Blueprint',
    outputFormat: 'markdown',
    filename: 'repo_blueprint.md',
    systemPrompt: `You are a software architect creating a repository blueprint.

Given the competition results, design the directory structure and technology stack.

Include:
- Full directory tree with file descriptions
- Technology choices with rationale (language, framework, database, etc.)
- Package/module boundaries
- Configuration files needed
- Development tooling (linter, formatter, test framework, CI/CD)

Output as Markdown with code blocks for the directory tree.`,
  },
  api_contracts: {
    type: 'api_contracts',
    title: 'API Contracts',
    outputFormat: 'markdown',
    filename: 'api_contracts.md',
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
  risk_register: {
    type: 'risk_register',
    title: 'Risk Register',
    outputFormat: 'markdown',
    filename: 'risk_register.md',
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
  decision_log: {
    type: 'decision_log',
    title: 'Architectural Decision Log',
    outputFormat: 'markdown',
    filename: 'decision_log.md',
    systemPrompt: `You are a software architect documenting architectural decisions (ADRs).

Given the competition results, capture key decisions made and ones needed for implementation.

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

  // Research / procurement
  evaluation_matrix: {
    type: 'evaluation_matrix',
    title: 'Evaluation Matrix',
    outputFormat: 'markdown',
    filename: 'evaluation_matrix.md',
    systemPrompt: `You are an analyst creating a structured evaluation matrix.

Given the competition results — comparing approaches, services, vendors, or options — produce a comprehensive evaluation matrix.

Include:
- All evaluated options as columns
- Criteria as rows (drawn from the rubric and brief)
- Scores with brief rationale in each cell
- Weighted totals
- Recommendation section with clear rationale

Make the matrix actionable for a decision-maker who needs to justify the choice.

Output clean Markdown with tables.`,
  },
  vendor_scorecard: {
    type: 'vendor_scorecard',
    title: 'Vendor / Option Scorecard',
    outputFormat: 'markdown',
    filename: 'vendor_scorecard.md',
    systemPrompt: `You are a procurement analyst creating a detailed vendor or option scorecard.

Given the competition results, produce a deep-dive scorecard for each evaluated option.

For each option include:
- Overall score and ranking
- Strengths (3-5 bullet points)
- Weaknesses / gaps (3-5 bullet points)
- Best-fit scenarios (when to choose this)
- Red flags or deal-breakers
- Recommended next validation steps (e.g., pilot, reference check, demo)

Output clean Markdown with structured sections per option.`,
  },
  decision_framework: {
    type: 'decision_framework',
    title: 'Decision Framework',
    outputFormat: 'markdown',
    filename: 'decision_framework.md',
    systemPrompt: `You are a decision consultant creating a reusable decision framework.

Given the competition results, build a framework that can guide future decisions of this type.

Include:
- Key decision criteria (what matters most and why)
- Decision tree or flowchart (text-based) for similar future choices
- Must-have vs. nice-to-have checklist
- Common pitfalls to avoid (drawn from the losing approaches)
- How to validate the decision (what success looks like 30/90/180 days out)

Output clean Markdown with structured sections and a text-based decision tree.`,
  },

  // Creative / communications
  content_outline: {
    type: 'content_outline',
    title: 'Content Outline',
    outputFormat: 'markdown',
    filename: 'content_outline.md',
    systemPrompt: `You are a content strategist creating a detailed content outline.

Given the competition results, produce a comprehensive outline for the winning content approach.

Include:
- High-level structure with all major sections
- Key messages and supporting points per section
- Narrative arc / flow rationale
- Tone and voice guidelines
- Content gaps that need research or input
- Word count / time estimates per section

Output clean Markdown with nested bullet lists.`,
  },
  presentation_structure: {
    type: 'presentation_structure',
    title: 'Presentation Structure',
    outputFormat: 'markdown',
    filename: 'presentation_structure.md',
    systemPrompt: `You are a communications expert structuring a presentation.

Given the competition results (especially if this was a presentation-type competition), create a detailed presentation blueprint.

Include:
- Slide-by-slide outline (title, key message, supporting content, visual suggestion)
- Opening hook strategy
- Data / evidence to include per section
- Anticipated objections and how to address them
- Call to action and closing
- Speaker notes guidance for key slides

Output clean Markdown with a structured slide-by-slide breakdown.`,
  },
  messaging_guide: {
    type: 'messaging_guide',
    title: 'Messaging Guide',
    outputFormat: 'markdown',
    filename: 'messaging_guide.md',
    systemPrompt: `You are a messaging strategist creating a communications guide.

Given the competition results, produce a messaging guide for this topic or initiative.

Include:
- Core message (one sentence — the thing everyone must understand)
- Supporting messages (3-5 pillars)
- Audience-specific variations (tailor the message for each stakeholder type)
- Language to use and avoid
- Proof points and evidence
- FAQ with suggested responses to tough questions

Output clean Markdown with structured sections.`,
  },

  // Security / adversarial
  threat_model: {
    type: 'threat_model',
    title: 'Threat Model',
    outputFormat: 'markdown',
    filename: 'threat_model.md',
    systemPrompt: `You are a security architect creating a threat model.

Given the competition results (especially a red vs blue or security competition), produce a comprehensive threat model.

Include:
- System / scope definition
- Assets to protect
- Threat actors (who might attack and why)
- Attack vectors identified during the competition
- STRIDE analysis (Spoofing, Tampering, Repudiation, Information Disclosure, DoS, Elevation of Privilege) where applicable
- Prioritized threat scenarios (likelihood × impact)
- Security controls recommended

Output clean Markdown with tables and structured sections.`,
  },
  attack_surface: {
    type: 'attack_surface',
    title: 'Attack Surface Analysis',
    outputFormat: 'markdown',
    filename: 'attack_surface.md',
    systemPrompt: `You are a penetration tester documenting an attack surface analysis.

Given the competition results, document the attack surface identified.

Include:
- Entry points discovered (network, application, physical, human)
- Vulnerabilities identified with severity ratings (Critical/High/Medium/Low)
- Exploitation paths (step-by-step for key findings)
- Evidence and artifacts from the competition
- Quick wins (low effort, high impact fixes)
- Long-term hardening roadmap

Output clean Markdown with structured findings in a security report format.`,
  },
  remediation_plan: {
    type: 'remediation_plan',
    title: 'Remediation Plan',
    outputFormat: 'markdown',
    filename: 'remediation_plan.md',
    systemPrompt: `You are a security engineer creating a remediation plan.

Given the security competition results, produce a prioritized remediation plan.

Include:
- Findings summary table (ID, severity, title, status)
- Detailed remediation steps per finding
- Prioritization rationale (what to fix first and why)
- Effort estimates
- Verification steps (how to confirm each fix worked)
- Regression testing recommendations
- Timeline for a 30/60/90-day remediation sprint

Output clean Markdown with tables and structured sections.`,
  },

  // Business / strategy
  business_case: {
    type: 'business_case',
    title: 'Business Case',
    outputFormat: 'markdown',
    filename: 'business_case.md',
    systemPrompt: `You are a business analyst writing a business case document.

Given the competition results, produce a compelling business case for the winning approach.

Include:
- Problem statement and opportunity
- Proposed solution (based on competition winner)
- Benefits: quantitative (ROI, cost savings, revenue potential) and qualitative
- Costs and resource requirements
- Risks and mitigations
- Alternatives considered (with brief rationale for rejection)
- Recommendation and ask

Keep it concise and evidence-based. Suitable for a budget-holder audience.

Output clean Markdown with headers and tables.`,
  },
  go_to_market: {
    type: 'go_to_market',
    title: 'Go-to-Market Plan',
    outputFormat: 'markdown',
    filename: 'go_to_market.md',
    systemPrompt: `You are a GTM strategist creating a go-to-market plan.

Given the competition results, produce a practical GTM plan for bringing the winning approach to market or to stakeholders.

Include:
- Target audience definition (primary and secondary)
- Value proposition statement
- Positioning vs. alternatives
- Channels and tactics (prioritized)
- Launch sequence (pre-launch, launch, post-launch)
- Success metrics and KPIs
- Budget considerations

Output clean Markdown with structured sections.`,
  },
  stakeholder_map: {
    type: 'stakeholder_map',
    title: 'Stakeholder Map',
    outputFormat: 'markdown',
    filename: 'stakeholder_map.md',
    systemPrompt: `You are an organizational consultant creating a stakeholder map.

Given the competition context, identify and map all relevant stakeholders.

For each stakeholder group include:
- Role / title
- Interest in this outcome (what they care about)
- Influence level (High / Medium / Low)
- Current stance (Champion / Neutral / Skeptic)
- Engagement strategy (how to bring them along)
- Key messages for this audience

Include a 2×2 influence/interest matrix (text-based).

Output clean Markdown with tables and a text-based matrix.`,
  },

  // Ideation / exploration
  concept_canvas: {
    type: 'concept_canvas',
    title: 'Concept Canvas',
    outputFormat: 'markdown',
    filename: 'concept_canvas.md',
    systemPrompt: `You are an innovation facilitator creating a concept canvas.

Given the competition results (especially an ideation or exploratory competition), produce a structured concept canvas for the winning idea.

Include:
- Concept name and one-liner
- Problem it solves (customer/user perspective)
- Key insight that makes this work
- Solution approach (how it works)
- Unique differentiators (why this vs. alternatives)
- Assumptions to validate (what must be true for this to succeed)
- Next experiments to run (smallest tests to validate core assumptions)

Format as a visual canvas using Markdown tables and sections.`,
  },
  mvp_definition: {
    type: 'mvp_definition',
    title: 'MVP Definition',
    outputFormat: 'markdown',
    filename: 'mvp_definition.md',
    systemPrompt: `You are a product manager defining an MVP.

Given the competition results, define the Minimum Viable Product or Minimum Viable Approach.

Include:
- Core value hypothesis (what value must the MVP prove)
- In-scope features / capabilities (ruthlessly minimal)
- Out-of-scope (explicitly stated, with rationale)
- Success criteria (how you'll know the MVP worked)
- Build vs. buy vs. borrow decisions
- Timeline estimate for MVP
- Who should build/own it

Output clean Markdown with structured sections.`,
  },
  hypothesis_backlog: {
    type: 'hypothesis_backlog',
    title: 'Hypothesis Backlog',
    outputFormat: 'markdown',
    filename: 'hypothesis_backlog.md',
    systemPrompt: `You are a lean startup practitioner creating a hypothesis backlog.

Given the competition results, produce a structured backlog of hypotheses to test.

Format each hypothesis as:
- ID (H001, etc.)
- We believe [assumption]
- For [target user/stakeholder]
- Will result in [measurable outcome]
- We will know this is true when [validation signal]
- Test method: [how to test — survey, prototype, A/B test, etc.]
- Effort: Low / Medium / High
- Priority: P0 / P1 / P2

Group hypotheses by theme (e.g., Problem, Solution, Market, Business Model).

Output clean Markdown with structured tables.`,
  },

  // Structured / domain-specific outputs
  sql_schema: {
    type: 'sql_schema',
    title: 'Database Schema (SQL)',
    outputFormat: 'sql',
    filename: 'schema.sql',
    systemPrompt: `You are a database architect generating a production-ready SQL schema.

Given the competition results (especially the winning team's code and API contracts), produce a complete SQL schema.

Requirements:
- Use PostgreSQL syntax
- Include CREATE TABLE statements with all columns, types, and constraints
- Add indexes for foreign keys and commonly queried columns
- Include comments on each table explaining its purpose
- Output raw SQL only — no markdown fences, no explanation text

The output must be valid SQL that can be piped directly to psql.`,
  },
  environment_template: {
    type: 'environment_template',
    title: 'Environment Variables Template',
    outputFormat: 'text',
    filename: '.env.example',
    systemPrompt: `You are a DevOps engineer creating a .env.example template.

Given the competition results, identify all environment variables the solution requires.

For each variable include:
- The variable name in SCREAMING_SNAKE_CASE
- A comment explaining what it is and where to get the value
- A safe placeholder value (never a real secret)

Output format: raw .env file content only. Example:
# Database connection string
DATABASE_URL=postgresql://localhost/myapp

No markdown, no JSON wrapper — just the .env file content.`,
  },
  slide_deck: {
    type: 'slide_deck',
    title: 'Presentation Slide Deck',
    outputFormat: 'markdown',
    filename: 'slide_deck.md',
    systemPrompt: `You are a presentation expert creating a complete slide deck outline with full copy.

Given the competition results (especially if this was a creative or communications brief), create a ready-to-build slide deck.

For each slide provide:
- Slide number and title
- Headline (the one sentence a viewer should remember)
- 3-5 bullet points or body copy
- Visual suggestion (what image, chart, or diagram would work here)
- Speaker notes (2-3 sentences for the presenter)

Create 10-15 slides. Include: title slide, agenda, problem statement, solution overview, key evidence slides, differentiators, call to action, and closing.

Output clean, well-structured Markdown. Each slide as a ## heading.`,
  },
  spreadsheet_export: {
    type: 'spreadsheet_export',
    title: 'Decision Matrix (Spreadsheet)',
    outputFormat: 'csv',
    filename: 'data.csv',
    systemPrompt: `You are a data analyst creating a spreadsheet-ready decision matrix.

Given the competition results (especially for research or procurement briefs), produce a structured CSV comparison matrix.

Format:
- First row: column headers (Option/Vendor names)
- First column: evaluation criteria (from rubric)
- Body cells: scores (1-10) with a brief justification in parentheses
- Final rows: weighted totals and recommendation

Output: raw CSV only — no markdown fences. The output must open correctly in Excel or Google Sheets.

Example format:
Criteria,Option A,Option B,Option C
Performance,9 (fast response),7 (moderate),6 (slow)
...
TOTAL (weighted),8.2,6.8,5.9`,
  },

  // New Sprint 4 entries
  dockerfile: {
    type: 'dockerfile',
    title: 'Dockerfile',
    outputFormat: 'dockerfile',
    filename: 'Dockerfile',
    systemPrompt: `You are a DevOps expert. Generate a production-ready multi-stage Dockerfile based on the competition brief and any code context provided.
Requirements:
- Use an appropriate base image for the language/framework
- Stage 1: build/compile dependencies
- Stage 2: minimal runtime image
- Expose the correct port
- Set a sensible CMD/ENTRYPOINT`,
  },

  github_actions: {
    type: 'github_actions',
    title: 'CI Pipeline',
    outputFormat: 'yaml',
    filename: '.github/workflows/ci.yml',
    systemPrompt: `You are a DevOps expert. Generate a GitHub Actions CI workflow for the project described in the competition brief.
Requirements:
- Trigger on push and pull_request to main
- Install dependencies
- Run tests
- Run a build step if applicable
- Use appropriate language/runtime versions`,
  },

  gantt_timeline: {
    type: 'gantt_timeline',
    title: 'Project Timeline',
    outputFormat: 'markdown',
    filename: 'gantt_timeline.md',
    systemPrompt: `You are a project manager. Generate a Mermaid gantt chart as a markdown document showing key milestones and phases for this project.
Requirements:
- Extract real milestones and phases from the brief and competition context
- Include at least 3 sections (phases) with named tasks and durations
- Use realistic date ranges
Format: a markdown document with a single mermaid gantt code block, followed by a brief legend.`,
  },
};

// ─── Domain defaults (fallback if AI selection fails) ─────────────────────────

const FORMAT_DOMAIN_DEFAULTS: Record<string, { domain: ForgeDomain; types: ForgeArtifactType[] }> = {
  SPRINT:      { domain: 'software',  types: ['roadmap', 'task_graph', 'repo_blueprint', 'api_contracts'] },
  HACKATHON:   { domain: 'software',  types: ['roadmap', 'task_graph', 'repo_blueprint', 'decision_log'] },
  RELAY_RACE:  { domain: 'software',  types: ['roadmap', 'task_graph', 'decision_log', 'risk_register'] },
  RED_VS_BLUE: { domain: 'security',  types: ['threat_model', 'attack_surface', 'remediation_plan', 'risk_register'] },
  BRAINSTORM:  { domain: 'ideation',  types: ['concept_canvas', 'mvp_definition', 'hypothesis_backlog', 'decision_framework'] },
  RESEARCH:    { domain: 'research',  types: ['evaluation_matrix', 'vendor_scorecard', 'decision_framework', 'decision_log'] },
  PITCH:       { domain: 'creative',  types: ['presentation_structure', 'messaging_guide', 'content_outline', 'concept_canvas'] },
};

/**
 * Default artifact types per ForgeDomain.
 * Pre-populated for Sprint 2's selectDomainArtifacts() expansion and brief.domainHint support.
 */
export const DOMAIN_TYPE_DEFAULTS: Record<ForgeDomain, ForgeArtifactType[]> = {
  software:  ['roadmap', 'sql_schema', 'environment_template', 'dockerfile', 'github_actions', 'api_contracts'],
  research:  ['evaluation_matrix', 'spreadsheet_export', 'decision_framework', 'decision_log'],
  creative:  ['slide_deck', 'concept_canvas', 'messaging_guide'],
  business:  ['roadmap', 'gantt_timeline', 'risk_register', 'decision_log'],
  ideation:  ['concept_canvas', 'mvp_definition', 'hypothesis_backlog', 'decision_framework'],
  security:  ['risk_register', 'api_contracts', 'repo_blueprint', 'decision_log'],
};

const GENERIC_DEFAULT: { domain: ForgeDomain; types: ForgeArtifactType[] } = {
  domain: 'software',
  types: ['roadmap', 'task_graph', 'repo_blueprint', 'api_contracts'],
};

// ─── AI domain selection ──────────────────────────────────────────────────────

const DOMAIN_SELECTION_SYSTEM_PROMPT = `You are a classifier. Given a competition brief, select the most relevant domain and 3-4 artifact types to generate.

Available domains and their artifact types:
- software: roadmap, sql_schema, environment_template, dockerfile, github_actions, api_contracts
- research: evaluation_matrix, spreadsheet_export, decision_framework, decision_log
- creative: slide_deck, concept_canvas, messaging_guide
- business: roadmap, gantt_timeline, risk_register, decision_log
- ideation: concept_canvas, mvp_definition, hypothesis_backlog, decision_framework
- security: risk_register, api_contracts, repo_blueprint, decision_log

Respond ONLY with a JSON object. No explanation, no markdown, just JSON:
{"domain":"<domain>","types":["<type1>","<type2>","<type3>","<type4>"]}

Select 3-4 types that are most useful given what this competition was about.`;

export async function selectDomainArtifacts(brief: Brief): Promise<{ domain: ForgeDomain; types: ForgeArtifactType[] }> {
  // Path 1: explicit domainHint — short-circuit, no AI call
  if (brief.domainHint) {
    const types = DOMAIN_TYPE_DEFAULTS[brief.domainHint] ?? GENERIC_DEFAULT.types;
    return { domain: brief.domainHint, types };
  }

  // Path 2: deliverableType hint — seed the AI selection prompt
  const TYPE_TO_DOMAIN: Record<string, ForgeDomain> = {
    code:         'software',
    document:     'creative',
    analysis:     'research',
    presentation: 'creative',
    plan:         'business',
    // 'mixed' intentionally omitted — falls through to unguided AI selection
  };
  const deliverableTypeHint = brief.deliverableType && brief.deliverableType !== 'mixed'
    ? `\nNote: The brief's deliverable type is "${brief.deliverableType}", suggesting a ${TYPE_TO_DOMAIN[brief.deliverableType]} domain focus.`
    : '';

  const fallback = FORMAT_DOMAIN_DEFAULTS[brief.format ?? ''] ?? GENERIC_DEFAULT;

  const selectionPrompt = `Competition brief:
Title: ${brief.title}
Format: ${brief.format ?? 'unspecified'}
Problem: ${brief.problem}
Deliverables: ${brief.deliverables?.join(', ') ?? 'unspecified'}${deliverableTypeHint}`;

  try {
    const raw = await runClaude(selectionPrompt, DOMAIN_SELECTION_SYSTEM_PROMPT, 60_000);
    const json = JSON.parse(extractJson(raw)) as { domain: ForgeDomain; types: ForgeArtifactType[] };

    // Validate response
    const validDomains: ForgeDomain[] = ['software', 'research', 'creative', 'security', 'business', 'ideation'];
    const validTypes = new Set(Object.keys(ARTIFACT_CATALOG));

    if (!validDomains.includes(json.domain)) return GENERIC_DEFAULT;
    const types = (json.types ?? []).filter((t) => validTypes.has(t)).slice(0, 4) as ForgeArtifactType[];
    if (types.length === 0) return GENERIC_DEFAULT;

    return { domain: json.domain, types };
  } catch {
    return GENERIC_DEFAULT;
  }
}

// ─── Format-aware prompt builder ─────────────────────────────────────────────

export function buildPrompt(spec: ArtifactSpec): string {
  const formatInstructions: Partial<Record<ForgeOutputFormat, string>> = {
    sql:        'Respond with raw SQL DDL only — no markdown fences, no explanations.',
    csv:        'Respond with raw CSV only — a header row followed by data rows. No markdown fences.',
    yaml:       'Respond with raw YAML only — no markdown fences.',
    dockerfile: 'Respond with a raw Dockerfile only — no markdown fences, no explanations.',
    text:       'Respond with the file contents only — no markdown fences, no explanations.',
  };
  const extra = formatInstructions[spec.outputFormat];
  return extra ? `${spec.systemPrompt}\n\n${extra}` : spec.systemPrompt;
}

// ─── Deliverable file formatter ───────────────────────────────────────────────

export const MAX_TOTAL_BYTES = 40_000;

export function formatDeliverableFiles(
  deliverables: Array<{ teamId: string; files: { path: string; content: string }[] }>
): string {
  let total = 0;
  const lines: string[] = [];
  for (const teamDels of deliverables) {
    for (const file of teamDels.files) {
      if (total >= MAX_TOTAL_BYTES) break;
      const truncated = file.content.length > 6000
        ? file.content.slice(0, 6000) + '\n... [truncated]'
        : file.content;
      lines.push(`--- ${file.path} ---\n${truncated}`);
      total += truncated.length;
    }
  }
  return lines.join('\n\n');
}

// ─── User prompt builder ──────────────────────────────────────────────────────

function buildForgeUserPrompt(input: ForgeInput, primaryDeliverables: Array<{ teamId: string; files: { path: string; content: string }[] }>, synthesisContext: string): string {
  const { brief, presentations, synthesis, winner } = input;
  const sections: string[] = [];

  sections.push(`# Original Brief\n\n**Title:** ${brief.title}\n**Problem:** ${brief.problem}\n**Constraints:** ${brief.constraints.join(', ')}`);

  if (brief.rubric?.criteria) {
    sections.push(`## Judging Criteria\n${brief.rubric.criteria.map((c) => `- **${c.id}** (weight ${c.weight}): ${c.description}`).join('\n')}`);
  }

  const winnerPres = presentations.find((p) => p.teamId === winner.teamId);
  if (winnerPres) {
    sections.push(`# Winning Team Presentation (${winner.model})\n\n**Approach:** ${winnerPres.approach}\n**Key Insight:** ${winnerPres.keyInsight}\n**Deliverables:** ${winnerPres.deliverableSummary}`);
    if (winnerPres.criterionFindings.length > 0) {
      sections.push(`## Criterion Findings\n${winnerPres.criterionFindings.map((cf) => `- **${cf.criterionId}**: ${cf.finding}${cf.strength ? ` (+) ${cf.strength}` : ''}${cf.gap ? ` (-) ${cf.gap}` : ''}`).join('\n')}`);
    }
  }

  const otherPres = presentations.filter((p) => p.teamId !== winner.teamId);
  if (otherPres.length > 0) {
    sections.push(`# Other Team Presentations\n${otherPres.map((p) => `## ${p.teamId} (${p.model})\n**Approach:** ${p.approach}\n**Key Insight:** ${p.keyInsight}`).join('\n\n')}`);
  }

  if (synthesis && !synthesisContext) {
    sections.push(`# Synthesis (Best of All Teams)\n\n${synthesis.synthesis}`);
    if (synthesis.perCriterion.length > 0) {
      sections.push(`## Per-Criterion Winners\n${synthesis.perCriterion.map((pc) => `- **${pc.criterionId}**: ${pc.teamId} — ${pc.rationale}`).join('\n')}`);
    }
  }

  if (synthesisContext) {
    sections.push(`# Synthesis (Primary Context)${synthesisContext}`);
  }

  const fileSection = formatDeliverableFiles(primaryDeliverables);
  if (fileSection) {
    sections.push(`# Deliverables\n\n${fileSection}`);
  }

  return sections.join('\n\n---\n\n');
}

// ─── Claude runner ────────────────────────────────────────────────────────────

const FORGE_MODEL_LABEL = 'claude-cli';

function runClaude(prompt: string, systemPrompt: string, timeoutMs = 120_000): Promise<string> {
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
      reject(new Error(`Claude CLI timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

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

// ─── Starter kit generator ───────────────────────────────────────────────────

export async function generateStarterKit(
  brief: Brief,
  primaryDeliverables: Array<{ teamId: string; files: { path: string; content: string }[] }>
): Promise<ForgeArtifact[] | null> {
  const starterKitSystemPrompt = `You are generating a production-ready project starter kit from an AI hackathon winner.
Generate three artifacts:
1. A cleaned, well-commented reference implementation in the same language(s) — runnable, not pseudocode
2. A test suite template with meaningful test cases based on actual function/class signatures
3. A project README with setup instructions, usage examples, and extension notes

Respond with a single JSON object:
{
  "src": { "filename": "file contents" },
  "tests": { "filename": "file contents" },
  "readme": "README.md contents"
}`;

  const fileSection = formatDeliverableFiles(primaryDeliverables);
  const starterKitUserPrompt = `BRIEF TITLE: ${brief.title}
BRIEF PROBLEM: ${brief.problem}

WINNING CODE:
${fileSection}`;

  try {
    const raw = await runClaude(starterKitUserPrompt, starterKitSystemPrompt, 120_000);
    const json = JSON.parse(extractJson(raw)) as {
      src: Record<string, string>;
      tests: Record<string, string>;
      readme: string;
    };

    const generatedAt = new Date().toISOString();
    return [
      {
        type: 'reference_implementation',
        title: 'Reference Implementation',
        content: JSON.stringify(json.src),
        outputFormat: 'text',
        filename: 'src/',
        generatedAt,
      },
      {
        type: 'test_suite_template',
        title: 'Test Suite Template',
        content: JSON.stringify(json.tests),
        outputFormat: 'text',
        filename: 'tests/',
        generatedAt,
      },
      {
        type: 'project_readme',
        title: 'README',
        content: json.readme,
        outputFormat: 'markdown',
        filename: 'README.md',
        generatedAt,
      },
    ];
  } catch (err) {
    console.error('[generateStarterKit] failed:', err);
    return null;
  }
}

// ─── Main forge orchestrator ──────────────────────────────────────────────────

export async function runForge(input: ForgeInput, competitionId: string): Promise<ForgeRun> {
  // Select primary deliverables based on source
  const primaryDeliverables = input.source === 'synthesis'
    ? input.deliverables  // all teams as background
    : input.deliverables.filter(d => d.teamId === input.sourceTeamId);

  const synthesisContext = input.source === 'synthesis' && input.synthesis
    ? `\n\n## Synthesis\n${input.synthesis.synthesis}`
    : '';

  const userPrompt = buildForgeUserPrompt(input, primaryDeliverables, synthesisContext);

  // Step 1: select domain artifacts (short timeout — fallback available)
  const { domain, types: selectedTypes } = await selectDomainArtifacts(input.brief);

  // Resolve domain artifact specs
  const domainSpecs: ArtifactSpec[] = selectedTypes
    .map((t) => ARTIFACT_CATALOG[t])
    .filter(Boolean);

  // All specs = universals first, then domain
  const allSpecs: ArtifactSpec[] = [...UNIVERSAL_SPECS, ...domainSpecs];

  // Initialize progress store
  const initial: ProgressMap = Object.fromEntries(
    allSpecs.map((s) => [s.type, 'queued' as ArtifactStatus])
  ) as ProgressMap;
  forgeProgressStore.set(competitionId, initial);

  const generateArtifact = async (spec: ArtifactSpec): Promise<ForgeArtifact> => {
    const prog = forgeProgressStore.get(competitionId);
    if (prog) prog[spec.type] = 'generating';

    try {
      const content = await runClaude(userPrompt, buildPrompt(spec));
      if (prog) prog[spec.type] = 'done';
      return {
        type: spec.type,
        title: spec.title,
        content,
        generatedAt: new Date().toISOString(),
        universal: spec.universal ?? false,
        outputFormat: spec.outputFormat,
        filename: spec.filename,
      };
    } catch (err) {
      if (prog) prog[spec.type] = 'error';
      throw err;
    }
  };

  try {
    const shouldRunStarterKit =
      (input.brief.deliverableType === 'code' || !input.brief.deliverableType) &&
      (input.source === 'winner' || input.source === 'loser') &&
      primaryDeliverables.length > 0 &&
      primaryDeliverables.some(d => d.files.length > 0);

    // Run domain artifacts and starter kit in parallel to minimise wall-clock time.
    const [domainArtifacts, kitArtifacts] = await Promise.all([
      Promise.all(allSpecs.map(generateArtifact)),
      shouldRunStarterKit ? generateStarterKit(input.brief, primaryDeliverables) : Promise.resolve(null),
    ]);

    const artifacts = kitArtifacts ? [...domainArtifacts, ...kitArtifacts] : domainArtifacts;

    return {
      id: randomUUID(),
      source: input.source,
      sourceTeamId: input.sourceTeamId,
      forgeModel: FORGE_MODEL_LABEL,
      artifacts,
      generatedAt: new Date().toISOString(),
      domain,
      selectedTypes,
    };
  } finally {
    setTimeout(() => forgeProgressStore.delete(competitionId), 5 * 60 * 1000);
  }
}
