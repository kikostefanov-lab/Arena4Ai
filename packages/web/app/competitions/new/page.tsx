'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface RubricCriterion {
  id: string;
  description: string;
  maxScore: number;
  weight: number;
}

const defaultCriteria: RubricCriterion[] = [
  { id: 'correctness', description: 'Solution correctness and completeness', maxScore: 10, weight: 0.5 },
  { id: 'code-quality', description: 'Code quality and maintainability', maxScore: 10, weight: 0.5 },
];

type Format = 'SPRINT' | 'HACKATHON' | 'RELAY_RACE' | 'RED_VS_BLUE';

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

const FORMAT_COLORS: Record<Format, { bg: string; color: string; activeBg: string }> = {
  SPRINT:      { bg: 'transparent', color: '#8896ab', activeBg: 'rgba(6,182,212,0.12)',   },
  HACKATHON:   { bg: 'transparent', color: '#8896ab', activeBg: 'rgba(168,85,247,0.12)',  },
  RELAY_RACE:  { bg: 'transparent', color: '#8896ab', activeBg: 'rgba(34,197,94,0.12)',   },
  RED_VS_BLUE: { bg: 'transparent', color: '#8896ab', activeBg: 'rgba(239,68,68,0.12)',   },
};

const FORMAT_ACTIVE_COLOR: Record<Format, string> = {
  SPRINT:      '#06b6d4',
  HACKATHON:   '#a855f7',
  RELAY_RACE:  '#22c55e',
  RED_VS_BLUE: '#ef4444',
};

const PERSONAS = ['speedrunner', 'architect', 'pragmatist', 'guardian', 'pioneer'];

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: '#0d1520', border: '1px solid #1e2d45', borderRadius: '4px',
  padding: '0.5rem 0.75rem', color: '#e2e8f0',
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  fontSize: '0.72rem', outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.55rem', fontWeight: 700,
  color: '#8896ab', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.4rem',
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '0.6rem', fontWeight: 700, color: '#f97316',
  letterSpacing: '2px', textTransform: 'uppercase',
  borderBottom: '1px solid #1e2d45', paddingBottom: '0.6rem', marginBottom: '1.25rem',
};

