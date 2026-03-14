// ─── Domain-aware brief generation templates ────────────────────────────────

export type BriefDomain =
  | 'software'
  | 'business'
  | 'research'
  | 'creative'
  | 'strategy'
  | 'security'
  | 'ideation';

export type DeliverableType = 'code' | 'document' | 'analysis' | 'presentation' | 'plan' | 'mixed';

export interface DomainTemplate {
  domain: BriefDomain;
  systemFocus: string;
  deliverableType: DeliverableType;
  exemplarCriteria: { id: string; description: string; weight: number }[];
  antiPatterns: string[];
  deliverableHints: string[];
  defaultTimeLimitMs: number;
}

export const DOMAIN_TEMPLATES: Record<BriefDomain, DomainTemplate> = {
  software: {
    domain: 'software',
    systemFocus:
      'A software engineering competition. Agents build working code that solves a concrete problem. ' +
      'Focus on architecture decisions, correctness under edge cases, and clean separation of concerns.',
    deliverableType: 'code',
    exemplarCriteria: [
      { id: 'edge-case-handling', description: 'Handles boundary inputs, empty sets, overflow, and malformed data gracefully', weight: 0.4 },
      { id: 'architectural-clarity', description: 'Clear module boundaries, single-responsibility functions, minimal coupling between components', weight: 0.35 },
      { id: 'error-propagation', description: 'Errors are surfaced with actionable context rather than swallowed or generic', weight: 0.25 },
    ],
    antiPatterns: [
      'Do NOT generate criteria like "code quality" or "completeness" — these are generic and unscoreable.',
      'Do NOT ask for "well-tested code" as a constraint — that is a deliverable expectation, not a constraint.',
      'Avoid vague deliverables like "solution file" — name specific files with extensions.',
    ],
    deliverableHints: ['solution.ts', 'solution.py', 'main.go', 'README.md'],
    defaultTimeLimitMs: 5 * 60 * 1000, // 5 minutes
  },

  business: {
    domain: 'business',
    systemFocus:
      'A business analysis competition. Agents produce data-driven analyses, financial models, or strategic recommendations. ' +
      'Focus on quantitative reasoning, market feasibility, and grounded assumptions.',
    deliverableType: 'analysis',
    exemplarCriteria: [
      { id: 'quantitative-grounding', description: 'Claims are backed by specific numbers, ranges, or cited benchmarks rather than qualitative hand-waving', weight: 0.4 },
      { id: 'assumption-transparency', description: 'Key assumptions are explicitly stated and sensitivity to each is addressed', weight: 0.35 },
      { id: 'actionability', description: 'Recommendations include concrete next steps with owners, timelines, and success metrics', weight: 0.25 },
    ],
    antiPatterns: [
      'Do NOT generate criteria like "thoroughness" or "professionalism" — these are unmeasurable.',
      'Avoid constraints like "must be accurate" — all analysis should be accurate; this adds nothing.',
      'Do NOT ask for generic SWOT or Porter\'s Five Forces unless the brief specifically calls for it.',
    ],
    deliverableHints: ['analysis.md', 'model.csv', 'recommendations.md', 'assumptions.yaml'],
    defaultTimeLimitMs: 45 * 60 * 1000, // 45 minutes
  },

  research: {
    domain: 'research',
    systemFocus:
      'A research methodology competition. Agents produce literature reviews, experiment designs, or evidence syntheses. ' +
      'Focus on methodological rigor, evidence quality, and intellectual honesty about limitations.',
    deliverableType: 'document',
    exemplarCriteria: [
      { id: 'methodological-rigor', description: 'Research design controls for confounds, specifies sample/scope, and acknowledges selection bias', weight: 0.4 },
      { id: 'evidence-quality', description: 'Claims cite specific studies/data with effect sizes or confidence intervals, not just "research shows"', weight: 0.35 },
      { id: 'limitation-honesty', description: 'Explicitly identifies what the analysis cannot conclude and where evidence is thin', weight: 0.25 },
    ],
    antiPatterns: [
      'Do NOT generate criteria like "research quality" or "depth of analysis" — these are tautological.',
      'Avoid asking agents to "be thorough" — specify what thoroughness means in this context.',
      'Do NOT conflate literature review with original research — be clear about which is expected.',
    ],
    deliverableHints: ['report.md', 'methodology.md', 'findings.md', 'references.yaml'],
    defaultTimeLimitMs: 60 * 60 * 1000, // 60 minutes
  },

  creative: {
    domain: 'creative',
    systemFocus:
      'A creative production competition. Agents write copy, design narratives, build brand identities, or craft content. ' +
      'Focus on originality, tonal consistency, and purposeful craft choices.',
    deliverableType: 'document',
    exemplarCriteria: [
      { id: 'voice-consistency', description: 'Maintains a distinct, coherent voice throughout — word choice, sentence rhythm, and register are deliberate', weight: 0.4 },
      { id: 'originality-of-framing', description: 'Approaches the topic from an unexpected angle rather than the obvious first-draft take', weight: 0.35 },
      { id: 'purposeful-structure', description: 'Document structure serves the content — pacing, reveals, and emphasis are intentional, not boilerplate', weight: 0.25 },
    ],
    antiPatterns: [
      'Do NOT generate criteria like "creativity" or "writing quality" — these are circular.',
      'Avoid constraints like "must be engaging" — define what engagement looks like for this piece.',
      'Do NOT over-specify format for creative work — let agents make structural choices.',
    ],
    deliverableHints: ['draft.md', 'narrative.md', 'brand-guide.md', 'copy.txt'],
    defaultTimeLimitMs: 30 * 60 * 1000, // 30 minutes
  },

  strategy: {
    domain: 'strategy',
    systemFocus:
      'A strategic planning competition. Agents design systems, roadmaps, or organizational plans. ' +
      'Focus on systems thinking, explicit tradeoff reasoning, and implementability.',
    deliverableType: 'plan',
    exemplarCriteria: [
      { id: 'tradeoff-reasoning', description: 'Explicitly names what is sacrificed for each recommendation and why the tradeoff is acceptable', weight: 0.4 },
      { id: 'systems-awareness', description: 'Identifies second-order effects, feedback loops, and cross-functional dependencies', weight: 0.35 },
      { id: 'implementation-specificity', description: 'Plan includes sequencing, resource estimates, and risk triggers — not just goals', weight: 0.25 },
    ],
    antiPatterns: [
      'Do NOT generate criteria like "strategic thinking" or "comprehensiveness" — define what good looks like.',
      'Avoid constraints like "must be realistic" — specify the realism boundaries (budget, timeline, team size).',
      'Do NOT reward length — a focused 2-page plan beats a vague 10-page one.',
    ],
    deliverableHints: ['strategy.md', 'roadmap.yaml', 'tradeoffs.md', 'implementation-plan.md'],
    defaultTimeLimitMs: 60 * 60 * 1000, // 60 minutes
  },

  security: {
    domain: 'security',
    systemFocus:
      'A security engineering competition. Agents perform threat modeling, design defenses, or audit systems. ' +
      'Focus on threat enumeration, defense-in-depth reasoning, and attack surface awareness.',
    deliverableType: 'mixed',
    exemplarCriteria: [
      { id: 'threat-enumeration', description: 'Identifies specific attack vectors with STRIDE/ATT&CK categories, not just "could be hacked"', weight: 0.4 },
      { id: 'defense-layering', description: 'Proposes mitigations at multiple layers (network, application, data) with fallback when one fails', weight: 0.35 },
      { id: 'attack-surface-mapping', description: 'Explicitly maps trust boundaries, data flows, and entry points before proposing fixes', weight: 0.25 },
    ],
    antiPatterns: [
      'Do NOT generate criteria like "security awareness" — that is what the entire brief is about.',
      'Avoid "must follow best practices" as a constraint — name the specific practices.',
      'Do NOT conflate compliance (SOC2, ISO) with actual security posture.',
    ],
    deliverableHints: ['threat-model.md', 'mitigations.yaml', 'audit-report.md', 'attack-surface.md'],
    defaultTimeLimitMs: 45 * 60 * 1000, // 45 minutes
  },

  ideation: {
    domain: 'ideation',
    systemFocus:
      'An ideation and concept design competition. Agents generate novel concepts, validate hypotheses, or design MVPs. ' +
      'Focus on concept clarity, hypothesis quality, and path to validation.',
    deliverableType: 'plan',
    exemplarCriteria: [
      { id: 'hypothesis-precision', description: 'Core hypothesis is stated as a falsifiable claim with clear success/failure criteria', weight: 0.4 },
      { id: 'mvp-scoping', description: 'Proposed MVP tests the riskiest assumption first with minimum build effort', weight: 0.35 },
      { id: 'concept-distinctness', description: 'Articulates how this differs from existing solutions with specific comparison points', weight: 0.25 },
    ],
    antiPatterns: [
      'Do NOT generate criteria like "innovation" or "creativity" — measure the output, not the intent.',
      'Avoid "must be novel" as a constraint — define the comparison set.',
      'Do NOT reward breadth of ideas over depth of the best one.',
    ],
    deliverableHints: ['concept.md', 'hypotheses.yaml', 'mvp-spec.md', 'validation-plan.md'],
    defaultTimeLimitMs: 30 * 60 * 1000, // 30 minutes
  },
};

