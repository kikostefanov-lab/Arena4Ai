'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EXAMPLE_BRIEFS, type ExampleBrief } from '../../../lib/example-briefs';
import './new-competition.css';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RubricCriterion {
  id: string;
  description: string;
  maxScore: number;
  weight: number;
}

type Format = 'SPRINT' | 'HACKATHON' | 'RELAY_RACE' | 'RED_VS_BLUE';
type Model = 'claude' | 'codex' | 'gemini';

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
  HACKATHON:   { emoji: '🔨', label: 'Hackathon',    subtitle: 'Deep 2-hour build',        color: '#a855f7', glowColor: 'rgba(168,85,247,0.35)'  },
  RELAY_RACE:  { emoji: '🔄', label: 'Relay Race',   subtitle: 'Pass the baton',           color: '#22c55e', glowColor: 'rgba(34,197,94,0.35)'   },
  RED_VS_BLUE: { emoji: '⚔️', label: 'Red vs Blue',  subtitle: 'Attack & Defend',           color: '#ef4444', glowColor: 'rgba(239,68,68,0.35)'   },
};

const MODEL_META: Record<Model, { emoji: string; label: string; color: string; glowColor: string }> = {
  claude: { emoji: '🟠', label: 'Claude', color: '#f97316', glowColor: 'rgba(249,115,22,0.4)'  },
  codex:  { emoji: '🟢', label: 'Codex',  color: '#22c55e', glowColor: 'rgba(34,197,94,0.4)'   },
  gemini: { emoji: '🟣', label: 'Gemini', color: '#a855f7', glowColor: 'rgba(168,85,247,0.4)'  },
};

const PERSONAS = ['speedrunner', 'architect', 'pragmatist', 'researcher', 'adversarial', 'defender', 'pioneer'];

const FONT = "'SF Mono', 'Fira Code', 'Cascadia Code', monospace";

// ─── ExampleChips ─────────────────────────────────────────────────────────────

