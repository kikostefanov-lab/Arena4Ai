'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
  SPRINT:      { emoji: '\u26A1', label: 'Sprint',       subtitle: 'Quick 15-min challenge',   color: '#06b6d4', glowColor: 'rgba(6,182,212,0.35)'   },
  HACKATHON:   { emoji: '\uD83D\uDD28', label: 'Hackathon',    subtitle: 'Deep 2-hour build',        color: '#a855f7', glowColor: 'rgba(168,85,247,0.35)'  },
  RELAY_RACE:  { emoji: '\uD83D\uDD04', label: 'Relay Race',   subtitle: 'Pass the baton',           color: '#22c55e', glowColor: 'rgba(34,197,94,0.35)'   },
  RED_VS_BLUE: { emoji: '\u2694\uFE0F', label: 'Red vs Blue',  subtitle: 'Attack & Defend',           color: '#ef4444', glowColor: 'rgba(239,68,68,0.35)'   },
};

const MODEL_META: Record<Model, { emoji: string; label: string; color: string; glowColor: string }> = {
  claude: { emoji: '\uD83D\uDD35', label: 'Claude', color: '#3b82f6', glowColor: 'rgba(59,130,246,0.4)'  },
  codex:  { emoji: '\uD83D\uDFE2', label: 'Codex',  color: '#22c55e', glowColor: 'rgba(34,197,94,0.4)'   },
  gemini: { emoji: '\uD83D\uDFE3', label: 'Gemini', color: '#a855f7', glowColor: 'rgba(168,85,247,0.4)'  },
};

const PERSONAS = ['speedrunner', 'architect', 'pragmatist', 'guardian', 'pioneer'];