// ─── Prompt builders ─────────────────────────────────────────────────────────

/**
 * Build a prompt that classifies the user's rough idea into a domain
 * and generates 1-3 targeted follow-up questions.
 */
export function buildIntakePrompt(idea: string): string {
  const domainList = Object.entries(DOMAIN_TEMPLATES)
    .map(([k, v]) => `  - "${k}": ${v.systemFocus.split('.')[0]}`)
    .join('\n');

  return `You are a competition brief designer for Arena4Ai, a platform where AI agents compete head-to-head.

A user has described a rough idea for a competition. Your job is to:
1. Classify which domain best fits their idea
2. Ask 1-3 targeted follow-up questions that would make the brief more specific and scoreable

Domains:
${domainList}

User's idea: "${idea.trim()}"

Return ONLY valid JSON (no markdown, no preamble):
{
  "detectedDomain": "<one of: software, business, research, creative, strategy, security, ideation>",
  "detectedDeliverableType": "<one of: code, document, analysis, presentation, plan, mixed>",
  "questions": [
    "Question 1 — ask about something that would make scoring criteria more specific",
    "Question 2 — ask about constraints, scope, or expected deliverable format"
  ]
}

Rules:
- Questions should be SHORT (one sentence each)
- Ask about things that distinguish a mediocre brief from a great one
- Do NOT ask generic questions like "what language?" — infer from context
- Maximum 3 questions`;
}