function ExampleChips({
  examples, value, onChange,
}: {
  examples: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const existing = new Set(value.split('\n').map((s) => s.trim()).filter(Boolean));
  const available = examples.filter((e) => !existing.has(e));
  if (available.length === 0) return null;

  const add = (ex: string) => {
    const trimmed = value.trim();
    onChange(trimmed ? `${trimmed}\n${ex}` : ex);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.4rem' }}>
      <span style={{ fontSize: '0.5rem', color: '#4a5568', alignSelf: 'center', flexShrink: 0 }}>e.g.</span>
      {available.map((ex) => (
        <button
          key={ex}
          type="button"
          onClick={() => add(ex)}
          style={{
            fontSize: '0.5rem', padding: '0.15rem 0.45rem',
            background: 'rgba(30,45,69,0.6)', color: '#8896ab',
            border: '1px solid #1e2d45', borderRadius: '4px',
            cursor: 'pointer', fontFamily: FONT,
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(249,115,22,0.1)';
            (e.currentTarget as HTMLButtonElement).style.color = '#f97316';
            (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(249,115,22,0.4)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(30,45,69,0.6)';
            (e.currentTarget as HTMLButtonElement).style.color = '#8896ab';
            (e.currentTarget as HTMLButtonElement).style.borderColor = '#1e2d45';
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

  // Step expansion state
  const [expandedStep, setExpandedStep] = useState<1 | 2 | 3>(1);

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

  // Form state
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<Format>('SPRINT');
  const [problem, setProblem] = useState('');
  const [constraints, setConstraints] = useState(FORMAT_PRESETS['SPRINT'].constraints);
  const [deliverables, setDeliverables] = useState(FORMAT_PRESETS['SPRINT'].deliverables);
  const [timeLimitMins, setTimeLimitMins] = useState(FORMAT_PRESETS['SPRINT'].timeLimitMins);
  const [criteria, setCriteria] = useState<RubricCriterion[]>(FORMAT_PRESETS['SPRINT'].criteria);
  const [expectedOutput, setExpectedOutput] = useState('');
  const [teamAModel, setTeamAModel] = useState<Model>('claude');
  const [teamAPersona, setTeamAPersona] = useState('speedrunner');
  const [teamBModel, setTeamBModel] = useState<Model>('claude');
  const [teamBPersona, setTeamBPersona] = useState('architect');

  // Pre-fill from a previous competition if ?from=<id>
  useEffect(() => {
    const fromId = searchParams.get('from');
    if (!fromId) return;
    fetch(`/api/competitions/${fromId}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { brief?: { title?: string; problem?: string; format?: string; timeLimitMs?: number; constraints?: string[]; deliverables?: string[]; rubric?: { criteria: RubricCriterion[] } }; teams?: { model?: string }[] } | null) => {
        if (!data?.brief) return;
        const b = data.brief;
        if (b.title) setTitle(b.title);
        if (b.problem) setProblem(b.problem);
        if (b.format && ['SPRINT','HACKATHON','RELAY_RACE','RED_VS_BLUE'].includes(b.format)) setFormat(b.format as Format);
        if (b.timeLimitMs) setTimeLimitMins(Math.round(b.timeLimitMs / 60000));
        if (b.constraints?.length) setConstraints(b.constraints.join('\n'));
        if (b.deliverables?.length) setDeliverables(b.deliverables.join('\n'));
        if (b.rubric?.criteria?.length) setCriteria(b.rubric.criteria);
        if (data.teams?.length === 2) {
          const [a, b2] = data.teams;
          const [aProvider, aPersona] = (a.model ?? '').split(':');
          const [bProvider, bPersona] = (b2.model ?? '').split(':');
          if (aProvider) setTeamAModel(aProvider as Model);
          if (aPersona) setTeamAPersona(aPersona);
          if (bProvider) setTeamBModel(bProvider as Model);
          if (bPersona) setTeamBPersona(bPersona);
        }
      })
      .catch(() => {});
  }, [searchParams]);

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

  const generateBrief = async () => {
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
      if (brief.constraints) setConstraints(brief.constraints);
      if (brief.deliverables) setDeliverables(brief.deliverables);
      if (brief.expectedOutput !== undefined) setExpectedOutput(brief.expectedOutput);
      if (brief.criteria) setCriteria(brief.criteria);
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
        showToast('success', `Brief "${parsed.title ?? 'untitled'}" imported successfully.`);
      } catch {
        showToast('error', 'Failed to parse YAML file. Check the format and try again.');
      }
    };
    reader.onerror = () => showToast('error', 'Failed to read file.');
    reader.readAsText(file);
  };

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
        },
        teams: [
          { id: 'team-a', model: teamAModel, persona: teamAPersona },
          { id: 'team-b', model: teamBModel, persona: teamBPersona },
        ],
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
      background: '#0a0e17',
      color: '#e2e8f0',
      fontFamily: FONT,
    }}>
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2.5rem 1.5rem 4rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem', animation: 'fadeInUp 0.4s ease-out' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.2rem' }}>
            <a href="/" style={{ fontSize: '0.6rem', color: '#f97316', fontWeight: 700, letterSpacing: '2px', textDecoration: 'none' }}>
              {'◆'} ARENA
            </a>
            <span style={{ color: '#1e2d45' }}>{'│'}</span>
            <span style={{ fontSize: '0.6rem', color: '#8896ab', letterSpacing: '1px' }}>NEW COMPETITION</span>
          </div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#e2e8f0', margin: 0, lineHeight: 1.2 }}>
            Launch a Competition
          </h1>
          <p style={{ fontSize: '0.72rem', color: '#8896ab', marginTop: '0.5rem', lineHeight: 1.6 }}>
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
              color: importToast.type === 'success' ? '#22c55e' : '#ef4444',
            }}>
              {importToast.type === 'success' ? '✓' : '✗'} {importToast.message}
            </div>
          )}

          {/* ────────────────────────────────────────────────────────────────────
              EXAMPLE BRIEFS PANEL
          ──────────────────────────────────────────────────────────────────── */}
          <div style={{
            marginBottom: '1rem',
            background: '#111827',
            border: '1px solid #1e2d45',
            borderRadius: '12px',
            overflow: 'hidden',
            transition: 'border-color 0.2s',
            ...(examplePanelOpen ? { borderColor: '#2d4060' } : {}),
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
                fontSize: '0.6rem', fontWeight: 700, color: '#f97316',
                background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.3)',
                borderRadius: '4px', padding: '0.15rem 0.45rem', letterSpacing: '0.5px',
                flexShrink: 0,
              }}>
                QUICK START
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#e2e8f0' }}>
                  Quick start from example
                </span>
                <span style={{ fontSize: '0.6rem', color: '#4a5568', marginLeft: '0.5rem' }}>
                  load a pre-built brief as your starting point
                </span>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#4a5568', flexShrink: 0 }}>
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
                  background: 'rgba(30,45,69,0.6)', color: '#8896ab',
                  border: '1px solid #1e2d45',
                }}
                onMouseEnter={(e) => {
                  const btn = e.currentTarget as HTMLButtonElement;
                  btn.style.background = 'rgba(249,115,22,0.1)';
                  btn.style.color = '#f97316';
                  btn.style.borderColor = 'rgba(249,115,22,0.4)';
                }}
                onMouseLeave={(e) => {
                  const btn = e.currentTarget as HTMLButtonElement;
                  btn.style.background = 'rgba(30,45,69,0.6)';
                  btn.style.color = '#8896ab';
                  btn.style.borderColor = '#1e2d45';
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
                          background: brief.difficulty === 'SAVAGE' ? 'rgba(239,68,68,0.15)' : brief.difficulty === 'EXTREME' ? 'rgba(249,115,22,0.15)' : 'rgba(234,179,8,0.15)',
                          color: brief.difficulty === 'SAVAGE' ? '#ef4444' : brief.difficulty === 'EXTREME' ? '#f97316' : '#eab308',
                        }}>{brief.difficulty}</span>
                      </div>
                      <div style={{
                        fontSize: '0.65rem', fontWeight: 700, color: '#e2e8f0',
                        marginBottom: '0.2rem', lineHeight: 1.2,
                      }}>
                        {brief.title}
                      </div>
                      <div style={{ fontSize: '0.52rem', color: '#4a5568' }}>
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
            background: '#111827',
            border: '1px solid #1e2d45',
            borderRadius: '12px',
            overflow: 'hidden',
            transition: 'border-color 0.2s',
            ...(expandedStep === 1 ? { borderColor: '#2d4060' } : {}),
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
                background: step1Done ? 'rgba(34,197,94,0.15)' : 'rgba(249,115,22,0.15)',
                color: step1Done ? '#22c55e' : '#f97316',
                border: `1.5px solid ${step1Done ? '#22c55e' : '#f97316'}`,
              }}>
                {step1Done ? '✓' : '1'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#e2e8f0' }}>
                  {'📋'} Brief
                </div>
                <div style={{ fontSize: '0.6rem', color: '#8896ab', marginTop: '0.15rem' }}>
                  Define the challenge
                </div>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#4a5568', flexShrink: 0 }}>
                {expandedStep === 1 ? '▲' : '▼'}
              </span>
            </div>

            {/* Step content */}
            {expandedStep === 1 && (
              <div style={{
                padding: '0 1.25rem 1.5rem',
                animation: 'slideDown 0.3s ease-out',
              }}>
                {/* Format preset cards */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{
                    display: 'block', fontSize: '0.55rem', fontWeight: 700,
                    color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.65rem',
                  }}>
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
                            borderColor: active ? meta.color : '#1e2d45',
                            background: active ? `linear-gradient(135deg, ${meta.color}10, ${meta.color}05)` : '#111827',
                            boxShadow: active ? `0 0 20px ${meta.glowColor}, 0 4px 12px rgba(0,0,0,0.3)` : '0 2px 8px rgba(0,0,0,0.2)',
                          }}
                        >
                          <div style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>{meta.emoji}</div>
                          <div style={{
                            fontSize: '0.68rem', fontWeight: 700,
                            color: active ? meta.color : '#e2e8f0',
                            marginBottom: '0.25rem',
                          }}>
                            {meta.label}
                          </div>
                          <div style={{
                            fontSize: '0.55rem',
                            color: active ? meta.color : '#4a5568',
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
                  <label style={{
                    display: 'block', fontSize: '0.55rem', fontWeight: 700,
                    color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.4rem',
                  }}>
                    Competition title
                  </label>
                  <input
                    className="arena-input"
                    type="text" required value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => touch('title')}
                    placeholder="e.g. Cheapest NYC Flight · FizzBuzz Sprint · GPU Comparison"
                    style={{ borderColor: touched.has('title') && errors.title ? '#ef4444' : undefined }}
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
                      <label style={{
                        display: 'block', fontSize: '0.55rem', fontWeight: 700,
                        color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px',
                      }}>
                        Problem statement
                      </label>
                      <button
                        type="button"
                        onClick={() => { setShowGenerator((v) => !v); setGenerateError(''); }}
                        style={{
                          fontSize: '0.58rem', fontWeight: 700, padding: '0.25rem 0.65rem',
                          background: showGenerator ? 'rgba(249,115,22,0.2)' : 'rgba(249,115,22,0.08)',
                          color: '#f97316',
                          border: '1px solid rgba(249,115,22,0.5)',
                          borderRadius: '6px', cursor: 'pointer', fontFamily: FONT,
                          letterSpacing: '0.5px', transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(249,115,22,0.2)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = showGenerator ? 'rgba(249,115,22,0.2)' : 'rgba(249,115,22,0.08)'; }}
                      >
                        {showGenerator ? '✕ Close' : '✨ Generate from idea'}
                      </button>
                    </div>

                    {showGenerator && (
                      <div style={{
                        background: '#0d1520',
                        border: '1px solid rgba(249,115,22,0.35)',
                        borderRadius: '8px',
                        padding: '0.85rem 1rem',
                        animation: 'slideDown 0.25s ease-out',
                      }}>
                        <p style={{ fontSize: '0.6rem', color: '#8896ab', margin: '0 0 0.5rem', lineHeight: 1.5 }}>
                          Describe your idea in plain English and AI will expand it into a full brief.
                        </p>
                        <textarea
                          className="arena-input"
                          rows={3}
                          value={ideaText}
                          onChange={(e) => setIdeaText(e.target.value)}
                          placeholder={'e.g. A script that finds the cheapest flight from NYC to London next month\ne.g. A REST API that converts Markdown to HTML with caching\ne.g. Compare sorting algorithms and benchmark them'}
                          style={{ resize: 'vertical', lineHeight: 1.6, marginBottom: '0.65rem' }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          <button
                            type="button"
                            onClick={generateBrief}
                            disabled={generating || ideaText.trim().length < 10}
                            style={{
                              fontSize: '0.62rem', fontWeight: 800, padding: '0.4rem 1rem',
                              background: generating || ideaText.trim().length < 10
                                ? 'rgba(249,115,22,0.2)'
                                : 'rgba(249,115,22,0.85)',
                              color: generating || ideaText.trim().length < 10 ? 'rgba(249,115,22,0.5)' : '#fff',
                              border: '1px solid rgba(249,115,22,0.6)',
                              borderRadius: '6px', cursor: generating || ideaText.trim().length < 10 ? 'not-allowed' : 'pointer',
                              fontFamily: FONT, letterSpacing: '1px', transition: 'all 0.2s',
                            }}
                          >
                            {generating ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ display: 'inline-block', width: '0.7rem', height: '0.7rem', border: '2px solid rgba(249,115,22,0.4)', borderTopColor: '#f97316', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                Generating...
                              </span>
                            ) : 'Generate ✨'}
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
                    style={{ resize: 'vertical', lineHeight: 1.6, borderColor: touched.has('problem') && errors.problem ? '#ef4444' : undefined }}
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
                    <label style={{
                      display: 'block', fontSize: '0.55rem', fontWeight: 700,
                      color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.4rem',
                    }}>
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
                    <label style={{
                      display: 'block', fontSize: '0.55rem', fontWeight: 700,
                      color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.4rem',
                    }}>
                      Deliverables (one per line)
                    </label>
                    <textarea
                      className="arena-input"
                      value={deliverables} onChange={(e) => setDeliverables(e.target.value)}
                      rows={3} placeholder={'report.md with findings\nRanked options with prices'}
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

                {/* Time limit */}
                <div>
                  <label style={{
                    display: 'block', fontSize: '0.55rem', fontWeight: 700,
                    color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.4rem',
                  }}>
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
                      background: 'rgba(249,115,22,0.12)', color: '#f97316',
                      border: '1px solid #f97316', borderRadius: '6px',
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
            background: '#111827',
            border: '1px solid #1e2d45',
            borderRadius: '12px',
            overflow: 'hidden',
            transition: 'border-color 0.2s',
            ...(expandedStep === 2 ? { borderColor: '#2d4060' } : {}),
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
                color: step2Done ? '#22c55e' : '#eab308',
                border: `1.5px solid ${step2Done ? '#22c55e' : '#eab308'}`,
              }}>
                {step2Done ? '✓' : '2'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#e2e8f0' }}>
                  {'⚖️'} Rubric
                </div>
                <div style={{ fontSize: '0.6rem', color: '#8896ab', marginTop: '0.15rem' }}>
                  Set scoring criteria
                </div>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#4a5568', flexShrink: 0 }}>
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
                        background: '#f97316', opacity: 0.6,
                      }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <span style={{
                          fontSize: '0.58rem', fontWeight: 800, color: '#f97316',
                          background: 'rgba(249,115,22,0.12)', borderRadius: '4px',
                          padding: '0.15rem 0.45rem', letterSpacing: '0.5px',
                        }}>
                          #{idx + 1}
                        </span>
                        {criteria.length > 1 && (
                          <button
                            type="button" onClick={() => removeCriterion(idx)}
                            style={{
                              marginLeft: 'auto', fontSize: '0.58rem', color: '#4a5568',
                              background: 'none', border: 'none', cursor: 'pointer',
                              padding: '0.25rem 0.4rem', fontFamily: FONT,
                              transition: 'color 0.15s', borderRadius: '4px',
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#4a5568'; }}
                          >
                            {'✕'} remove
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 5.5rem 5.5rem', gap: '0.6rem', marginBottom: '0.6rem' }}>
                        <div>
                          <label style={{
                            display: 'block', fontSize: '0.5rem', fontWeight: 700,
                            color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.3rem',
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
                            color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.3rem',
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
                            color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.3rem',
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
                          color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.3rem',
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
                    fontSize: '0.62rem', fontWeight: 600, color: '#8896ab', background: 'none',
                    border: '1px dashed #1e2d45', borderRadius: '8px',
                    padding: '0.5rem 0.85rem', cursor: 'pointer', fontFamily: FONT,
                    transition: 'border-color 0.15s, color 0.15s', marginBottom: '1.25rem',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => { const b = e.currentTarget; b.style.borderColor = '#f97316'; b.style.color = '#f97316'; }}
                  onMouseLeave={(e) => { const b = e.currentTarget; b.style.borderColor = '#1e2d45'; b.style.color = '#8896ab'; }}
                >
                  + Add criterion
                </button>

                {/* Expected output */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{
                    display: 'block', fontSize: '0.55rem', fontWeight: 700,
                    color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.4rem',
                  }}>
                    Expected output
                    <span style={{ color: '#4a5568', fontWeight: 400, marginLeft: '0.5rem', textTransform: 'none', letterSpacing: '0' }}>
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
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => toggleStep(3)}
                    style={{
                      fontSize: '0.62rem', fontWeight: 700, padding: '0.4rem 1rem',
                      background: 'rgba(249,115,22,0.12)', color: '#f97316',
                      border: '1px solid #f97316', borderRadius: '6px',
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
            background: '#111827',
            border: '1px solid #1e2d45',
            borderRadius: '12px',
            overflow: 'hidden',
            transition: 'border-color 0.2s',
            ...(expandedStep === 3 ? { borderColor: '#2d4060' } : {}),
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
                color: '#a855f7',
                border: '1.5px solid #a855f7',
              }}>
                3
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#e2e8f0' }}>
                  {'🤖'} Agents
                </div>
                <div style={{ fontSize: '0.6rem', color: '#8896ab', marginTop: '0.15rem' }}>
                  Choose your fighters
                </div>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#4a5568', flexShrink: 0 }}>
                {expandedStep === 3 ? '▲' : '▼'}
              </span>
            </div>

            {expandedStep === 3 && (
              <div style={{
                padding: '0 1.25rem 1.5rem',
                animation: 'slideDown 0.3s ease-out',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                  {/* ── Agent A ── */}
                  <div>
                    <div style={{
                      fontSize: '0.58rem', fontWeight: 700, color: '#3b82f6',
                      letterSpacing: '2px', marginBottom: '0.75rem',
                      display: 'flex', alignItems: 'center', gap: '0.4rem',
                    }}>
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: '#3b82f6', display: 'inline-block',
                      }} />
                      AGENT A
                    </div>

                    {/* Model cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.85rem' }}>
                      {(['claude', 'codex', 'gemini'] as Model[]).map((m) => {
                        const meta = MODEL_META[m];
                        const active = teamAModel === m;
                        return (
                          <div
                            key={m}
                            className={`model-card ${active ? 'active' : ''}`}
                            onClick={() => setTeamAModel(m)}
                            style={{
                              borderColor: active ? meta.color : '#1e2d45',
                              boxShadow: active ? `0 0 16px ${meta.glowColor}, 0 4px 8px rgba(0,0,0,0.3)` : 'none',
                              background: active ? `linear-gradient(135deg, ${meta.color}12, ${meta.color}06)` : '#111827',
                            }}
                          >
                            <div style={{ fontSize: '1.5rem', marginBottom: '0.35rem' }}>{meta.emoji}</div>
                            <div style={{
                              fontSize: '0.62rem', fontWeight: 700,
                              color: active ? meta.color : '#8896ab',
                            }}>
                              {meta.label}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Persona */}
                    <label style={{
                      display: 'block', fontSize: '0.5rem', fontWeight: 700,
                      color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.4rem',
                    }}>
                      Persona
                    </label>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                      {PERSONAS.map((p) => (
                        <button
                          key={p} type="button"
                          className={`persona-chip ${teamAPersona === p ? 'active' : ''}`}
                          onClick={() => setTeamAPersona(p)}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <input
                      className="arena-input"
                      type="text" value={teamAPersona}
                      onChange={(e) => setTeamAPersona(e.target.value)}
                      placeholder="or type custom persona..."
                      style={{ fontSize: '0.65rem' }}
                    />
                  </div>

                  {/* ── Agent B ── */}
                  <div>
                    <div style={{
                      fontSize: '0.58rem', fontWeight: 700, color: '#a855f7',
                      letterSpacing: '2px', marginBottom: '0.75rem',
                      display: 'flex', alignItems: 'center', gap: '0.4rem',
                    }}>
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: '#a855f7', display: 'inline-block',
                      }} />
                      AGENT B
                    </div>

                    {/* Model cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.85rem' }}>
                      {(['claude', 'codex', 'gemini'] as Model[]).map((m) => {
                        const meta = MODEL_META[m];
                        const active = teamBModel === m;
                        return (
                          <div
                            key={m}
                            className={`model-card ${active ? 'active' : ''}`}
                            onClick={() => setTeamBModel(m)}
                            style={{
                              borderColor: active ? meta.color : '#1e2d45',
                              boxShadow: active ? `0 0 16px ${meta.glowColor}, 0 4px 8px rgba(0,0,0,0.3)` : 'none',
                              background: active ? `linear-gradient(135deg, ${meta.color}12, ${meta.color}06)` : '#111827',
                            }}
                          >
                            <div style={{ fontSize: '1.5rem', marginBottom: '0.35rem' }}>{meta.emoji}</div>
                            <div style={{
                              fontSize: '0.62rem', fontWeight: 700,
                              color: active ? meta.color : '#8896ab',
                            }}>
                              {meta.label}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Persona */}
                    <label style={{
                      display: 'block', fontSize: '0.5rem', fontWeight: 700,
                      color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.4rem',
                    }}>
                      Persona
                    </label>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                      {PERSONAS.map((p) => (
                        <button
                          key={p} type="button"
                          className={`persona-chip ${teamBPersona === p ? 'active' : ''}`}
                          onClick={() => setTeamBPersona(p)}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <input
                      className="arena-input"
                      type="text" value={teamBPersona}
                      onChange={(e) => setTeamBPersona(e.target.value)}
                      placeholder="or type custom persona..."
                      style={{ fontSize: '0.65rem' }}
                    />
                  </div>
                </div>

                {/* Matchup preview */}
                <div style={{
                  marginTop: '1.5rem', padding: '0.85rem 1rem',
                  background: '#0d1520', borderRadius: '8px',
                  border: '1px solid #1e2d45',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem',
                }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: MODEL_META[teamAModel].color }}>
                    {MODEL_META[teamAModel].emoji} {teamAModel}:{teamAPersona}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: '#4a5568', fontWeight: 800 }}>vs</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: MODEL_META[teamBModel].color }}>
                    {MODEL_META[teamBModel].emoji} {teamBModel}:{teamBPersona}
                  </span>
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

          {/* ── Launch Button ── */}
          <button
            className="launch-btn"
            type="submit"
            disabled={submitting || hasErrors}
            style={{
              background: submitting
                ? '#1a2234'
                : 'linear-gradient(135deg, #f97316, #ea580c, #f97316)',
              color: submitting ? '#4a5568' : '#0a0e17',
              boxShadow: submitting
                ? 'none'
                : '0 0 20px rgba(249,115,22,0.3), 0 4px 12px rgba(0,0,0,0.3)',
              opacity: hasErrors ? 0.5 : 1,
            }}
          >
            {submitting ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>
                <span style={{
                  display: 'inline-block', width: '14px', height: '14px',
                  border: '2px solid #4a5568', borderTopColor: 'transparent',
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                }} />
                Launching...
              </span>
            ) : (
              <span>{'🚀'} LAUNCH COMPETITION</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
