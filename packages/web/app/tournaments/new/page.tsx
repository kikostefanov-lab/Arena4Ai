'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { EXAMPLE_BRIEFS } from '../../../lib/example-briefs';
import { getModelColor } from '../../../lib/design-tokens';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RubricCriterion {
  id: string;
  description: string;
  maxScore: number;
  weight: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const AVAILABLE_TEAMS = [
  'claude:architect',
  'claude:speedrunner',
  'claude:pragmatist',
  'codex:standard',
  'gemini:speedrunner',
] as const;

const DEFAULT_CRITERIA: RubricCriterion[] = [
  { id: 'correctness', description: 'Solution correctness and completeness', maxScore: 10, weight: 0.5 },
  { id: 'code-quality', description: 'Code quality and maintainability', maxScore: 10, weight: 0.5 },
];

const EXAMPLE_OPTIONS = EXAMPLE_BRIEFS.filter((b) =>
  ['deadlock-detector', 'debate-championship', 'ab-test-designer'].includes(b.id)
);

function modelOf(team: string) {
  return team.split(':')[0];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NewTournamentPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  const [format, setFormat] = useState<'SPRINT' | 'HACKATHON' | 'RELAY_RACE' | 'RED_VS_BLUE'>('SPRINT');
  const [timeLimitMins, setTimeLimitMins] = useState(15);
  const [constraints, setConstraints] = useState('Stay within the time limit.');
  const [deliverables, setDeliverables] = useState('solution.py');
  const [expectedOutput, setExpectedOutput] = useState('');
  const [criteria, setCriteria] = useState<RubricCriterion[]>(DEFAULT_CRITERIA);
  const [showExamples, setShowExamples] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTeam(team: string) {
    setSelectedTeams((prev) =>
      prev.includes(team) ? prev.filter((t) => t !== team) : [...prev, team]
    );
  }

  function loadExample(id: string) {
    const brief = EXAMPLE_BRIEFS.find((b) => b.id === id);
    if (!brief) return;
    setProblem(brief.problem);
    setFormat(brief.format);
    setTimeLimitMins(brief.timeLimitMins);
    setConstraints(brief.constraints);
    setDeliverables(brief.deliverables);
    setExpectedOutput(brief.expectedOutput ?? '');
    setCriteria(brief.criteria.map((c) => ({ ...c })));
    if (!name) setName(brief.title + ' Tournament');
    setShowExamples(false);
  }

  function updateCriterion(index: number, field: keyof RubricCriterion, value: string | number) {
    setCriteria((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addCriterion() {
    setCriteria((prev) => [
      ...prev,
      { id: `criterion-${prev.length + 1}`, description: '', maxScore: 10, weight: 0.1 },
    ]);
  }

  function removeCriterion(index: number) {
    setCriteria((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (selectedTeams.length < 2 || selectedTeams.length > 4) {
      setError('Select 2–4 teams to compete in the tournament.');
      return;
    }
    if (!problem.trim()) {
      setError('Problem description is required.');
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        name: name.trim() || undefined,
        teams: selectedTeams,
        brief: {
          title: name.trim() || 'Tournament',
          format,
          problem: problem.trim(),
          constraints: constraints.split('\n').map((s) => s.trim()).filter(Boolean),
          deliverables: deliverables.split('\n').map((s) => s.trim()).filter(Boolean),
          timeLimitMs: timeLimitMins * 60 * 1000,
          rubric: { criteria },
          ...(expectedOutput.trim() ? { expectedOutput: expectedOutput.trim() } : {}),
        },
      };

      const res = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.push(`/tournaments/${data.tournamentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tournament');
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#111827',
    border: '1px solid #1e2d45',
    borderRadius: '6px',
    padding: '0.6rem 0.75rem',
    color: '#e2e8f0',
    fontSize: '0.78rem',
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.6rem',
    color: '#8896ab',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    fontWeight: 700,
    marginBottom: '0.4rem',
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: '1.5rem',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0e17',
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      color: '#e2e8f0',
    }}>
      <style>{`
        input:focus, textarea:focus, select:focus { border-color: #f97316 !important; }
        .team-card { transition: border-color 0.15s ease, background 0.15s ease, transform 0.1s ease; }
        .team-card:hover { transform: translateY(-1px); }
        .submit-btn { transition: background 0.15s ease, transform 0.1s ease; }
        .submit-btn:hover:not(:disabled) { background: #fb923c !important; transform: translateY(-1px); }
      `}</style>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid #1e2d45' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '0.6rem', color: '#f97316', letterSpacing: '4px', textTransform: 'uppercase', marginBottom: '0.4rem', fontWeight: 700 }}>
                ◆ New Tournament
              </div>
              <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, color: '#e2e8f0' }}>
                Create Tournament
              </h1>
              <p style={{ fontSize: '0.7rem', color: '#8896ab', marginTop: '0.35rem' }}>
                Round-robin: every selected team faces every other team once.
              </p>
            </div>
            <Link
              href="/"
              style={{
                fontSize: '0.6rem', color: '#8896ab', padding: '0.4rem 0.8rem',
                border: '1px solid #1e2d45', borderRadius: '4px', textDecoration: 'none',
                letterSpacing: '1px', fontWeight: 600,
              }}
            >
              ← BACK
            </Link>
          </div>
        </div>

        <form onSubmit={handleSubmit}>

          {/* Tournament Name */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Tournament Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. FizzBuzz Championship"
              style={inputStyle}
            />
          </div>

          {/* Team Selection */}
          <div style={sectionStyle}>
            <label style={labelStyle}>
              Teams{' '}
              <span style={{ color: selectedTeams.length >= 2 && selectedTeams.length <= 4 ? '#22c55e' : '#ef4444' }}>
                ({selectedTeams.length} selected — need 2–4)
              </span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem' }}>
              {AVAILABLE_TEAMS.map((team) => {
                const model = modelOf(team);
                const color = getModelColor(model);
                const selected = selectedTeams.includes(team);
                return (
                  <button
                    key={team}
                    type="button"
                    className="team-card"
                    onClick={() => toggleTeam(team)}
                    style={{
                      padding: '0.65rem 0.85rem',
                      borderRadius: '6px',
                      border: `2px solid ${selected ? color : '#1e2d45'}`,
                      background: selected ? `${color}14` : '#111827',
                      color: selected ? color : '#8896ab',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                      letterSpacing: '0.5px',
                    }}
                  >
                    <div style={{ fontSize: '0.6rem', opacity: 0.7, marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      {model}
                    </div>
                    {team.split(':')[1] ?? team}
                    {selected && <span style={{ float: 'right', fontSize: '0.8rem' }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Brief section header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid #1e2d45',
          }}>
            <span style={{ fontSize: '0.6rem', color: '#f97316', letterSpacing: '3px', textTransform: 'uppercase', fontWeight: 700 }}>
              Brief
            </span>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowExamples((v) => !v)}
                style={{
                  fontSize: '0.6rem', color: '#8896ab', padding: '0.3rem 0.7rem',
                  border: '1px solid #1e2d45', borderRadius: '4px', background: 'none',
                  cursor: 'pointer', fontFamily: "'SF Mono', 'Fira Code', monospace",
                  letterSpacing: '1px',
                }}
              >
                Load example ▾
              </button>
              {showExamples && (
                <div style={{
                  position: 'absolute', right: 0, top: '100%', marginTop: '4px',
                  background: '#111827', border: '1px solid #2d4060', borderRadius: '6px',
                  zIndex: 10, minWidth: '180px', overflow: 'hidden',
                }}>
                  {EXAMPLE_OPTIONS.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => loadExample(b.id)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '0.55rem 0.85rem', background: 'none', border: 'none',
                        color: '#e2e8f0', fontSize: '0.72rem', cursor: 'pointer',
                        fontFamily: "'SF Mono', 'Fira Code', monospace",
                        borderBottom: '1px solid #1e2d45',
                      }}
                    >
                      {b.emoji} {b.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Problem */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Problem *</label>
            <textarea
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              required
              rows={4}
              placeholder="Describe the coding challenge..."
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Format + Time Limit */}
          <div style={{ ...sectionStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="SPRINT">SPRINT</option>
                <option value="HACKATHON">HACKATHON</option>
                <option value="RELAY_RACE">RELAY RACE</option>
                <option value="RED_VS_BLUE">RED vs BLUE</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Time limit per match (minutes)</label>
              <input
                type="number"
                value={timeLimitMins}
                onChange={(e) => setTimeLimitMins(Number(e.target.value))}
                min={1}
                max={180}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Constraints */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Constraints (one per line)</label>
            <textarea
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Deliverables */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Deliverables (one per line)</label>
            <textarea
              value={deliverables}
              onChange={(e) => setDeliverables(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Expected Output */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Expected output (optional — enables automated scoring)</label>
            <textarea
              value={expectedOutput}
              onChange={(e) => setExpectedOutput(e.target.value)}
              rows={3}
              placeholder="Exact expected stdout, one line per line..."
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Rubric */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Rubric criteria</label>
            {criteria.map((c, i) => (
              <div key={i} style={{
                background: '#111827', border: '1px solid #1e2d45', borderRadius: '6px',
                padding: '0.75rem', marginBottom: '0.5rem',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={c.description}
                    onChange={(e) => updateCriterion(i, 'description', e.target.value)}
                    placeholder="Description"
                    style={{ ...inputStyle, marginBottom: 0 }}
                  />
                  <div>
                    <span style={{ fontSize: '0.55rem', color: '#4a5568', display: 'block', marginBottom: '0.2rem' }}>MAX</span>
                    <input
                      type="number"
                      value={c.maxScore}
                      onChange={(e) => updateCriterion(i, 'maxScore', Number(e.target.value))}
                      min={1}
                      style={{ ...inputStyle, width: '60px' }}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.55rem', color: '#4a5568', display: 'block', marginBottom: '0.2rem' }}>WEIGHT</span>
                    <input
                      type="number"
                      value={c.weight}
                      onChange={(e) => updateCriterion(i, 'weight', Number(e.target.value))}
                      min={0}
                      max={1}
                      step={0.1}
                      style={{ ...inputStyle, width: '70px' }}
                    />
                  </div>
                  {criteria.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCriterion(i)}
                      style={{
                        background: 'none', border: 'none', color: '#4a5568',
                        cursor: 'pointer', fontSize: '0.85rem', padding: '0.2rem',
                        marginTop: '1.2rem',
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addCriterion}
              style={{
                fontSize: '0.6rem', color: '#8896ab', padding: '0.35rem 0.75rem',
                border: '1px dashed #1e2d45', borderRadius: '4px', background: 'none',
                cursor: 'pointer', fontFamily: "'SF Mono', 'Fira Code', monospace",
              }}
            >
              + Add criterion
            </button>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              marginBottom: '1rem', padding: '0.75rem 1rem',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '6px', color: '#ef4444', fontSize: '0.72rem',
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="submit-btn"
            style={{
              width: '100%', padding: '0.85rem',
              background: submitting ? '#6b3d17' : '#f97316',
              color: '#0a0e17', border: 'none', borderRadius: '6px',
              fontSize: '0.72rem', fontWeight: 800, letterSpacing: '2px',
              textTransform: 'uppercase', cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily: "'SF Mono', 'Fira Code', monospace",
            }}
          >
            {submitting ? 'Creating Tournament…' : '🏆 Launch Tournament'}
          </button>
        </form>
      </div>
    </div>
  );
}