export default function NewCompetitionPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<Format>('SPRINT');
  const [problem, setProblem] = useState('');
  const [constraints, setConstraints] = useState('');
  const [deliverables, setDeliverables] = useState('');
  const [timeLimitMins, setTimeLimitMins] = useState(5);
  const [criteria, setCriteria] = useState<RubricCriterion[]>(defaultCriteria);
  const [expectedOutput, setExpectedOutput] = useState('');
  const [teamAModel, setTeamAModel] = useState<'claude' | 'codex' | 'gemini'>('claude');
  const [teamAPersona, setTeamAPersona] = useState('speedrunner');
  const [teamBModel, setTeamBModel] = useState<'claude' | 'codex' | 'gemini'>('claude');
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

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0e17', color: '#e2e8f0',
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
    }}>
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <a href="/" style={{ fontSize: '0.6rem', color: '#f97316', fontWeight: 700, letterSpacing: '2px', textDecoration: 'none' }}>
              ◆ ARENA
            </a>
            <span style={{ color: '#1e2d45' }}>│</span>
            <span style={{ fontSize: '0.6rem', color: '#8896ab', letterSpacing: '1px' }}>NEW COMPETITION</span>
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#e2e8f0', margin: 0 }}>
            Configure Brief
          </h1>
          <p style={{ fontSize: '0.7rem', color: '#8896ab', marginTop: '0.35rem' }}>
            Set up a head-to-head AI agent challenge
          </p>
        </div>

        <form onSubmit={handleSubmit}>

          {/* ── BRIEF ─────────────────────────────────────────── */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={sectionHeaderStyle}>▸ Brief</div>

            {/* Preset buttons */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={labelStyle}>Format preset</div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {(['SPRINT', 'HACKATHON', 'RELAY_RACE', 'RED_VS_BLUE'] as Format[]).map((f) => {
                  const active = format === f;
                  const activeColor = FORMAT_ACTIVE_COLOR[f];
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => applyPreset(f)}
                      style={{
                        fontSize: '0.6rem', fontWeight: 700, padding: '0.3rem 0.75rem',
                        borderRadius: '3px', letterSpacing: '1px', cursor: 'pointer',
                        border: `1px solid ${active ? activeColor : '#1e2d45'}`,
                        background: active ? FORMAT_COLORS[f].activeBg : 'transparent',
                        color: active ? activeColor : '#8896ab',
                        fontFamily: 'inherit',
                        transition: 'all 0.15s',
                      }}
                    >
                      {f.replace(/_/g, ' ')}
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: '0.6rem', color: '#4a5568', marginTop: '0.5rem' }}>
                Selecting a preset fills in defaults you can customize below.
              </p>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Competition title</label>
              <input
                type="text" required value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Fibonacci API Challenge"
                style={inputStyle}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>Problem statement</label>
              <textarea
                required value={problem}
                onChange={(e) => setProblem(e.target.value)}
                rows={4} placeholder="Describe the problem agents must solve…"
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <label style={labelStyle}>Constraints (one per line)</label>
                <textarea
                  value={constraints} onChange={(e) => setConstraints(e.target.value)}
                  rows={3} placeholder={'No external APIs\nTypeScript only'}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                />
              </div>
              <div>
                <label style={labelStyle}>Deliverables (one per line)</label>
                <textarea
                  value={deliverables} onChange={(e) => setDeliverables(e.target.value)}
                  rows={3} placeholder={'Working implementation\nREADME'}
                  style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Time limit (minutes)</label>
              <input
                type="number" min={1} max={120} value={timeLimitMins}
                onChange={(e) => setTimeLimitMins(Number(e.target.value))}
                style={{ ...inputStyle, width: '7rem' }}
              />
            </div>
          </div>

          {/* ── RUBRIC ────────────────────────────────────────── */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={sectionHeaderStyle}>▸ Rubric</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.75rem' }}>
              {criteria.map((c, idx) => (
                <div key={idx} style={{
                  background: '#111827', border: '1px solid #1e2d45',
                  borderRadius: '5px', padding: '0.85rem',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 6rem 6rem', gap: '0.6rem', marginBottom: '0.6rem' }}>
                    <div>
                      <label style={labelStyle}>ID</label>
                      <input
                        type="text" required value={c.id}
                        onChange={(e) => updateCriterion(idx, 'id', e.target.value)}
                        placeholder="criterion-id"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Max score</label>
                      <input
                        type="number" min={1} required value={c.maxScore}
                        onChange={(e) => updateCriterion(idx, 'maxScore', Number(e.target.value))}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Weight</label>
                      <input
                        type="number" min={0} max={1} step={0.01} required value={c.weight}
                        onChange={(e) => updateCriterion(idx, 'weight', Number(e.target.value))}
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Description</label>
                      <input
                        type="text" required value={c.description}
                        onChange={(e) => updateCriterion(idx, 'description', e.target.value)}
                        placeholder="What this criterion evaluates"
                        style={inputStyle}
                      />
                    </div>
                    {criteria.length > 1 && (
                      <button
                        type="button" onClick={() => removeCriterion(idx)}
                        style={{
                          fontSize: '0.65rem', color: '#4a5568', background: 'none', border: 'none',
                          cursor: 'pointer', padding: '0.45rem 0.5rem', fontFamily: 'inherit',
                          flexShrink: 0, transition: 'color 0.15s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#4a5568'; }}
                      >
                        ✕ remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button" onClick={addCriterion}
              style={{
                fontSize: '0.62rem', color: '#8896ab', background: 'none',
                border: '1px solid #1e2d45', borderRadius: '4px',
                padding: '0.35rem 0.75rem', cursor: 'pointer', fontFamily: 'inherit',
                transition: 'border-color 0.15s, color 0.15s', marginBottom: '1.25rem',
              }}
              onMouseEnter={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = '#2d4060'; b.style.color = '#e2e8f0'; }}
              onMouseLeave={(e) => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = '#1e2d45'; b.style.color = '#8896ab'; }}
            >
              + Add criterion
            </button>

            <div>
              <label style={labelStyle}>
                Expected output
                <span style={{ color: '#4a5568', fontWeight: 400, marginLeft: '0.5rem' }}>
                  optional — enables automated correctness scoring
                </span>
              </label>
              <textarea
                value={expectedOutput} onChange={(e) => setExpectedOutput(e.target.value)}
                rows={4} placeholder="Paste expected stdout here, one line per output…"
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
              />
            </div>
          </div>

          {/* ── AGENTS ────────────────────────────────────────── */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={sectionHeaderStyle}>▸ Agents</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Team A */}
              <div style={{
                background: '#111827',
                border: '1px solid #1e2d45',
                borderLeft: '3px solid #3b82f6',
                borderRadius: '5px', padding: '1rem',
              }}>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#3b82f6', letterSpacing: '1.5px', marginBottom: '1rem' }}>
                  AGENT A
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={labelStyle}>Model</label>
                  <select
                    value={teamAModel}
                    onChange={(e) => setTeamAModel(e.target.value as 'claude' | 'codex' | 'gemini')}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    <option value="claude">claude</option>
                    <option value="codex">codex</option>
                    <option value="gemini">gemini</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Persona</label>
                  <input
                    type="text" value={teamAPersona}
                    onChange={(e) => setTeamAPersona(e.target.value)}
                    list="personas-a"
                    style={inputStyle}
                  />
                  <datalist id="personas-a">
                    {PERSONAS.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </div>
              </div>

              {/* Team B */}
              <div style={{
                background: '#111827',
                border: '1px solid #1e2d45',
                borderLeft: '3px solid #a855f7',
                borderRadius: '5px', padding: '1rem',
              }}>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#a855f7', letterSpacing: '1.5px', marginBottom: '1rem' }}>
                  AGENT B
                </div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={labelStyle}>Model</label>
                  <select
                    value={teamBModel}
                    onChange={(e) => setTeamBModel(e.target.value as 'claude' | 'codex' | 'gemini')}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    <option value="claude">claude</option>
                    <option value="codex">codex</option>
                    <option value="gemini">gemini</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Persona</label>
                  <input
                    type="text" value={teamBPersona}
                    onChange={(e) => setTeamBPersona(e.target.value)}
                    list="personas-b"
                    style={inputStyle}
                  />
                  <datalist id="personas-b">
                    {PERSONAS.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </div>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '4px', padding: '0.75rem 1rem',
              color: '#ef4444', fontSize: '0.7rem', marginBottom: '1.25rem',
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit" disabled={submitting}
            style={{
              width: '100%', padding: '0.75rem',
              background: submitting ? '#1e2d45' : '#f97316',
              color: submitting ? '#4a5568' : '#0a0e17',
              border: 'none', borderRadius: '5px', cursor: submitting ? 'not-allowed' : 'pointer',
              fontSize: '0.72rem', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase',
              fontFamily: 'inherit', transition: 'background 0.15s',
            }}
          >
            {submitting ? 'Launching…' : '▶ Launch Competition'}
          </button>
        </form>
      </div>
    </div>
  );
}