const FONT = "'SF Mono', 'Fira Code', 'Cascadia Code', monospace";

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewCompetitionPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step expansion state
  const [expandedStep, setExpandedStep] = useState<1 | 2 | 3>(1);

  // Form state
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<Format>('SPRINT');
  const [problem, setProblem] = useState('');
  const [constraints, setConstraints] = useState('');
  const [deliverables, setDeliverables] = useState('');
  const [timeLimitMins, setTimeLimitMins] = useState(5);
  const [criteria, setCriteria] = useState<RubricCriterion[]>(defaultCriteria);
  const [expectedOutput, setExpectedOutput] = useState('');
  const [teamAModel, setTeamAModel] = useState<Model>('claude');
  const [teamAPersona, setTeamAPersona] = useState('speedrunner');
  const [teamBModel, setTeamBModel] = useState<Model>('claude');
  const [teamBPersona, setTeamBPersona] = useState('architect');

  const applyPreset = (f: Format) => {
    setFormat(f);
    const p = FORMAT_PRESETS[f];
    setTimeLimitMins(p.timeLimitMins);
    setConstraints(p.constraints);
    setDeliverables(p.deliverables);
    setCriteria(p.criteria);
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
            criteria: criteria.map((c) => ({ ...c, maxScore: Number(c.maxScore), weight: Number(c.weight) })),
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
      <style>{`
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(249,115,22,0.3), 0 0 40px rgba(249,115,22,0.1); }
          50% { box-shadow: 0 0 30px rgba(249,115,22,0.5), 0 0 60px rgba(249,115,22,0.2); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes slideDown {
          from { opacity: 0; max-height: 0; transform: translateY(-8px); }
          to { opacity: 1; max-height: 2000px; transform: translateY(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .arena-input {
          width: 100%;
          box-sizing: border-box;
          background: #0d1520;
          border: 1px solid #1e2d45;
          border-radius: 6px;
          padding: 0.55rem 0.85rem;
          color: #e2e8f0;
          font-family: ${FONT};
          font-size: 0.72rem;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .arena-input:focus {
          border-color: #f97316;
          box-shadow: 0 0 0 3px rgba(249,115,22,0.15), 0 0 12px rgba(249,115,22,0.1);
        }
        .arena-input::placeholder {
          color: #2d4060;
        }
        .format-card {
          cursor: pointer;
          border-radius: 10px;
          padding: 1rem 1.1rem;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          border: 1.5px solid #1e2d45;
          background: #111827;
          position: relative;
          overflow: hidden;
        }
        .format-card:hover {
          border-color: #2d4060;
          transform: translateY(-1px);
        }
        .format-card.active {
          transform: translateY(-2px);
        }
        .model-card {
          cursor: pointer;
          border-radius: 10px;
          padding: 1rem;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          border: 1.5px solid #1e2d45;
          background: #111827;
          text-align: center;
          position: relative;
        }
        .model-card:hover {
          border-color: #2d4060;
          transform: translateY(-1px);
        }
        .model-card.active {
          transform: translateY(-2px);
        }
        .step-header {
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 0.85rem;
          padding: 0.85rem 0;
          transition: opacity 0.15s;
          user-select: none;
        }
        .step-header:hover {
          opacity: 0.85;
        }
        .criterion-card {
          background: #111827;
          border: 1px solid #1e2d45;
          border-radius: 8px;
          padding: 1rem;
          transition: border-color 0.2s, box-shadow 0.2s;
          position: relative;
        }
        .criterion-card:hover {
          border-color: #2d4060;
        }
        .launch-btn {
          width: 100%;
          padding: 1rem;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.82rem;
          font-weight: 800;
          letter-spacing: 3px;
          text-transform: uppercase;
          font-family: ${FONT};
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }
        .launch-btn:not(:disabled):hover {
          transform: translateY(-1px);
          animation: pulseGlow 2s ease-in-out infinite;
        }
        .launch-btn:disabled {
          cursor: not-allowed;
        }
        .persona-chip {
          font-size: 0.6rem;
          padding: 0.25rem 0.6rem;
          border-radius: 20px;
          border: 1px solid #1e2d45;
          background: transparent;
          color: #8896ab;
          cursor: pointer;
          font-family: ${FONT};
          transition: all 0.2s;
          white-space: nowrap;
        }
        .persona-chip:hover {
          border-color: #2d4060;
          color: #e2e8f0;
        }
        .persona-chip.active {
          background: rgba(249,115,22,0.12);
          border-color: #f97316;
          color: #f97316;
        }
      `}</style>

      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2.5rem 1.5rem 4rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem', animation: 'fadeInUp 0.4s ease-out' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.2rem' }}>
            <a href="/" style={{ fontSize: '0.6rem', color: '#f97316', fontWeight: 700, letterSpacing: '2px', textDecoration: 'none' }}>
              {'\u25C6'} ARENA
            </a>
            <span style={{ color: '#1e2d45' }}>{'\u2502'}</span>
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
                {step1Done ? '\u2713' : '1'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#e2e8f0' }}>
                  {'\uD83D\uDCCB'} Brief
                </div>
                <div style={{ fontSize: '0.6rem', color: '#8896ab', marginTop: '0.15rem' }}>
                  Define the challenge
                </div>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#4a5568', flexShrink: 0 }}>
                {expandedStep === 1 ? '\u25B2' : '\u25BC'}
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
                    placeholder="e.g. Fibonacci API Challenge"
                  />
                </div>

                {/* Problem */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{
                    display: 'block', fontSize: '0.55rem', fontWeight: 700,
                    color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.4rem',
                  }}>
                    Problem statement
                  </label>
                  <textarea
                    className="arena-input"
                    required value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                    rows={4}
                    placeholder="Describe the problem agents must solve..."
                    style={{ resize: 'vertical', lineHeight: 1.6 }}
                  />
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
                      rows={3} placeholder={'No external APIs\nTypeScript only'}
                      style={{ resize: 'vertical', lineHeight: 1.6 }}
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
                      rows={3} placeholder={'Working implementation\nREADME'}
                      style={{ resize: 'vertical', lineHeight: 1.6 }}
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
                    Next: Rubric {'\u2192'}
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
                {step2Done ? '\u2713' : '2'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#e2e8f0' }}>
                  {'\u2696\uFE0F'} Rubric
                </div>
                <div style={{ fontSize: '0.6rem', color: '#8896ab', marginTop: '0.15rem' }}>
                  Set scoring criteria
                </div>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#4a5568', flexShrink: 0 }}>
                {expandedStep === 2 ? '\u25B2' : '\u25BC'}
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
                            {'\u2715'} remove
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
                          }}>Weight</label>
                          <input
                            className="arena-input"
                            type="number" min={0} max={1} step={0.01} required value={c.weight}
                            onChange={(e) => updateCriterion(idx, 'weight', Number(e.target.value))}
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
                          placeholder="What this criterion evaluates"
                        />
                      </div>
                    </div>
                  ))}
                </div>

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
                    Next: Agents {'\u2192'}
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
                  {'\uD83E\uDD16'} Agents
                </div>
                <div style={{ fontSize: '0.6rem', color: '#8896ab', marginTop: '0.15rem' }}>
                  Choose your fighters
                </div>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#4a5568', flexShrink: 0 }}>
                {expandedStep === 3 ? '\u25B2' : '\u25BC'}
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
              <span>{'\u274C'}</span>
              {error}
            </div>
          )}

          {/* ── Launch Button ── */}
          <button
            className="launch-btn"
            type="submit"
            disabled={submitting}
            style={{
              background: submitting
                ? '#1a2234'
                : 'linear-gradient(135deg, #f97316, #ea580c, #f97316)',
              color: submitting ? '#4a5568' : '#0a0e17',
              boxShadow: submitting
                ? 'none'
                : '0 0 20px rgba(249,115,22,0.3), 0 4px 12px rgba(0,0,0,0.3)',
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
              <span>{'\uD83D\uDE80'} LAUNCH COMPETITION</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
