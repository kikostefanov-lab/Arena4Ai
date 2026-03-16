'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EXAMPLE_BRIEFS, type ExampleBrief } from '../../../lib/example-briefs';
import type { AgentProfile, Agent } from '@arena/shared';
import './new-competition.css';
import { MONOSPACE_FONT, FORM_LABEL_STYLE, BODY_FONT, BODY_FONT_SIZE, BODY_FONT_SIZE_SM, KICKER_STYLE } from '../../../lib/design-tokens';

// ─── localStorage helpers ─────────────────────────────────────────────────────

interface SavedPersona {
  id: string;
  name: string;
  model: 'claude' | 'codex' | 'gemini';
  description: string;
  systemPrompt: string;
}

const PERSONAS_STORAGE_KEY = 'arena4ai:personas';

function loadSavedPersonas(): SavedPersona[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PERSONAS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface RubricCriterion {
  id: string;
  description: string;
  maxScore: number;
  weight: number;
}

type Format = 'SPRINT' | 'HACKATHON' | 'RELAY_RACE' | 'RED_VS_BLUE';
type Model = 'claude' | 'codex' | 'gemini';
type DeliverableType = 'code' | 'document' | 'analysis' | 'presentation' | 'plan' | 'mixed';
type DomainHint = '' | 'software' | 'research' | 'creative' | 'security' | 'business' | 'ideation';

// ─── Constants ───────────────────────────────────────────────────────────────

const defaultCriteria: RubricCriterion[] = [
  { id: 'correctness', description: 'Solution correctness and completeness', maxScore: 10, weight: 0.5 },
  { id: 'code-quality', description: 'Code quality and maintainability', maxScore: 10, weight: 0.5 },
];

// NOTE: Keep in sync with packages/orchestrator/src/brief/presets.ts — PRESETS.
const FORMAT_PRESETS: Record<Format, {
  timeLimitMins: number;
  constraints: string;
  deliverables: string;
  criteria: RubricCriterion[];
}> = {
  SPRINT: {
    timeLimitMins: 15,
    constraints: 'Stay within the time limit.',
    deliverables: 'solution.md',
    criteria: [
      { id: 'correctness', description: 'Solution is correct', maxScore: 10, weight: 0.5 },
      { id: 'quality', description: 'Code / writing quality', maxScore: 10, weight: 0.3 },
      { id: 'speed', description: 'Delivered promptly', maxScore: 10, weight: 0.2 },
    ],
  },
  HACKATHON: {
    timeLimitMins: 120,
    constraints: 'Use only approved libraries.',
    deliverables: 'README.md\nsource code',
    criteria: [
      { id: 'innovation', description: 'Creative and novel approach', maxScore: 10, weight: 0.35 },
      { id: 'completeness', description: 'Deliverables are complete', maxScore: 10, weight: 0.35 },
      { id: 'presentation', description: 'README and docs are clear', maxScore: 10, weight: 0.3 },
    ],
  },
  RELAY_RACE: {
    timeLimitMins: 30,
    constraints: 'Do not redo prior work. Build on what the previous agent produced.',
    deliverables: 'incremental solution',
    criteria: [
      { id: 'continuity', description: 'Builds coherently on prior work', maxScore: 10, weight: 0.4 },
      { id: 'correctness', description: 'Incremental output is correct', maxScore: 10, weight: 0.4 },
      { id: 'clarity', description: 'Handoff notes are clear', maxScore: 10, weight: 0.2 },
    ],
  },
  RED_VS_BLUE: {
    timeLimitMins: 60,
    constraints: 'Stay within the defined scope. Document all findings.',
    deliverables: 'attack/defense report',
    criteria: [
      { id: 'effectiveness', description: 'Attack or defense is effective', maxScore: 10, weight: 0.5 },
      { id: 'documentation', description: 'Report documents findings clearly', maxScore: 10, weight: 0.3 },
      { id: 'scope', description: 'Stays within defined scope', maxScore: 10, weight: 0.2 },
    ],
  },
};

const FORMAT_META: Record<Format, { emoji: string; label: string; subtitle: string; color: string; glowColor: string }> = {
  SPRINT:      { emoji: '⚡', label: 'Sprint',       subtitle: 'Quick 15-min challenge',   color: '#06b6d4', glowColor: 'rgba(6,182,212,0.35)'   },
  HACKATHON:   { emoji: '🔨', label: 'Hackathon',    subtitle: 'Deep 2-hour build',        color: '#00f0ff', glowColor: 'rgba(168,85,247,0.35)'  },
  RELAY_RACE:  { emoji: '🔄', label: 'Relay Race',   subtitle: 'Pass the baton',           color: '#0066ff', glowColor: 'rgba(34,197,94,0.35)'   },
  RED_VS_BLUE: { emoji: '⚔', label: 'Red vs Blue',  subtitle: 'Attack & Defend',           color: '#ef4444', glowColor: 'rgba(239,68,68,0.35)'   },
};

const MODEL_META: Record<Model, { emoji: string; label: string; color: string; glowColor: string }> = {
  claude: { emoji: '🟠', label: 'Claude', color: '#ff6600', glowColor: 'rgba(255,102,0,0.4)'  },
  codex:  { emoji: '🟢', label: 'Codex',  color: '#0066ff', glowColor: 'rgba(0,102,255,0.4)'   },
  gemini: { emoji: '🟣', label: 'Gemini', color: '#00f0ff', glowColor: 'rgba(0,240,255,0.4)'  },
};


const VALID_DOMAIN_HINTS: DomainHint[] = ['', 'software', 'research', 'creative', 'security', 'business', 'ideation'];

const FONT = MONOSPACE_FONT;

// ─── ExampleChips ─────────────────────────────────────────────────────────────

function ExampleChips({
  examples, value, onChange,
}: {
  examples: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const valueStr = typeof value === 'string' ? value : Array.isArray(value) ? value.join('\n') : '';
  const existing = new Set(valueStr.split('\n').map((s) => s.trim()).filter(Boolean));
  const available = examples.filter((e) => !existing.has(e));
  if (available.length === 0) return null;

  const add = (ex: string) => {
    const trimmed = value.trim();
    onChange(trimmed ? `${trimmed}\n${ex}` : ex);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.4rem' }}>
      <span style={{ fontSize: '0.5rem', color: '#1e4a5a', alignSelf: 'center', flexShrink: 0 }}>e.g.</span>
      {available.map((ex) => (
        <button
          key={ex}
          type="button"
          onClick={() => add(ex)}
          style={{
            fontSize: '0.5rem', padding: '0.15rem 0.45rem',
            background: 'rgba(30,45,69,0.6)', color: '#4a8fa8',
            border: '1px solid #0a2235', borderRadius: '4px',
            cursor: 'pointer', fontFamily: FONT,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,240,255,0.1)';
            (e.currentTarget as HTMLButtonElement).style.color = '#00f0ff';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,240,255,0.4)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(30,45,69,0.6)';
            (e.currentTarget as HTMLButtonElement).style.color = '#4a8fa8';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#0a2235';
          }}
        >
          + {ex}
        </button>
      ))}
    </div>
  );
}

// ─── Minimal YAML parser for brief files ─────────────────────────────────────

interface ParsedBriefYaml {
  title?: string;
  format?: string;
  timeLimitMs?: number;
  problem?: string;
  constraints?: string[];
  deliverables?: string[];
  expectedOutput?: string;
  deliverableType?: DeliverableType;
  domainHint?: string;
  rubric?: {
    criteria: Array<{
      id: string;
      description: string;
      maxScore: number;
      weight: number;
    }>;
  };
}

/**
 * Minimal YAML parser for the specific brief format used in briefs/*.yml.
 * Handles: scalar strings, block scalars (|), sequence lists, and the
 * rubric.criteria nested structure. Not a general YAML parser.
 */