/**
 * Build a domain-aware brief generation prompt using the template,
 * the user's idea, their answers to intake questions, and optional
 * learnings from past competitions.
 */
export function buildGenerationPrompt(
  idea: string,
  answers: Record<string, string> | string[],
  template: DomainTemplate,
  learnings?: string[],
): string {
  const answersText = Array.isArray(answers)
    ? answers.map((a, i) => `  ${i + 1}. ${a}`).join('\n')
    : Object.entries(answers).map(([q, a]) => `  Q: ${q}\n  A: ${a}`).join('\n\n');

  const exemplarText = template.exemplarCriteria
    .map((c) => `    { "id": "${c.id}", "description": "${c.description}", "maxScore": 10, "weight": ${c.weight} }`)
    .join(',\n');

  const antiPatternText = template.antiPatterns.map((p) => `- ${p}`).join('\n');

  const learningsText = learnings?.length
    ? `\nLearnings from past competitions in this domain:\n${learnings.map((l) => `- ${l}`).join('\n')}\n`
    : '';

  return `You are a competition brief writer for Arena4Ai, a platform where AI agents compete head-to-head on structured challenges.

DOMAIN: ${template.domain}
FOCUS: ${template.systemFocus}

User's idea: "${idea.trim()}"

User's answers to intake questions:
${answersText}
${learningsText}
Generate a structured competition brief. Return ONLY valid JSON (no markdown, no preamble):
{
  "id": "<kebab-case-slug>",
  "title": "<short compelling title, 5-8 words>",
  "problem": "<detailed 3-6 sentence problem statement — be specific about inputs, outputs, success criteria>",
  "constraints": ["<real constraint 1>", "<real constraint 2>", "<real constraint 3>"],
  "deliverables": ${JSON.stringify(template.deliverableHints)},
  "rubric": {
    "criteria": [
${exemplarText}
    ]
  },
  "format": "SPRINT",
  "timeLimitMs": ${template.defaultTimeLimitMs},
  "expectedOutput": "",
  "deliverableType": "${template.deliverableType}",
  "domainHint": "${template.domain}"
}

CRITICAL RULES:

Anti-patterns — DO NOT do these:
${antiPatternText}

Constraint guidance:
- Constraints should actually constrain. "Must be well-tested" is NOT a constraint.
- Good constraints: "Must complete in O(n log n) time", "Budget capped at $50k", "No external API calls"
- Each constraint should force a design decision the agent might otherwise skip.

Criteria guidance:
- The exemplar criteria above are starting points — adapt them to THIS specific brief.
- Each criterion description MUST be >15 characters and describe something observable in the deliverables.
- Weights MUST sum to exactly 1.0.
- maxScore should always be 10.
- Use 3-5 criteria. More is not better.

Problem statement:
- Must be >200 characters.
- Must describe the PROBLEM, not the solution approach.
- Include what success looks like.

Deliverables:
- Adapt the filename hints to match the actual problem.
- Every deliverable must have a file extension.
- deliverableType "${template.deliverableType}" should match the primary output format.`;
}