function parseSimpleBriefYaml(text: string): ParsedBriefYaml {
  const result: ParsedBriefYaml = {};
  const lines = text.split('\n');

  let i = 0;

  const extractQuotedOrBare = (raw: string): string => {
    const trimmed = raw.trim();
    // Remove inline comments (bare values only)
    const m = trimmed.match(/^"((?:[^"\\]|\\.)*)"/) ?? trimmed.match(/^'((?:[^'\\]|\\.)*)'/) ;
    if (m) return m[1].replace(/\\"/g, '"').replace(/\\'/g, "'");
    // Bare value — strip inline comment
    return trimmed.replace(/\s*#.*$/, '').trim();
  };

  const readBlockScalar = (baseIndent: number): string => {
    const parts: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      const stripped = line.replace(/\t/g, '  ');
      if (stripped.trim() === '') {
        parts.push('');
        i++;
        continue;
      }
      const indent = stripped.search(/\S/);
      if (indent <= baseIndent && stripped.trim() !== '') break;
      parts.push(stripped.slice(baseIndent + 2)); // remove common indent
      i++;
    }
    // Trim trailing blank lines
    while (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop();
    return parts.join('\n');
  };

  const readSequence = (baseIndent: number): string[] => {
    const items: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      const stripped = line.replace(/\t/g, '  ');
      if (stripped.trim() === '') { i++; continue; }
      const indent = stripped.search(/\S/);
      if (indent <= baseIndent && !stripped.trimStart().startsWith('-')) break;
      if (indent <= baseIndent) break;
      const seqMatch = stripped.trimStart().match(/^-\s*(.*)/);
      if (!seqMatch) break;
      items.push(extractQuotedOrBare(seqMatch[1]));
      i++;
    }
    return items;
  };

  const readCriteria = (baseIndent: number): ParsedBriefYaml['rubric'] => {
    const criteria: NonNullable<ParsedBriefYaml['rubric']>['criteria'] = [];
    let current: Partial<(typeof criteria)[0]> | null = null;

    while (i < lines.length) {
      const line = lines[i];
      const stripped = line.replace(/\t/g, '  ');
      if (stripped.trim() === '') { i++; continue; }
      const indent = stripped.search(/\S/);
      if (indent <= baseIndent) break;

      const trimmed = stripped.trimStart();
      if (trimmed.startsWith('- id:')) {
        if (current && current.id) criteria.push(current as (typeof criteria)[0]);
        current = {};
        current.id = extractQuotedOrBare(trimmed.slice(5));
        i++;
      } else if (trimmed.startsWith('id:') && current) {
        current.id = extractQuotedOrBare(trimmed.slice(3));
        i++;
      } else if (trimmed.startsWith('description:') && current) {
        current.description = extractQuotedOrBare(trimmed.slice(12));
        i++;
      } else if (trimmed.startsWith('maxScore:') && current) {
        current.maxScore = Number(extractQuotedOrBare(trimmed.slice(9)));
        i++;
      } else if (trimmed.startsWith('weight:') && current) {
        current.weight = Number(extractQuotedOrBare(trimmed.slice(7)));
        i++;
      } else {
        i++;
      }
    }
    if (current && current.id) criteria.push(current as (typeof criteria)[0]);
    return { criteria };
  };

  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.replace(/\t/g, '  ');
    if (stripped.trim() === '' || stripped.trimStart().startsWith('#')) { i++; continue; }
    const indent = stripped.search(/\S/);
    if (indent > 0) { i++; continue; } // skip indented lines at top level

    const trimmed = stripped.trim();

    if (trimmed.startsWith('title:')) {
      result.title = extractQuotedOrBare(trimmed.slice(6));
      i++;
    } else if (trimmed.startsWith('format:')) {
      result.format = extractQuotedOrBare(trimmed.slice(7));
      i++;
    } else if (trimmed.startsWith('timeLimitMs:')) {
      result.timeLimitMs = Number(extractQuotedOrBare(trimmed.slice(12)));
      i++;
    } else if (trimmed.startsWith('problem:')) {
      const val = extractQuotedOrBare(trimmed.slice(8));
      i++;
      if (val === '|' || val === '>') {
        result.problem = readBlockScalar(indent);
      } else {
        result.problem = val;
      }
    } else if (trimmed.startsWith('expectedOutput:')) {
      const val = extractQuotedOrBare(trimmed.slice(15));
      i++;
      if (val === '|' || val === '>') {
        result.expectedOutput = readBlockScalar(indent);
      } else {
        result.expectedOutput = val;
      }
    } else if (trimmed === 'constraints:') {
      i++;
      result.constraints = readSequence(indent);
    } else if (trimmed === 'deliverables:') {
      i++;
      result.deliverables = readSequence(indent);
    } else if (trimmed.startsWith('deliverableType:')) {
      result.deliverableType = extractQuotedOrBare(trimmed.slice(16)) as DeliverableType;
      i++;
    } else if (trimmed.startsWith('domainHint:')) {
      result.domainHint = String(extractQuotedOrBare(trimmed.slice(11)));
      i++;
    } else if (trimmed === 'rubric:') {
      i++;
      // Look for criteria: inside rubric block
      while (i < lines.length) {
        const inner = lines[i].replace(/\t/g, '  ');
        if (inner.trim() === '') { i++; continue; }
        const innerIndent = inner.search(/\S/);
        if (innerIndent === 0) break; // back to top level
        if (inner.trimStart() === 'criteria:') {
          i++;
          result.rubric = readCriteria(innerIndent);
          break;
        } else {
          i++;
        }
      }
    } else {
      i++;
    }
  }

  return result;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewCompetitionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Saved custom personas from localStorage
  const [savedPersonas, setSavedPersonas] = useState<SavedPersona[]>([]);

  // Armory profiles from API
  const [armoryProfiles, setArmoryProfiles] = useState<AgentProfile[]>([]);
  const [armoryLoaded, setArmoryLoaded] = useState(false);

  useEffect(() => {
    setSavedPersonas(loadSavedPersonas());
  }, []);

  // Step expansion state
  const [expandedStep, setExpandedStep] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    if (expandedStep !== 3) return;
    if (!armoryLoaded) {
      fetch('/api/agent-profiles?retired=false')
        .then(r => r.json())
        .then((data: AgentProfile[]) => { setArmoryProfiles(data); setArmoryLoaded(true); })
        .catch(() => setArmoryLoaded(true));
    }
    // Load chips for each team's current provider independently
    teamsRef.current.forEach(t => void loadAgentsForProvider(t.id, t.model));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedStep]);

  // Example briefs panel
  const [examplePanelOpen, setExamplePanelOpen] = useState(false);

  // YAML import
  const yamlFileInputRef = useRef<HTMLInputElement>(null);
  const [importToast, setImportToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // AI brief generator
  const [showGenerator, setShowGenerator] = useState(false);
  const [ideaText, setIdeaText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  // Intake flow state
  const [showIntake, setShowIntake] = useState(false);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [intakeQuestions, setIntakeQuestions] = useState<Array<{ id: string; question: string; options?: string[] }>>([]);
  const [intakeAnswers, setIntakeAnswers] = useState<Record<string, string>>({});
  const [detectedDomain, setDetectedDomain] = useState('');
  const [detectedDeliverableType, setDetectedDeliverableType] = useState('');

  // Quality report
  const [qualityReport, setQualityReport] = useState<{
    overallScore: number;
    launchReady: boolean;
    issues: Array<{ field: string; severity: 'error' | 'warning'; message: string }>;
    suggestions: string[];
  } | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);

  // Save to library
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<Format>('SPRINT');
  const [problem, setProblem] = useState('');
  const [constraints, setConstraints] = useState(FORMAT_PRESETS['SPRINT'].constraints);
  const [deliverables, setDeliverables] = useState(FORMAT_PRESETS['SPRINT'].deliverables);
  const [timeLimitMins, setTimeLimitMins] = useState(FORMAT_PRESETS['SPRINT'].timeLimitMins);
  const [criteria, setCriteria] = useState<RubricCriterion[]>(FORMAT_PRESETS['SPRINT'].criteria);
  const [expectedOutput, setExpectedOutput] = useState('');
  const [deliverableType, setDeliverableType] = useState<DeliverableType>('code');
  const [domainHint, setDomainHint] = useState<DomainHint>('');
  const [domainHintOpen, setDomainHintOpen] = useState(false);
  const [adversarialJudge, setAdversarialJudge] = useState(false);
  const [teams, setTeams] = useState<Array<{ id: string; model: Model; persona: string; agentId?: string }>>([
    { id: 'team-a', model: 'claude' as Model, persona: 'speedrunner' },
    { id: 'team-b', model: 'claude' as Model, persona: 'architect' },
  ]);

  // DB-sourced agent chips for Step 3 — keyed by team.id to avoid cross-team contamination
  const [agentChipsByTeam, setAgentChipsByTeam] = useState<Record<string, Agent[]>>({});
  const [agentSearchByTeam, setAgentSearchByTeam] = useState<Record<string, string>>({});
  const [loadingAgentsByTeam, setLoadingAgentsByTeam] = useState<Record<string, boolean>>({});
  // Keep a ref so the step-3 useEffect can read current teams without being in deps
  const teamsRef = useRef(teams);
  teamsRef.current = teams;

  // Pre-fill team from ?personaId=<id> — jumps to step 3
  useEffect(() => {
    const personaId = searchParams.get('personaId');
    if (!personaId) return;
    const all = loadSavedPersonas();
    const persona = all.find((p) => p.id === personaId);
    if (!persona) return;
    setTeams((prev) => [
      { ...prev[0], model: persona.model as Model, persona: persona.name },
      prev[1] ?? { id: 'team-b', model: 'claude' as Model, persona: 'architect' },
    ]);
    setExpandedStep(3);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fill from a previous competition if ?from=<id>
  useEffect(() => {
    const fromId = searchParams.get('from');
    if (!fromId) return;
    fetch(`/api/competitions/${fromId}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { brief?: { title?: string; problem?: string; format?: string; timeLimitMs?: number; constraints?: string[]; deliverables?: string[]; rubric?: { criteria: RubricCriterion[] }; deliverableType?: DeliverableType; domainHint?: string }; teams?: { model?: string }[] } | null) => {
        if (!data?.brief) return;
        const b = data.brief;
        if (b.title) setTitle(b.title);
        if (b.problem) setProblem(b.problem);
        if (b.format && ['SPRINT','HACKATHON','RELAY_RACE','RED_VS_BLUE'].includes(b.format)) setFormat(b.format as Format);
        if (b.timeLimitMs) setTimeLimitMins(Math.round(b.timeLimitMs / 60000));
        if (b.constraints?.length) setConstraints(b.constraints.join('\n'));
        if (b.deliverables?.length) setDeliverables(b.deliverables.join('\n'));
        if (b.rubric?.criteria?.length) setCriteria(b.rubric.criteria);
        if (b.deliverableType) setDeliverableType(b.deliverableType);
        if (b.domainHint && VALID_DOMAIN_HINTS.includes(b.domainHint as DomainHint)) {
          setDomainHint(b.domainHint as DomainHint);
        }
        if (data.teams?.length) {
          const teamIds = ['team-a', 'team-b', 'team-c', 'team-d'];
          setTeams(data.teams.slice(0, 4).map((t: { model?: string }, i: number) => {
            const [provider, persona] = (t.model ?? '').split(':');
            return { id: teamIds[i] ?? `team-${i}`, model: (provider || 'claude') as Model, persona: persona || 'pragmatist' };
          }));
        }
      })
      .catch(() => {});
  }, [searchParams]);

  // Pre-fill from a brief library entry if ?briefSlug=<id>
  const [editBriefId, setEditBriefId] = useState<string | null>(null);
  useEffect(() => {
    const briefSlug = searchParams.get('briefSlug');
    if (!briefSlug) return;
    const isEdit = searchParams.get('mode') === 'edit';
    fetch('/api/briefs')
      .then(r => r.ok ? r.json() : [])
      .then((items: Array<{ id: string; brief?: Record<string, any>; title?: string; format?: string; timeLimitMs?: number; problem?: string; constraints?: string[]; deliverables?: string[]; rubric?: { criteria: RubricCriterion[] }; tags?: string[]; deliverableType?: DeliverableType; domainHint?: string }>) => {
        const item = items.find((b) => b.id === briefSlug);
        if (!item) return;
        // Support both new shape (data nested in .brief) and legacy flat shape
        const b = item.brief && typeof item.brief === 'object' ? item.brief as Record<string, any> : item;
        if (b.title) setTitle(b.title as string);
        if (b.format && ['SPRINT','HACKATHON','RELAY_RACE','RED_VS_BLUE'].includes(b.format as string)) setFormat(b.format as Format);
        if (b.timeLimitMs) setTimeLimitMins(Math.round((b.timeLimitMs as number) / 60000));
        if (b.problem) setProblem(b.problem as string);
        if (Array.isArray(b.constraints) && b.constraints.length) setConstraints(b.constraints.join('\n'));
        if (Array.isArray(b.deliverables) && b.deliverables.length) setDeliverables(b.deliverables.join('\n'));
        if (b.rubric?.criteria?.length) setCriteria(b.rubric.criteria as RubricCriterion[]);
        if (b.deliverableType) setDeliverableType(b.deliverableType as DeliverableType);
        if (b.domainHint && VALID_DOMAIN_HINTS.includes(b.domainHint as DomainHint)) {
          setDomainHint(b.domainHint as DomainHint);
        }
        if (isEdit) {
          setEditBriefId(item.id);
          setExpandedStep(1); // stay on brief editing step
        } else {
          setExpandedStep(3); // jump to teams step since brief is pre-filled
        }
        // Auto-run quality check on loaded briefs
        setTimeout(() => runQualityCheck(b as Record<string, unknown>), 300);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPreset = (f: Format) => {
    setFormat(f);
    const p = FORMAT_PRESETS[f];
    setTimeLimitMins(p.timeLimitMins);
    setConstraints(p.constraints);
    setDeliverables(p.deliverables);
    setCriteria(p.criteria);
  };

  const loadExample = (brief: ExampleBrief) => {
    setFormat(brief.format);
    setTimeLimitMins(brief.timeLimitMins);
    setProblem(brief.problem);
    setConstraints(brief.constraints);
    setDeliverables(brief.deliverables);
    setExpectedOutput(brief.expectedOutput ?? '');
    setCriteria(brief.criteria);
    if (!title.trim()) setTitle(brief.title);
    setExamplePanelOpen(false);
  };

  const runIntake = async () => {
    if (ideaText.trim().length < 10) return;
    setIntakeLoading(true);
    setGenerateError('');
    setShowIntake(false);
    setIntakeQuestions([]);
    setIntakeAnswers({});
    try {
      const res = await fetch('/api/generate-brief/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: ideaText.trim() }),
      });
      if (!res.ok) throw new Error('Intake failed');
      const data = await res.json();
      setDetectedDomain(data.detectedDomain ?? '');
      setDetectedDeliverableType(data.detectedDeliverableType ?? '');
      if (data.detectedDomain && VALID_DOMAIN_HINTS.includes(data.detectedDomain as DomainHint)) {
        setDomainHint(data.detectedDomain as DomainHint);
      }
      // Normalize questions: API may return string[] or {id,question,options}[]
      const rawQ = Array.isArray(data.questions) ? data.questions : [];
      const normalized = rawQ.map((q: string | { id?: string; question?: string; text?: string; options?: string[] }, i: number) => {
        if (typeof q === 'string') return { id: `q${i}`, question: q };
        return { id: q.id ?? `q${i}`, question: q.question ?? q.text ?? '', options: q.options };
      });
      setIntakeQuestions(normalized);
      setShowIntake(true);
    } catch {
      setGenerateError('Failed to run intake. Make sure the orchestrator is running.');
    } finally {
      setIntakeLoading(false);
    }
  };

  const generateBrief = async () => {
    setGenerating(true);
    setGenerateError('');
    setQualityReport(null);
    try {
      const res = await fetch('/api/generate-brief/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: ideaText.trim(),
          answers: intakeAnswers,
          domain: detectedDomain || undefined,
          deliverableType: detectedDeliverableType || undefined,
          format,
        }),
      });
      if (!res.ok) throw new Error('Generation failed');
      const brief = await res.json();
      if (brief.title) setTitle(brief.title);
      if (brief.problem) setProblem(brief.problem);
      if (brief.constraints) setConstraints(Array.isArray(brief.constraints) ? brief.constraints.join('\n') : brief.constraints);
      if (brief.deliverables) setDeliverables(Array.isArray(brief.deliverables) ? brief.deliverables.join('\n') : brief.deliverables);
      if (brief.expectedOutput !== undefined) setExpectedOutput(brief.expectedOutput);
      const briefCriteria = brief.rubric?.criteria ?? brief.criteria;
      if (briefCriteria) setCriteria(briefCriteria);
      if (brief.deliverableType) setDeliverableType(brief.deliverableType);
      if (brief.domainHint && VALID_DOMAIN_HINTS.includes(brief.domainHint as DomainHint)) {
        setDomainHint(brief.domainHint as DomainHint);
      }
      setShowGenerator(false);
      setShowIntake(false);
      setIdeaText('');

      // Auto-run quality check
      runQualityCheck(brief);
    } catch {
      setGenerateError('Failed to generate brief. Make sure the orchestrator is running.');
    } finally {
      setGenerating(false);
    }
  };

  const runQualityCheck = async (briefObj?: Record<string, unknown>) => {
    setQualityLoading(true);
    try {
      const briefToCheck = briefObj ?? {
        title,
        format,
        problem,
        constraints: constraints.split('\n').map(s => s.trim()).filter(Boolean),
        deliverables: deliverables.split('\n').map(s => s.trim()).filter(Boolean),
        timeLimitMs: timeLimitMins * 60 * 1000,
        rubric: { criteria: criteria.filter(c => c.id.trim() && c.description.trim()) },
        deliverableType,
        ...(domainHint ? { domainHint } : {}),
      };
      const res = await fetch('/api/generate-brief/quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: briefToCheck }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setQualityReport(data);
    } catch {
      // quality check is non-critical
    } finally {
      setQualityLoading(false);
    }
  };

  // Auto-run quality check when form fields change (debounced)
  useEffect(() => {
    if (!title.trim() || !problem.trim()) { setQualityReport(null); return; }
    const timer = setTimeout(() => { runQualityCheck(); }, 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, problem, constraints, deliverables, criteria, deliverableType]);

  const handleSaveToLibrary = async () => {
    try {
      const briefObj = {
        id: editBriefId ?? `brief-${Date.now()}`,
        title,
        format,
        problem,
        constraints: constraints.split('\n').map(s => s.trim()).filter(Boolean),
        deliverables: deliverables.split('\n').map(s => s.trim()).filter(Boolean),
        timeLimitMs: timeLimitMins * 60 * 1000,
        rubric: { criteria: criteria.filter(c => c.id.trim() && c.description.trim()) },
        deliverableType,
        ...(domainHint ? { domainHint } : {}),
      };
      if (editBriefId) {
        // Update existing brief
        const res = await fetch(`/api/briefs/${encodeURIComponent(editBriefId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brief: briefObj, tags: [] }),
        });
        if (!res.ok) throw new Error('Update failed');
        setSaveToast('Brief updated in library');
      } else {
        // Create new brief
        const res = await fetch('/api/briefs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brief: briefObj, source: 'generated', tags: [] }),
        });
        if (!res.ok) throw new Error('Save failed');
        setSaveToast('Brief saved to library');
      }
      setTimeout(() => setSaveToast(null), 3000);
    } catch {
      setSaveToast('Failed to save brief');
      setTimeout(() => setSaveToast(null), 3000);
    }
  };

  const generateBriefLegacy = async () => {
    if (ideaText.trim().length < 10) return;
    setGenerating(true);
    setGenerateError('');
    try {
      const res = await fetch('/api/generate-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: ideaText, format }),
      });
      if (!res.ok) throw new Error('Generation failed');
      const brief = await res.json();
      if (brief.title) setTitle(brief.title);
      if (brief.problem) setProblem(brief.problem);
      if (brief.constraints) setConstraints(Array.isArray(brief.constraints) ? brief.constraints.join('\n') : brief.constraints);
      if (brief.deliverables) setDeliverables(Array.isArray(brief.deliverables) ? brief.deliverables.join('\n') : brief.deliverables);
      if (brief.expectedOutput !== undefined) setExpectedOutput(brief.expectedOutput);
      const briefCriteria = brief.rubric?.criteria ?? brief.criteria;
      if (briefCriteria) setCriteria(briefCriteria);
      setShowGenerator(false);
      setIdeaText('');
    } catch {
      setGenerateError('Failed to generate brief. Make sure the orchestrator is running.');
    } finally {
      setGenerating(false);
    }
  };

  const showToast = (type: 'success' | 'error', message: string) => {
    setImportToast({ type, message });
    setTimeout(() => setImportToast(null), 4000);
  };

  const handleYamlImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-imported
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const parsed = parseSimpleBriefYaml(text);
        if (!parsed.title && !parsed.problem) {
          showToast('error', 'Could not parse YAML — no title or problem found.');
          return;
        }
        if (parsed.title) setTitle(parsed.title);
        if (parsed.format && ['SPRINT', 'HACKATHON', 'RELAY_RACE', 'RED_VS_BLUE'].includes(parsed.format)) {
          setFormat(parsed.format as Format);
        }
        if (parsed.timeLimitMs) setTimeLimitMins(Math.round(parsed.timeLimitMs / 60000));
        if (parsed.problem) setProblem(parsed.problem);
        if (parsed.constraints?.length) setConstraints(parsed.constraints.join('\n'));
        if (parsed.deliverables?.length) setDeliverables(parsed.deliverables.join('\n'));
        if (parsed.expectedOutput !== undefined) setExpectedOutput(parsed.expectedOutput);
        if (parsed.rubric?.criteria?.length) setCriteria(parsed.rubric.criteria);
        if (parsed.deliverableType) setDeliverableType(parsed.deliverableType);
        if (parsed.domainHint && VALID_DOMAIN_HINTS.includes(parsed.domainHint as DomainHint)) {
          setDomainHint(parsed.domainHint as DomainHint);
        }
        showToast('success', `Brief "${parsed.title ?? 'untitled'}" imported successfully.`);
      } catch {
        showToast('error', 'Failed to parse YAML file. Check the format and try again.');
      }
    };
    reader.onerror = () => showToast('error', 'Failed to read file.');
    reader.readAsText(file);
  };

  async function loadAgentsForProvider(teamId: string, provider: string) {
    setLoadingAgentsByTeam(prev => ({ ...prev, [teamId]: true }));
    try {
      const res = await fetch(`/api/agents?provider=${provider}&retired=false`);
      const data = await res.json() as { agents?: Agent[] };
      setAgentChipsByTeam(prev => ({ ...prev, [teamId]: data.agents ?? [] }));
    } catch {
      setAgentChipsByTeam(prev => ({ ...prev, [teamId]: [] }));
    } finally {
      setLoadingAgentsByTeam(prev => ({ ...prev, [teamId]: false }));
    }
  }

  function selectAgent(teamId: string, agent: Agent) {
    setTeams(prev => prev.map(t =>
      t.id === teamId ? {
        ...t,
        agentId: agent.id,
        model: agent.provider as Model,
        persona: agent.persona?.name ?? '',
      } : t
    ));
  }

  const addCriterion = () =>
    setCriteria([...criteria, { id: '', description: '', maxScore: 10, weight: 0.5 }]);

  const removeCriterion = (idx: number) =>
    setCriteria(criteria.filter((_, i) => i !== idx));

  const updateCriterion = (idx: number, field: keyof RubricCriterion, value: string | number) =>
    setCriteria(criteria.map((c, i) => i === idx ? { ...c, [field]: value } : c));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        brief: {
          id: `comp-${Date.now()}`,
          title,
          format,
          problem,
          constraints: constraints.split('\n').map((s) => s.trim()).filter(Boolean),
          deliverables: deliverables.split('\n').map((s) => s.trim()).filter(Boolean),
          timeLimitMs: timeLimitMins * 60 * 1000,
          rubric: {
            criteria: criteria
              .filter((c) => c.id.trim() && c.description.trim())
              .map((c) => ({ ...c, maxScore: Number(c.maxScore), weight: Number(c.weight) })),
          },
          ...(expectedOutput.trim() ? { expectedOutput: expectedOutput.trim() } : {}),
          deliverableType,
          ...(domainHint ? { domainHint } : {}),
        },
        teams: teams.map((t) => ({ id: t.id, model: t.model, persona: t.persona, ...(t.agentId ? { agentId: t.agentId } : {}) })),
        adversarialJudge,
        options: { claudeBin: 'claude', logDir: '/tmp/arena-logs' },
      };
      const res = await fetch('/api/competitions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${text}`);
      }
      const data = await res.json();
      router.push(`/competitions/${data.competitionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const toggleStep = (step: 1 | 2 | 3) => {
    setExpandedStep(step);
  };

  // Touched state for inline validation
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const touch = (field: string) => setTouched(prev => new Set([...prev, field]));

  // Validation derived state
  const errors = {
    title: !title.trim() ? 'Title is required' : null,
    problem: !problem.trim() ? 'Problem statement is required' : null,
    criteria: criteria.filter(c => c.id.trim() && c.description.trim()).length === 0
      ? 'At least one complete criterion is required' : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  // Check which steps have data filled in
  const step1Done = title.trim().length > 0 && problem.trim().length > 0;
  const step2Done = criteria.length > 0 && criteria.every(c => c.id && c.description);

  return (
    <div style={{
      minHeight: '100vh',
      color: '#c8eef8',
      fontFamily: FONT,
    }}>
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2.5rem 1.5rem 4rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem', animation: 'fadeInUp 0.4s ease-out' }}>
          <div style={{ marginBottom: '1.2rem' }}>
            <div style={{ ...KICKER_STYLE, color: '#00f0ff' }}>
              ◆ ARENA4AI | NEW BATTLE
            </div>
          </div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#c8eef8', margin: 0, lineHeight: 1.2 }}>
            Launch a Competition
          </h1>
          <p style={{ fontSize: BODY_FONT_SIZE, fontFamily: BODY_FONT, color: '#4a8fa8', marginTop: '0.5rem', lineHeight: 1.6 }}>
            Configure your brief, set scoring criteria, and choose your fighters.
          </p>
        </div>

        <form onSubmit={handleSubmit}>

          {/* ── Hidden YAML file input ── */}
          <input
            ref={yamlFileInputRef}
            type="file"
            accept=".yml,.yaml"
            style={{ display: 'none' }}
            onChange={handleYamlImport}
          />

          {/* ── Import toast notification ── */}
          {importToast && (
            <div style={{
              marginBottom: '1rem',
              padding: '0.6rem 1rem',
              borderRadius: '8px',
              fontSize: '0.68rem',
              fontWeight: 600,
              animation: 'fadeInUp 0.2s ease-out',
              background: importToast.type === 'success'
                ? 'rgba(34,197,94,0.1)'
                : 'rgba(239,68,68,0.1)',
              border: `1px solid ${importToast.type === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
              color: importToast.type === 'success' ? '#0066ff' : '#ef4444',
            }}>
              {importToast.type === 'success' ? '✓' : '✗'} {importToast.message}
            </div>
          )}

          {/* ────────────────────────────────────────────────────────────────────
              EXAMPLE BRIEFS PANEL
          ──────────────────────────────────────────────────────────────────── */}
          <div style={{
            marginBottom: '1rem',
            background: '#050f1e',
            border: examplePanelOpen ? '1px solid #0e3050' : '1px solid #0a2235',
            borderRadius: '12px',
            overflow: 'hidden',
            transition: 'border-color 0.2s',
          }}>
            {/* Toggle header */}
            <button
              type="button"
              onClick={() => setExamplePanelOpen((o) => !o)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.85rem 1.25rem', background: 'none', border: 'none',
                cursor: 'pointer', fontFamily: FONT, textAlign: 'left',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.8'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
            >
              <span style={{
                fontSize: '0.6rem', fontWeight: 700, color: '#00f0ff',
                background: 'rgba(0,240,255,0.12)', border: '1px solid rgba(0,240,255,0.3)',
                borderRadius: '4px', padding: '0.15rem 0.45rem', letterSpacing: '0.5px',
                flexShrink: 0,
              }}>
                QUICK START
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#c8eef8' }}>
                  Quick start from example
                </span>
                <span style={{ fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT, color: '#1e4a5a', marginLeft: '0.5rem' }}>
                  load a pre-built brief as your starting point
                </span>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#1e4a5a', flexShrink: 0 }}>
                {examplePanelOpen ? '▲' : '▾'}
              </span>
            </button>

            {/* Import YAML button — sits in the panel header row, right-aligned */}
            <div style={{ padding: '0 1.25rem 0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => yamlFileInputRef.current?.click()}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.35rem',
                  fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.5px',
                  padding: '0.3rem 0.75rem', borderRadius: '6px', cursor: 'pointer',
                  fontFamily: FONT, transition: 'all 0.2s',
                  background: 'rgba(30,45,69,0.6)', color: '#4a8fa8',
                  border: '1px solid #0a2235',
                }}
                onMouseEnter={(e) => {
                  const btn = e.currentTarget as HTMLButtonElement;
                  btn.style.background = 'rgba(0,240,255,0.1)';
                  btn.style.color = '#00f0ff';
                  btn.style.borderColor = 'rgba(0,240,255,0.4)';
                }}
                onMouseLeave={(e) => {
                  const btn = e.currentTarget as HTMLButtonElement;
                  btn.style.background = 'rgba(30,45,69,0.6)';
                  btn.style.color = '#4a8fa8';
                  btn.style.borderColor = '#0a2235';
                }}
              >
                <span>📂</span>
                <span>Import YAML</span>
              </button>
            </div>

            {/* Cards grid */}
            {examplePanelOpen && (
              <div style={{
                padding: '0 1.25rem 1.25rem',
                animation: 'slideDown 0.3s ease-out',
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  gap: '0.5rem',
                }}>
                  {EXAMPLE_BRIEFS.map((brief: ExampleBrief) => (
                    <button
                      key={brief.id}
                      type="button"
                      className="example-card"
                      onClick={() => loadExample(brief)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '1.3rem', lineHeight: 1 }}>{brief.emoji}</span>
                        <span style={{
                          fontSize: '0.45rem', fontWeight: 800, letterSpacing: '0.05em',
                          padding: '0.15rem 0.35rem', borderRadius: '3px',
                          background: brief.difficulty === 'SAVAGE' ? 'rgba(239,68,68,0.15)' : brief.difficulty === 'EXTREME' ? 'rgba(0,240,255,0.15)' : 'rgba(234,179,8,0.15)',
                          color: brief.difficulty === 'SAVAGE' ? '#ef4444' : brief.difficulty === 'EXTREME' ? '#00f0ff' : '#eab308',
                        }}>{brief.difficulty}</span>
                      </div>
                      <div style={{
                        fontSize: '0.65rem', fontWeight: 700, color: '#c8eef8',
                        marginBottom: '0.2rem', lineHeight: 1.2,
                      }}>
                        {brief.title}
                      </div>
                      <div style={{ fontSize: '0.52rem', color: '#1e4a5a' }}>
                        {brief.category}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ────────────────────────────────────────────────────────────────────
              STEP 1: BRIEF
          ──────────────────────────────────────────────────────────────────── */}
          <div style={{
            marginBottom: '1rem',
            background: '#050f1e',
            border: expandedStep === 1 ? '1px solid #0e3050' : '1px solid #0a2235',
            borderRadius: '12px',
            overflow: 'hidden',
            transition: 'border-color 0.2s',
          }}>
            {/* Step header */}
            <div
              className="step-header"
              onClick={() => toggleStep(1)}
              style={{ padding: '1rem 1.25rem' }}
            >
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.7rem', fontWeight: 800, flexShrink: 0,
                background: step1Done ? 'rgba(34,197,94,0.15)' : 'rgba(0,240,255,0.15)',
                color: step1Done ? '#0066ff' : '#00f0ff',
                border: `1.5px solid ${step1Done ? '#0066ff' : '#00f0ff'}`,
              }}>
                {step1Done ? '✓' : '1'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c8eef8' }}>
                  {'📋'} Brief
                </div>
                <div style={{ fontSize: '0.6rem', color: '#4a8fa8', marginTop: '0.15rem' }}>
                  Define the challenge
                </div>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#1e4a5a', flexShrink: 0 }}>
                {expandedStep === 1 ? '▲' : '▼'}
              </span>
            </div>

            {/* Step content */}
            {expandedStep === 1 && (
              <div style={{
                padding: '0 1.25rem 1.5rem',
                animation: 'slideDown 0.3s ease-out',
              }}>
                {/* Quality Report — inline at top of Brief step */}
                {qualityReport && !qualityLoading && (
                  <div style={{
                    marginBottom: '1rem', padding: '0.75rem 1rem',
                    background: qualityReport.launchReady ? 'rgba(34,197,94,0.04)' : 'rgba(234,179,8,0.04)',
                    border: `1px solid ${qualityReport.launchReady ? 'rgba(34,197,94,0.25)' : 'rgba(234,179,8,0.25)'}`,
                    borderRadius: '8px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: qualityReport.issues.length > 0 ? '0.5rem' : 0 }}>
                      <span style={{ fontSize: '0.52rem', fontWeight: 700, color: '#4a8fa8', letterSpacing: '1px', textTransform: 'uppercase' }}>
                        BRIEF QUALITY
                      </span>
                      <div style={{
                        flex: 1, height: '5px', background: '#0a2235', borderRadius: '3px',
                        overflow: 'hidden', maxWidth: '180px',
                      }}>
                        <div style={{
                          width: `${Math.round(qualityReport.overallScore * 100)}%`,
                          height: '100%', borderRadius: '3px',
                          background: qualityReport.overallScore >= 0.8
                            ? '#22c55e'
                            : qualityReport.overallScore >= 0.6
                              ? '#eab308'
                              : '#ef4444',
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                      <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#c8eef8' }}>
                        {Math.round(qualityReport.overallScore * 100)}%
                      </span>
                      {qualityReport.launchReady && (
                        <span style={{
                          fontSize: '0.45rem', fontWeight: 700, padding: '0.08rem 0.35rem',
                          borderRadius: '3px', letterSpacing: '0.8px',
                          background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                        }}>
                          READY
                        </span>
                      )}
                    </div>
                    {qualityReport.issues.length > 0 && (
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {qualityReport.issues.map((issue: { severity: string; field: string; message: string }, i: number) => (
                          <span
                            key={i}
                            style={{
                              fontSize: '0.48rem', fontWeight: 700, padding: '0.1rem 0.4rem',
                              borderRadius: '3px', letterSpacing: '0.3px',
                              background: issue.severity === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(234,179,8,0.12)',
                              color: issue.severity === 'error' ? '#ef4444' : '#eab308',
                            }}
                            title={`${issue.field}: ${issue.message}`}
                          >
                            {issue.severity === 'error' ? '✕' : '⚠'} {issue.message}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {qualityLoading && (
                  <div style={{
                    marginBottom: '1rem', padding: '0.55rem 1rem',
                    background: 'rgba(0,240,255,0.03)', border: '1px solid rgba(0,240,255,0.12)',
                    borderRadius: '8px', fontSize: '0.58rem', color: '#4a8fa8',
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                  }}>
                    <span style={{ display: 'inline-block', width: '0.6rem', height: '0.6rem', border: '2px solid rgba(0,240,255,0.3)', borderTopColor: '#00f0ff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    Checking brief quality...
                  </div>
                )}

                {/* Format preset cards */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ ...FORM_LABEL_STYLE, display: 'block', marginBottom: '0.65rem' }}>
                    Format
                  </label>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '0.65rem',
                  }}>
                    {(['SPRINT', 'HACKATHON', 'RELAY_RACE', 'RED_VS_BLUE'] as Format[]).map((f) => {
                      const meta = FORMAT_META[f];
                      const active = format === f;
                      return (
                        <div
                          key={f}
                          className={`format-card ${active ? 'active' : ''}`}
                          onClick={() => applyPreset(f)}
                          style={{
                            border: `1.5px solid ${active ? meta.color : '#0a2235'}`,
                            background: active ? `linear-gradient(135deg, ${meta.color}10, ${meta.color}05)` : '#050f1e',
                            boxShadow: active ? `0 0 20px ${meta.glowColor}, 0 4px 12px rgba(0,0,0,0.3)` : '0 2px 8px rgba(0,0,0,0.2)',
                          }}
                        >
                          <div style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>{meta.emoji}</div>
                          <div style={{
                            fontSize: '0.68rem', fontWeight: 700,
                            color: active ? meta.color : '#c8eef8',
                            marginBottom: '0.25rem',
                          }}>
                            {meta.label}
                          </div>
                          <div style={{
                            fontSize: '0.55rem',
                            color: active ? meta.color : '#1e4a5a',
                            opacity: active ? 0.8 : 1,
                          }}>
                            {meta.subtitle}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Title */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ ...FORM_LABEL_STYLE, display: 'block', marginBottom: '0.4rem' }}>
                    Competition title
                  </label>
                  <input
                    className="arena-input"
                    type="text" required value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => touch('title')}
                    placeholder="e.g. Cheapest NYC Flight · FizzBuzz Sprint · GPU Comparison"
                    style={{ border: touched.has('title') && errors.title ? '1px solid #ef4444' : undefined }}
                  />
                  {touched.has('title') && errors.title && (
                    <p style={{ color: '#ef4444', fontSize: '0.6rem', marginTop: '0.25rem', margin: '0.2rem 0 0' }}>
                      {errors.title}
                    </p>
                  )}
                </div>

                {/* Problem */}
                <div style={{ marginBottom: '1rem' }}>
                  {/* AI Generator panel */}
                  <div style={{ marginBottom: '0.65rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showGenerator ? '0.65rem' : 0 }}>
                      <label style={{ ...FORM_LABEL_STYLE, display: 'block' }}>
                        Problem statement
                      </label>
                      <button
                        type="button"
                        onClick={() => { setShowGenerator((v) => !v); setGenerateError(''); }}
                        style={{
                          fontSize: '0.58rem', fontWeight: 700, padding: '0.25rem 0.65rem',
                          background: showGenerator ? 'rgba(0,240,255,0.2)' : 'rgba(0,240,255,0.08)',
                          color: '#00f0ff',
                          border: '1px solid rgba(0,240,255,0.5)',
                          borderRadius: '6px', cursor: 'pointer', fontFamily: FONT,
                          letterSpacing: '0.5px', transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,240,255,0.2)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = showGenerator ? 'rgba(0,240,255,0.2)' : 'rgba(0,240,255,0.08)'; }}
                      >
                        {showGenerator ? '✕ Close' : '✨ Generate from idea'}
                      </button>
                    </div>

                    {showGenerator && (
                      <div style={{
                        background: '#010810',
                        border: '1px solid rgba(0,240,255,0.35)',
                        borderRadius: '8px',
                        padding: '0.85rem 1rem',
                        animation: 'slideDown 0.25s ease-out',
                      }}>
                        <p style={{ fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT, color: '#4a8fa8', margin: '0 0 0.5rem', lineHeight: 1.5 }}>
                          Describe your idea in plain English. We will ask a few clarifying questions, then generate a full brief.
                        </p>
                        <textarea
                          className="arena-input"
                          rows={3}
                          value={ideaText}
                          onChange={(e) => setIdeaText(e.target.value)}
                          placeholder={'e.g. A script that finds the cheapest flight from NYC to London next month\ne.g. A REST API that converts Markdown to HTML with caching\ne.g. Compare sorting algorithms and benchmark them'}
                          style={{ resize: 'vertical', lineHeight: 1.6, marginBottom: '0.65rem' }}
                        />

                        {/* Intake questions panel */}
                        {showIntake && intakeQuestions.length > 0 && (
                          <div style={{
                            background: 'rgba(0,240,255,0.04)',
                            border: '1px solid rgba(0,240,255,0.2)',
                            borderRadius: '6px',
                            padding: '0.75rem',
                            marginBottom: '0.65rem',
                          }}>
                            {detectedDomain && (
                              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
                                <span style={{
                                  fontSize: '0.5rem', fontWeight: 700, padding: '0.12rem 0.45rem',
                                  borderRadius: '3px', letterSpacing: '1px',
                                  background: 'rgba(0,240,255,0.12)', color: '#00f0ff',
                                }}>
                                  DOMAIN: {detectedDomain.toUpperCase()}
                                </span>
                                {detectedDeliverableType && (
                                  <span style={{
                                    fontSize: '0.5rem', fontWeight: 700, padding: '0.12rem 0.45rem',
                                    borderRadius: '3px', letterSpacing: '1px',
                                    background: 'rgba(255,102,0,0.12)', color: '#ff6600',
                                  }}>
                                    TYPE: {detectedDeliverableType.toUpperCase()}
                                  </span>
                                )}
                              </div>
                            )}
                            <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#4a8fa8', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                              Clarifying Questions
                            </div>
                            {intakeQuestions.map((q) => (
                              <div key={q.id} style={{ marginBottom: '0.6rem' }}>
                                <div style={{ fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT, color: '#c8eef8', marginBottom: '0.3rem', lineHeight: 1.5 }}>
                                  {q.question}
                                </div>
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                  {q.options && q.options.length > 0 ? q.options.map((opt) => {
                                    const selected = intakeAnswers[q.id] === opt;
                                    return (
                                      <button
                                        key={opt}
                                        type="button"
                                        onClick={() => setIntakeAnswers(prev => ({ ...prev, [q.id]: opt }))}
                                        style={{
                                          fontSize: '0.58rem', fontWeight: selected ? 800 : 600,
                                          padding: '0.2rem 0.55rem', borderRadius: '4px',
                                          border: selected ? '1px solid rgba(0,240,255,0.5)' : '1px solid #0a2235',
                                          background: selected ? 'rgba(0,240,255,0.1)' : 'transparent',
                                          color: selected ? '#00f0ff' : '#4a8fa8',
                                          cursor: 'pointer', fontFamily: FONT, transition: 'all 0.15s',
                                        }}
                                      >
                                        {opt}
                                      </button>
                                    );
                                  }) : (
                                    <input
                                      type="text"
                                      className="arena-input"
                                      placeholder="Type your answer..."
                                      value={intakeAnswers[q.id] ?? ''}
                                      onChange={(e) => setIntakeAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                                      style={{ fontSize: '0.58rem', padding: '0.3rem 0.5rem', flex: 1 }}
                                    />
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                          {!showIntake ? (
                            <button
                              type="button"
                              onClick={runIntake}
                              disabled={intakeLoading || ideaText.trim().length < 10}
                              style={{
                                fontSize: '0.62rem', fontWeight: 800, padding: '0.4rem 1rem',
                                background: intakeLoading || ideaText.trim().length < 10
                                  ? 'rgba(0,240,255,0.2)'
                                  : 'rgba(0,240,255,0.85)',
                                color: intakeLoading || ideaText.trim().length < 10 ? 'rgba(0,240,255,0.5)' : '#fff',
                                border: '1px solid rgba(0,240,255,0.6)',
                                borderRadius: '6px',
                                cursor: intakeLoading || ideaText.trim().length < 10 ? 'not-allowed' : 'pointer',
                                fontFamily: FONT, letterSpacing: '1px', transition: 'all 0.2s',
                              }}
                            >
                              {intakeLoading ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <span style={{ display: 'inline-block', width: '0.7rem', height: '0.7rem', border: '2px solid rgba(0,240,255,0.4)', borderTopColor: '#00f0ff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                  Analyzing...
                                </span>
                              ) : 'Analyze Idea'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={generateBrief}
                              disabled={generating}
                              style={{
                                fontSize: '0.62rem', fontWeight: 800, padding: '0.4rem 1rem',
                                background: generating
                                  ? 'rgba(0,240,255,0.2)'
                                  : 'rgba(0,240,255,0.85)',
                                color: generating ? 'rgba(0,240,255,0.5)' : '#fff',
                                border: '1px solid rgba(0,240,255,0.6)',
                                borderRadius: '6px',
                                cursor: generating ? 'not-allowed' : 'pointer',
                                fontFamily: FONT, letterSpacing: '1px', transition: 'all 0.2s',
                              }}
                            >
                              {generating ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <span style={{ display: 'inline-block', width: '0.7rem', height: '0.7rem', border: '2px solid rgba(0,240,255,0.4)', borderTopColor: '#00f0ff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                  Generating...
                                </span>
                              ) : 'Generate Brief ✨'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={generateBriefLegacy}
                            disabled={generating || ideaText.trim().length < 10}
                            style={{
                              fontSize: '0.55rem', fontWeight: 600, padding: '0.3rem 0.65rem',
                              background: 'transparent', color: '#3d7d94',
                              border: '1px solid #0a2235', borderRadius: '5px',
                              cursor: generating || ideaText.trim().length < 10 ? 'not-allowed' : 'pointer',
                              fontFamily: FONT, transition: 'all 0.15s',
                            }}
                            title="Skip intake questions and generate directly"
                          >
                            Quick Generate
                          </button>
                          {generateError && (
                            <span style={{ fontSize: '0.58rem', color: '#ef4444' }}>{generateError}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <textarea
                    className="arena-input"
                    required value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                    onBlur={() => touch('problem')}
                    rows={4}
                    placeholder={"Describe the challenge — can be anything:\n• Code: Build a REST API for task management\n• Research: Find the cheapest flight from Chicago to NYC next Friday\n• Compare: Which GPU offers the best price/performance under $400?\n• Writing: Draft a product launch announcement for..."}
                    style={{ resize: 'vertical', lineHeight: 1.6, border: touched.has('problem') && errors.problem ? '1px solid #ef4444' : undefined }}
                  />
                  {touched.has('problem') && errors.problem && (
                    <p style={{ color: '#ef4444', fontSize: '0.6rem', marginTop: '0.25rem', margin: '0.2rem 0 0' }}>
                      {errors.problem}
                    </p>
                  )}
                </div>

                {/* Constraints + Deliverables */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ ...FORM_LABEL_STYLE, display: 'block', marginBottom: '0.4rem' }}>
                      Constraints (one per line)
                    </label>
                    <textarea
                      className="arena-input"
                      value={constraints} onChange={(e) => setConstraints(e.target.value)}
                      rows={3} placeholder={'Use only public sources\nStay within the time limit'}
                      style={{ resize: 'vertical', lineHeight: 1.6 }}
                    />
                    <ExampleChips
                      examples={[
                        'Use only public sources',
                        'Cite all sources in your report',
                        'Must include current prices',
                        'TypeScript only',
                        'No external libraries',
                        'Under 50 lines of code',
                        'Output must be Markdown',
                      ]}
                      value={constraints}
                      onChange={setConstraints}
                    />
                  </div>
                  <div>
                    <label style={{ ...FORM_LABEL_STYLE, display: 'block', marginBottom: '0.4rem' }}>
                      Deliverables (one per line)
                    </label>
                    <textarea
                      className="arena-input"
                      value={deliverables} onChange={(e) => setDeliverables(e.target.value)}
                      rows={3}
                      placeholder={({
                        code:         'e.g. solution.py, main.ts, README.md',
                        document:     'e.g. report.md, findings.txt, analysis.pdf',
                        analysis:     'e.g. results.csv, summary.md, charts.json',
                        presentation: 'e.g. slides.md, deck-outline.md, visuals.md',
                        plan:         'e.g. roadmap.md, architecture.md, strategy.md',
                        mixed:        'e.g. thesis.md, model.py, README.md',
                      } as const)[deliverableType]}
                      style={{ resize: 'vertical', lineHeight: 1.6 }}
                    />
                    <ExampleChips
                      examples={[
                        'report.md with findings',
                        'Ranked options with prices',
                        'Booking or purchase link',
                        'Comparison table',
                        'solution.py',
                        'README.md',
                        'Test results',
                      ]}
                      value={deliverables}
                      onChange={setDeliverables}
                    />
                  </div>
                </div>

                {/* Deliverable Type picker */}
                <div style={{ marginTop: '1.25rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '1.5px', color: '#4a8fa8', textTransform: 'uppercase', marginBottom: '0.6rem', fontFamily: MONOSPACE_FONT }}>
                    Deliverable Type
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {([
                      { value: 'code',         label: '</> Code' },
                      { value: 'document',     label: '📄 Document' },
                      { value: 'analysis',     label: '📊 Analysis' },
                      { value: 'presentation', label: '🎨 Presentation' },
                      { value: 'plan',         label: '🗺 Plan' },
                      { value: 'mixed',        label: '⚡ Mixed' },
                    ] as const).map(({ value, label }) => {
                      const active = deliverableType === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setDeliverableType(value)}
                          style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '0.3rem 0.75rem',
                            borderRadius: '5px', cursor: 'pointer', fontFamily: MONOSPACE_FONT,
                            letterSpacing: '0.5px', border: active ? '1px solid rgba(0,240,255,0.5)' : '1px solid #0a2235',
                            background: active ? 'rgba(0,240,255,0.1)' : 'transparent',
                            color: active ? '#00f0ff' : '#4a8fa8',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#3d7d94', marginTop: '0.4rem', fontFamily: BODY_FONT }}>
                    {({
                      code:         'Agents will produce runnable code files.',
                      document:     'Agents will produce written documents — no code files.',
                      analysis:     'Agents will produce data tables or CSV output.',
                      presentation: 'Agents will produce slide outlines or visual content.',
                      plan:         'Agents will produce strategy or architecture documents.',
                      mixed:        'Agents choose whichever format best fits the brief.',
                    } as const)[deliverableType]}
                  </div>
                </div>

                {/* Advanced: domainHint */}
                <div style={{ marginTop: '1rem' }}>
                  <button
                    type="button"
                    onClick={() => setDomainHintOpen(o => !o)}
                    style={{
                      fontSize: '0.62rem', color: '#3d7d94', background: 'none', border: 'none',
                      cursor: 'pointer', padding: 0, fontFamily: MONOSPACE_FONT, letterSpacing: '1px',
                      display: 'flex', alignItems: 'center', gap: '0.3rem',
                    }}
                  >
                    {domainHintOpen ? '▼' : '▶'} Advanced
                  </button>
                  {domainHintOpen && (
                    <div style={{ marginTop: '0.6rem' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '1.5px', color: '#4a8fa8', textTransform: 'uppercase', marginBottom: '0.4rem', fontFamily: MONOSPACE_FONT }}>
                        Domain Hint (optional)
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {(['', 'software', 'research', 'creative', 'security', 'business', 'ideation'] as const).map((d) => {
                          const active = domainHint === d;
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setDomainHint(d)}
                              style={{
                                fontSize: '0.62rem', fontWeight: 700, padding: '0.2rem 0.6rem',
                                borderRadius: '4px', cursor: 'pointer', fontFamily: MONOSPACE_FONT,
                                border: active ? '1px solid rgba(0,240,255,0.4)' : '1px solid #0a2235',
                                background: active ? 'rgba(0,240,255,0.08)' : 'transparent',
                                color: active ? '#00f0ff' : '#3d7d94',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {d === '' ? 'Auto' : d}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: '0.62rem', color: '#1e4a5a', marginTop: '0.35rem', fontFamily: BODY_FONT }}>
                        Overrides AI domain detection for Forge artifact selection. Leave on Auto unless you know the domain.
                      </div>
                    </div>
                  )}
                </div>

                {/* Adversarial judge toggle */}
                <div style={{ marginTop: '0.75rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={adversarialJudge}
                      onChange={(e) => setAdversarialJudge(e.target.checked)}
                      style={{ accentColor: '#00f0ff', width: '14px', height: '14px' }}
                    />
                    <span style={{ fontSize: '0.65rem', color: '#7cc6db', fontFamily: MONOSPACE_FONT, letterSpacing: '0.5px' }}>
                      Adversarial Judge (dual AI cross-check)
                    </span>
                  </label>
                  <div style={{ fontSize: '0.58rem', color: '#1e4a5a', marginTop: '0.2rem', marginLeft: '1.6rem', fontFamily: BODY_FONT }}>
                    Runs two independent AI judges and averages their scores for more reliable results.
                  </div>
                </div>

                {/* Time limit */}
                <div>
                  <label style={{ ...FORM_LABEL_STYLE, display: 'block', marginBottom: '0.4rem' }}>
                    Time limit (minutes)
                  </label>
                  <input
                    className="arena-input"
                    type="number" min={1} max={120} value={timeLimitMins}
                    onChange={(e) => setTimeLimitMins(Number(e.target.value))}
                    style={{ width: '7rem' }}
                  />
                </div>

                {/* Next button */}
                <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => toggleStep(2)}
                    style={{
                      fontSize: '0.62rem', fontWeight: 700, padding: '0.4rem 1rem',
                      background: 'rgba(0,240,255,0.12)', color: '#00f0ff',
                      border: '1px solid #00f0ff', borderRadius: '6px',
                      cursor: 'pointer', fontFamily: FONT, letterSpacing: '1px',
                      transition: 'all 0.2s',
                    }}
                  >
                    Next: Rubric {'→'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ────────────────────────────────────────────────────────────────────
              STEP 2: RUBRIC
          ──────────────────────────────────────────────────────────────────── */}
          <div style={{
            marginBottom: '1rem',
            background: '#050f1e',
            border: expandedStep === 2 ? '1px solid #0e3050' : '1px solid #0a2235',
            borderRadius: '12px',
            overflow: 'hidden',
            transition: 'border-color 0.2s',
          }}>
            {/* Step header */}
            <div
              className="step-header"
              onClick={() => toggleStep(2)}
              style={{ padding: '1rem 1.25rem' }}
            >
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.7rem', fontWeight: 800, flexShrink: 0,
                background: step2Done ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.12)',
                color: step2Done ? '#0066ff' : '#eab308',
                border: `1.5px solid ${step2Done ? '#0066ff' : '#eab308'}`,
              }}>
                {step2Done ? '✓' : '2'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c8eef8' }}>
                  {'⚖️'} Rubric
                </div>
                <div style={{ fontSize: '0.6rem', color: '#4a8fa8', marginTop: '0.15rem' }}>
                  Set scoring criteria
                </div>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#1e4a5a', flexShrink: 0 }}>
                {expandedStep === 2 ? '▲' : '▼'}
              </span>
            </div>

            {expandedStep === 2 && (
              <div style={{
                padding: '0 1.25rem 1.5rem',
                animation: 'slideDown 0.3s ease-out',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                  {criteria.map((c, idx) => (
                    <div key={idx} className="criterion-card">
                      {/* Drag handle feel: number badge */}
                      <div style={{
                        position: 'absolute', top: '0.65rem', left: '-0.5px',
                        width: '3px', height: '24px', borderRadius: '0 3px 3px 0',
                        background: '#00f0ff', opacity: 0.6,
                      }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <span style={{
                          fontSize: '0.58rem', fontWeight: 800, color: '#00f0ff',
                          background: 'rgba(0,240,255,0.12)', borderRadius: '4px',
                          padding: '0.15rem 0.45rem', letterSpacing: '0.5px',
                        }}>
                          #{idx + 1}
                        </span>
                        {criteria.length > 1 && (
                          <button
                            type="button" onClick={() => removeCriterion(idx)}
                            style={{
                              marginLeft: 'auto', fontSize: '0.58rem', color: '#1e4a5a',
                              background: 'none', border: 'none', cursor: 'pointer',
                              padding: '0.25rem 0.4rem', fontFamily: FONT,
                              transition: 'color 0.15s', borderRadius: '4px',
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#1e4a5a'; }}
                          >
                            {'✕'} remove
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 5.5rem 5.5rem', gap: '0.6rem', marginBottom: '0.6rem' }}>
                        <div>
                          <label style={{
                            display: 'block', fontSize: '0.5rem', fontWeight: 700,
                            color: '#4a8fa8', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.3rem',
                          }}>ID</label>
                          <input
                            className="arena-input"
                            type="text" required value={c.id}
                            onChange={(e) => updateCriterion(idx, 'id', e.target.value)}
                            onBlur={() => touch('criterion-' + idx)}
                            placeholder="criterion-id"
                          />
                        </div>
                        <div>
                          <label style={{
                            display: 'block', fontSize: '0.5rem', fontWeight: 700,
                            color: '#4a8fa8', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.3rem',
                          }}>Max</label>
                          <input
                            className="arena-input"
                            type="number" min={1} required value={c.maxScore}
                            onChange={(e) => updateCriterion(idx, 'maxScore', Number(e.target.value))}
                          />
                        </div>
                        <div>
                          <label style={{
                            display: 'block', fontSize: '0.5rem', fontWeight: 700,
                            color: '#4a8fa8', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.3rem',
                          }}>Weight %</label>
                          <input
                            className="arena-input"
                            type="number" min={1} max={100} step={1} required value={Math.round(c.weight * 100)}
                            onChange={(e) => updateCriterion(idx, 'weight', Number(e.target.value) / 100)}
                          />
                        </div>
                      </div>
                      <div>
                        <label style={{
                          display: 'block', fontSize: '0.5rem', fontWeight: 700,
                          color: '#4a8fa8', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.3rem',
                        }}>Description</label>
                        <input
                          className="arena-input"
                          type="text" required value={c.description}
                          onChange={(e) => updateCriterion(idx, 'description', e.target.value)}
                          onBlur={() => touch('criterion-' + idx)}
                          placeholder="What this criterion evaluates"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {touched.has('criteria') && errors.criteria && (
                  <p style={{ color: '#ef4444', fontSize: '0.6rem', marginTop: '0.25rem', margin: '0.2rem 0 0.5rem' }}>
                    {errors.criteria}
                  </p>
                )}

                <button
                  type="button" onClick={addCriterion}
                  style={{
                    fontSize: '0.62rem', fontWeight: 600, color: '#4a8fa8', background: 'none',
                    border: '1px dashed #0a2235', borderRadius: '8px',
                    padding: '0.5rem 0.85rem', cursor: 'pointer', fontFamily: FONT,
                    transition: 'border-color 0.15s, color 0.15s', marginBottom: '1.25rem',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => { const b = e.currentTarget; b.style.borderColor = '#00f0ff'; b.style.color = '#00f0ff'; }}
                  onMouseLeave={(e) => { const b = e.currentTarget; b.style.borderColor = '#0a2235'; b.style.color = '#4a8fa8'; }}
                >
                  + Add criterion
                </button>

                {/* Expected output */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ ...FORM_LABEL_STYLE, display: 'block', marginBottom: '0.4rem' }}>
                    Expected output
                    <span style={{ color: '#1e4a5a', fontWeight: 400, marginLeft: '0.5rem', textTransform: 'none', letterSpacing: '0' }}>
                      optional -- enables automated correctness scoring
                    </span>
                  </label>
                  <textarea
                    className="arena-input"
                    value={expectedOutput} onChange={(e) => setExpectedOutput(e.target.value)}
                    rows={4} placeholder="Paste expected stdout here, one line per output..."
                    style={{ resize: 'vertical', lineHeight: 1.6 }}
                  />
                </div>

                {/* Next button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                  <button
                    type="button"
                    onClick={() => toggleStep(3)}
                    style={{
                      fontSize: '0.62rem', fontWeight: 700, padding: '0.4rem 1rem',
                      background: 'rgba(0,240,255,0.12)', color: '#00f0ff',
                      border: '1px solid #00f0ff', borderRadius: '6px',
                      cursor: 'pointer', fontFamily: FONT, letterSpacing: '1px',
                      transition: 'all 0.2s',
                    }}
                  >
                    Next: Agents {'→'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ────────────────────────────────────────────────────────────────────
              STEP 3: AGENTS
          ──────────────────────────────────────────────────────────────────── */}
          <div style={{
            marginBottom: '2rem',
            background: '#050f1e',
            border: expandedStep === 3 ? '1px solid #0e3050' : '1px solid #0a2235',
            borderRadius: '12px',
            overflow: 'hidden',
            transition: 'border-color 0.2s',
          }}>
            {/* Step header */}
            <div
              className="step-header"
              onClick={() => toggleStep(3)}
              style={{ padding: '1rem 1.25rem' }}
            >
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.7rem', fontWeight: 800, flexShrink: 0,
                background: 'rgba(168,85,247,0.12)',
                color: '#00f0ff',
                border: '1.5px solid #00f0ff',
              }}>
                3
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c8eef8' }}>
                  {'🤖'} Agents
                </div>
                <div style={{ fontSize: '0.6rem', color: '#4a8fa8', marginTop: '0.15rem' }}>
                  Choose your fighters
                </div>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#1e4a5a', flexShrink: 0 }}>
                {expandedStep === 3 ? '▲' : '▼'}
              </span>
            </div>

            {expandedStep === 3 && (
              <div style={{
                padding: '0 1.25rem 1.5rem',
                animation: 'slideDown 0.3s ease-out',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1rem' }}>
                  {teams.map((team, i) => {
                    const agentLabel = String.fromCharCode(65 + i);
                    const agentColors = ['#3b82f6', '#00f0ff', '#0066ff', '#00f0ff'];
                    const agentColor = agentColors[i] ?? '#4a8fa8';
                    return (
                      <div key={team.id} style={{ position: 'relative' }}>
                        <div style={{
                          fontSize: '0.58rem', fontWeight: 700, color: agentColor,
                          letterSpacing: '2px', marginBottom: '0.75rem',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{
                              width: '6px', height: '6px', borderRadius: '50%',
                              background: agentColor, display: 'inline-block',
                            }} />
                            {`AGENT ${agentLabel}`}
                          </div>
                          {teams.length > 2 && (
                            <button
                              type="button"
                              onClick={() => setTeams((prev) => prev.filter((_, idx) => idx !== i))}
                              style={{
                                background: 'none', border: 'none', color: '#1e4a5a',
                                cursor: 'pointer', fontSize: '0.75rem', padding: '0.1rem 0.3rem',
                                lineHeight: 1,
                              }}
                              title="Remove agent"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        {/* Model cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.85rem' }}>
                          {(['claude', 'codex', 'gemini'] as Model[]).map((m) => {
                            const meta = MODEL_META[m];
                            const active = team.model === m;
                            return (
                              <div
                                key={m}
                                className={`model-card ${active ? 'active' : ''}`}
                                onClick={() => {
                                  setTeams((prev) => prev.map((t, idx) => idx === i ? { ...t, model: m, agentId: undefined } : t));
                                  void loadAgentsForProvider(team.id, m);
                                }}
                                style={{
                                  border: `1px solid ${active ? meta.color : '#0a2235'}`,
                                  boxShadow: active ? `0 0 16px ${meta.glowColor}, 0 4px 8px rgba(0,0,0,0.3)` : 'none',
                                  background: active ? `linear-gradient(135deg, ${meta.color}12, ${meta.color}06)` : '#050f1e',
                                }}
                              >
                                <div style={{ fontSize: '1.5rem', marginBottom: '0.35rem' }}>{meta.emoji}</div>
                                <div style={{
                                  fontSize: '0.62rem', fontWeight: 700,
                                  color: active ? meta.color : '#4a8fa8',
                                }}>
                                  {meta.label}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Agent */}
                        <label style={{
                          display: 'block', fontSize: '0.5rem', fontWeight: 700,
                          color: '#4a8fa8', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.4rem',
                        }}>
                          Agent
                        </label>
                        {/* Agent search */}
                        <input
                          type="text"
                          value={agentSearchByTeam[team.id] ?? ''}
                          onChange={e => setAgentSearchByTeam(prev => ({ ...prev, [team.id]: e.target.value }))}
                          placeholder="Search agents…"
                          style={{
                            background: 'rgba(0,4,8,0.6)', border: '1px solid rgba(0,240,255,0.12)',
                            borderRadius: '6px', padding: '0.3rem 0.6rem',
                            color: '#c8eef8', fontSize: '0.62rem', outline: 'none',
                            marginBottom: '0.5rem', width: '100%', boxSizing: 'border-box',
                            fontFamily: BODY_FONT,
                          }}
                        />
                        {/* Agent chips */}
                        {loadingAgentsByTeam[team.id] ? (
                          <div style={{ color: '#3d7d94', fontSize: '0.62rem', fontFamily: MONOSPACE_FONT, marginBottom: '0.5rem' }}>Loading agents…</div>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                            {(agentChipsByTeam[team.id] ?? [])
                              .filter(a => {
                                const search = agentSearchByTeam[team.id] ?? '';
                                return search === '' || a.name.toLowerCase().startsWith(search.toLowerCase());
                              })
                              .map(agent => {
                                const isSelected = team.agentId === agent.id;
                                return (
                                  <button
                                    key={agent.id}
                                    type="button"
                                    onClick={() => selectAgent(team.id, agent)}
                                    style={{
                                      fontSize: '0.62rem',
                                      fontWeight: isSelected ? 800 : 600,
                                      padding: '0.25rem 0.55rem',
                                      borderRadius: '4px',
                                      border: isSelected ? '1px solid rgba(0,240,255,0.5)' : '1px dashed rgba(0,240,255,0.2)',
                                      background: isSelected ? 'rgba(0,240,255,0.08)' : 'transparent',
                                      color: isSelected ? '#00f0ff' : '#3d7d94',
                                      cursor: 'pointer',
                                      fontFamily: MONOSPACE_FONT,
                                    }}
                                  >
                                    {agent.persona?.avatar ?? '🤖'} {agent.name}
                                    {agent.modelVariant && (
                                      <span style={{ fontSize: '0.5rem', color: '#4a8fa8', display: 'block', marginTop: 2 }}>
                                        {agent.modelVariant}
                                      </span>
                                    )}
                                  </button>
                                );
                              })
                            }
                            <a href="/agent-armory" target="_blank" style={{ fontSize: '0.58rem', color: '#3d7d94', fontFamily: BODY_FONT, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                              + Armory
                            </a>
                          </div>
                        )}
                        <input
                          className="arena-input"
                          type="text" value={team.persona}
                          onChange={(e) => setTeams((prev) => prev.map((t, idx) => idx === i ? { ...t, persona: e.target.value, agentId: undefined } : t))}
                          placeholder="or type persona name…"
                          style={{ fontSize: '0.65rem' }}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Add Agent button */}
                <div style={{ marginBottom: '1rem' }}>
                  <button
                    type="button"
                    disabled={teams.length >= 4}
                    onClick={() => {
                      const teamIds = ['team-a', 'team-b', 'team-c', 'team-d'];
                      setTeams((prev) => [...prev, { id: teamIds[prev.length] ?? `team-${prev.length}`, model: 'claude' as Model, persona: 'pragmatist' }]);
                    }}
                    style={{
                      fontSize: '0.6rem', fontWeight: 700, letterSpacing: '1px',
                      padding: '0.4rem 0.85rem',
                      background: 'none',
                      border: '1px dashed #0a2235',
                      borderRadius: '6px',
                      color: teams.length >= 4 ? '#0a2235' : '#4a8fa8',
                      cursor: teams.length >= 4 ? 'not-allowed' : 'pointer',
                      fontFamily: FONT,
                    }}
                  >
                    ＋ Add Agent
                  </button>
                </div>

                {/* Matchup preview */}
                <div style={{
                  marginTop: '0.5rem', padding: '0.85rem 1rem',
                  background: '#010810', borderRadius: '8px',
                  border: '1px solid #0a2235',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: '0.75rem', flexWrap: 'wrap',
                }}>
                  {teams.map((team, i) => (
                    <React.Fragment key={team.id ?? i}>
                      {i > 0 && <span key={`vs-${i}`} style={{ fontSize: '0.8rem', color: '#1e4a5a', fontWeight: 800 }}>vs</span>}
                      <span key={team.id} style={{ fontSize: '0.72rem', fontWeight: 700, color: MODEL_META[team.model].color }}>
                        {MODEL_META[team.model].emoji} {team.model}:{team.persona}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Error ── */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', padding: '0.85rem 1.15rem',
              color: '#ef4444', fontSize: '0.7rem', marginBottom: '1.25rem',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              animation: 'fadeInUp 0.3s ease-out',
            }}>
              <span>{'❌'}</span>
              {error}
            </div>
          )}

          {/* ── Quality Report ── */}
          {qualityLoading && (
            <div style={{
              marginBottom: '1rem', padding: '0.65rem 1rem',
              background: 'rgba(0,240,255,0.04)', border: '1px solid rgba(0,240,255,0.15)',
              borderRadius: '8px', fontSize: '0.62rem', color: '#4a8fa8',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}>
              <span style={{ display: 'inline-block', width: '0.7rem', height: '0.7rem', border: '2px solid rgba(0,240,255,0.4)', borderTopColor: '#00f0ff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              Running quality check...
            </div>
          )}
          {qualityReport && !qualityLoading && (
            <div style={{
              marginBottom: '1rem', padding: '0.85rem 1rem',
              background: '#050f1e', border: '1px solid #0a2235',
              borderRadius: '8px', animation: 'fadeInUp 0.3s ease-out',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: qualityReport.issues.length > 0 ? '0.65rem' : 0 }}>
                <span style={{ fontSize: '0.55rem', fontWeight: 700, color: '#4a8fa8', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  QUALITY
                </span>
                <div style={{
                  flex: 1, height: '6px', background: '#0a2235', borderRadius: '3px',
                  overflow: 'hidden', maxWidth: '200px',
                }}>
                  <div style={{
                    width: `${Math.round(qualityReport.overallScore * 100)}%`,
                    height: '100%', borderRadius: '3px',
                    background: qualityReport.overallScore >= 0.8
                      ? '#00f0ff'
                      : qualityReport.overallScore >= 0.6
                        ? '#eab308'
                        : '#ef4444',
                    transition: 'width 0.5s ease',
                  }} />
                </div>
                <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#c8eef8' }}>
                  {Math.round(qualityReport.overallScore * 100)}%
                </span>
                {qualityReport.launchReady && (
                  <span style={{
                    fontSize: '0.48rem', fontWeight: 700, padding: '0.1rem 0.4rem',
                    borderRadius: '3px', letterSpacing: '0.8px',
                    background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                  }}>
                    LAUNCH READY
                  </span>
                )}
              </div>
              {qualityReport.issues.length > 0 && (
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {qualityReport.issues.map((issue, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: '0.5rem', fontWeight: 700, padding: '0.12rem 0.45rem',
                        borderRadius: '3px', letterSpacing: '0.5px',
                        background: issue.severity === 'error'
                          ? 'rgba(239,68,68,0.12)'
                          : 'rgba(234,179,8,0.12)',
                        color: issue.severity === 'error' ? '#ef4444' : '#eab308',
                      }}
                      title={`${issue.field}: ${issue.message}`}
                    >
                      {issue.severity === 'error' ? '!' : '~'} {issue.message}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Save toast ── */}
          {saveToast && (
            <div style={{
              marginBottom: '1rem', padding: '0.5rem 1rem',
              borderRadius: '6px', fontSize: '0.62rem', fontWeight: 600,
              background: saveToast.startsWith('Failed') ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
              border: `1px solid ${saveToast.startsWith('Failed') ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
              color: saveToast.startsWith('Failed') ? '#ef4444' : '#22c55e',
              animation: 'fadeInUp 0.2s ease-out',
            }}>
              {saveToast}
            </div>
          )}

          {/* ── Launch + Save buttons ── */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              className="launch-btn arena-btn-primary"
              type="submit"
              disabled={submitting || hasErrors}
              style={{
                flex: 1,
                background: submitting
                  ? '#081520'
                  : 'linear-gradient(135deg, #00f0ff, #ea580c, #00f0ff)',
                color: submitting ? '#1e4a5a' : '#000408',
                boxShadow: submitting
                  ? 'none'
                  : '0 0 20px rgba(0,240,255,0.3), 0 4px 12px rgba(0,0,0,0.3)',
                opacity: hasErrors ? 0.5 : 1,
              }}
            >
              {submitting ? (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>
                  <span style={{
                    display: 'inline-block', width: '14px', height: '14px',
                    border: '2px solid #1e4a5a', borderTopColor: 'transparent',
                    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                  }} />
                  Launching...
                </span>
              ) : (
                <span>{'🚀'} LAUNCH COMPETITION</span>
              )}
            </button>
            {title.trim() && problem.trim() && (
              <button
                type="button"
                onClick={handleSaveToLibrary}
                style={{
                  fontSize: '0.62rem', fontWeight: 700, padding: '0.55rem 1rem',
                  background: 'rgba(0,128,255,0.08)', color: '#0080ff',
                  border: '1px solid rgba(0,128,255,0.35)', borderRadius: '6px',
                  cursor: 'pointer', fontFamily: FONT, letterSpacing: '0.5px',
                  transition: 'all 0.15s', flexShrink: 0,
                }}
              >
                {editBriefId ? '📚 Update in Library' : '📚 Save to Library'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
