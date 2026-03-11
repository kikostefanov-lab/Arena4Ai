'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { EXAMPLE_BRIEFS } from '../../../lib/example-briefs';
import { getModelColor, MONOSPACE_FONT, FORM_LABEL_STYLE } from '../../../lib/design-tokens';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RubricCriterion {
  id: string;
  description: string;
  maxScore: number;
  weight: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESET_TEAMS = [
  'claude:architect',
  'claude:speedrunner',
  'claude:pragmatist',
  'claude:adversarial',
  'claude:pioneer',
  'codex:standard',
  'codex:architect',
  'gemini:speedrunner',
  'gemini:architect',
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
  const [tournamentType, setTournamentType] = useState<'ROUND_ROBIN' | 'SWISS'>('ROUND_ROBIN');
  const [swissRounds, setSwissRounds] = useState<number | 'auto'>('auto');
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
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customModel, setCustomModel] = useState('claude');
  const [customPersona, setCustomPersona] = useState('');

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

    if (selectedTeams.length < 2 || selectedTeams.length > 8) {
      setError('Select 2–8 teams to compete in the tournament.');
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
        type: tournamentType,
        ...(tournamentType === 'SWISS' && swissRounds !== 'auto' ? { swissRounds } : {}),
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
    background: '#050f1e',
    border: '1px solid #0a2235',
    borderRadius: '6px',
    padding: '0.6rem 0.75rem',
    color: '#c8eef8',
    fontSize: '0.78rem',
    fontFamily: MONOSPACE_FONT,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = { ...FORM_LABEL_STYLE, display: 'block', marginBottom: '0.4rem' };

  const sectionStyle: React.CSSProperties = {
    marginBottom: '1.5rem',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#000408',
      fontFamily: MONOSPACE_FONT,
      color: '#c8eef8',
    }}>
      <style>{`
        input:focus, textarea:focus, select:focus { border-color: #00f0ff !important; }
        .team-card { transition: border-color 0.15s ease, background 0.15s ease, transform 0.1s ease; }
        .team-card:hover { transform: translateY(-1px); }
        .submit-btn { transition: background 0.15s ease, transform 0.1s ease; }
        .submit-btn:hover:not(:disabled) { background: #33f5ff !important; transform: translateY(-1px); }
      `}</style>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid #0a2235' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '0.6rem', color: '#00f0ff', letterSpacing: '4px', textTransform: 'uppercase', marginBottom: '0.4rem', fontWeight: 700 }}>
                ◆ New Tournament
              </div>
              <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, color: '#c8eef8' }}>
                Create Tournament
              </h1>
              <p style={{ fontSize: '0.7rem', color: '#4a8fa8', marginTop: '0.35rem' }}>
                Choose Round Robin or Swiss format below.
              </p>
            </div>
            <Link
              href="/"
              style={{
                fontSize: '0.6rem', color: '#4a8fa8', padding: '0.4rem 0.8rem',
                border: '1px solid #0a2235', borderRadius: '4px', textDecoration: 'none',
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
              <span style={{ color: selectedTeams.length >= 2 && selectedTeams.length <= 8 ? '#0066ff' : '#ef4444' }}>
                ({selectedTeams.length} selected — need 2–8)
              </span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.5rem' }}>
              {PRESET_TEAMS.map((team) => {
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
                      border: `2px solid ${selected ? color : '#0a2235'}`,
                      background: selected ? `${color}14` : '#050f1e',
                      color: selected ? color : '#4a8fa8',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: MONOSPACE_FONT,
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
              {/* Custom team entry */}
              {!showCustomForm ? (
                <button
                  type="button"
                  className="team-card"
                  onClick={() => setShowCustomForm(true)}
                  style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: '6px',
                    border: '2px dashed #0a2235',
                    background: '#050f1e',
                    color: '#1e4a5a',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: MONOSPACE_FONT,
                    letterSpacing: '0.5px',
                  }}
                >
                  <div style={{ fontSize: '0.6rem', opacity: 0.7, marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    custom
                  </div>
                  + Add Custom
                </button>
              ) : (
                <div style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: '6px',
                  border: '2px dashed #00f0ff',
                  background: '#050f1e',
                }}>
                  <div style={{ fontSize: '0.55rem', color: '#00f0ff', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }}>
                    custom team
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.4rem' }}>
                    {['claude', 'codex', 'gemini'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setCustomModel(m)}
                        style={{
                          fontSize: '0.55rem', padding: '0.2rem 0.4rem',
                          border: `1px solid ${customModel === m ? getModelColor(m) : '#0a2235'}`,
                          background: customModel === m ? `${getModelColor(m)}20` : 'none',
                          color: customModel === m ? getModelColor(m) : '#4a8fa8',
                          borderRadius: '4px', cursor: 'pointer',
                          fontFamily: MONOSPACE_FONT,
                          fontWeight: 700,
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={customPersona}
                    onChange={(e) => setCustomPersona(e.target.value)}
                    placeholder="persona..."
                    style={{
                      width: '100%', background: '#000408',
                      border: '1px solid #0a2235', borderRadius: '4px',
                      padding: '0.25rem 0.4rem', color: '#c8eef8',
                      fontSize: '0.65rem', fontFamily: MONOSPACE_FONT,
                      outline: 'none', boxSizing: 'border-box', marginBottom: '0.4rem',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button
                      type="button"
                      disabled={!customPersona.trim()}
                      onClick={() => {
                        if (customPersona.trim()) {
                          setSelectedTeams((prev) => [...prev, `${customModel}:${customPersona.trim()}`]);
                          setShowCustomForm(false);
                          setCustomPersona('');
                          setCustomModel('claude');
                        }
                      }}
                      style={{
                        fontSize: '0.55rem', padding: '0.25rem 0.6rem',
                        background: customPersona.trim() ? '#00f0ff' : '#0a2235',
                        color: customPersona.trim() ? '#000408' : '#1e4a5a',
                        border: 'none', borderRadius: '4px',
                        cursor: customPersona.trim() ? 'pointer' : 'not-allowed',
                        fontFamily: MONOSPACE_FONT,
                        fontWeight: 700,
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowCustomForm(false); setCustomPersona(''); setCustomModel('claude'); }}
                      style={{
                        fontSize: '0.55rem', padding: '0.25rem 0.6rem',
                        background: 'none', color: '#1e4a5a',
                        border: '1px solid #0a2235', borderRadius: '4px',
                        cursor: 'pointer',
                        fontFamily: MONOSPACE_FONT,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tournament Format */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={labelStyle}>Tournament Format</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '0.75rem' }}>
              {([
                { value: 'ROUND_ROBIN', label: 'Round Robin', desc: 'Every team faces every other team once.' },
                { value: 'SWISS', label: 'Swiss', desc: 'N rounds, paired by win count. Buchholz tiebreaker.' },
              ] as const).map(({ value, label, desc }) => {
                const active = tournamentType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    className="team-card"
                    onClick={() => setTournamentType(value)}
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: '8px',
                      border: `2px solid ${active ? '#00f0ff' : '#0a2235'}`,
                      background: active ? 'rgba(0,240,255,0.06)' : '#050f1e',
                      color: active ? '#00f0ff' : '#4a8fa8',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: MONOSPACE_FONT,
                    }}
                  >
                    <div style={{ marginBottom: '0.25rem' }}>{label}</div>
                    <div style={{ fontSize: '0.58rem', fontWeight: 400, color: active ? 'rgba(0,240,255,0.65)' : '#1e4a5a', lineHeight: 1.4 }}>
                      {desc}
                    </div>
                  </button>
                );
              })}
            </div>
            {tournamentType === 'SWISS' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <label style={{ ...labelStyle, margin: 0 }}>Rounds</label>
                <select
                  value={swissRounds}
                  onChange={(e) => setSwissRounds(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                  style={{ ...inputStyle, width: '9rem' }}
                >
                  <option value="auto">Auto (ceil log₂ teams)</option>
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>{n} rounds</option>
                  ))}
                </select>
                <span style={{ fontSize: '0.6rem', color: '#1e4a5a' }}>
                  {selectedTeams.length >= 2
                    ? `auto = ${Math.ceil(Math.log2(selectedTeams.length))} rounds for ${selectedTeams.length} teams`
                    : 'select teams first'}
                </span>
              </div>
            )}
          </div>

          {/* Brief section header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '1px solid #0a2235',
          }}>
            <span style={{ fontSize: '0.6rem', color: '#00f0ff', letterSpacing: '3px', textTransform: 'uppercase', fontWeight: 700 }}>
              Brief
            </span>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowExamples((v) => !v)}
                style={{
                  fontSize: '0.6rem', color: '#4a8fa8', padding: '0.3rem 0.7rem',
                  border: '1px solid #0a2235', borderRadius: '4px', background: 'none',
                  cursor: 'pointer', fontFamily: MONOSPACE_FONT,
                  letterSpacing: '1px',
                }}
              >
                Load example ▾
              </button>
              {showExamples && (
                <div style={{
                  position: 'absolute', right: 0, top: '100%', marginTop: '4px',
                  background: '#050f1e', border: '1px solid #0e3050', borderRadius: '6px',
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
                        color: '#c8eef8', fontSize: '0.72rem', cursor: 'pointer',
                        fontFamily: MONOSPACE_FONT,
                        borderBottom: '1px solid #0a2235',
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
                background: '#050f1e', border: '1px solid #0a2235', borderRadius: '6px',
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
                    <span style={{ fontSize: '0.55rem', color: '#1e4a5a', display: 'block', marginBottom: '0.2rem' }}>MAX</span>
                    <input
                      type="number"
                      value={c.maxScore}
                      onChange={(e) => updateCriterion(i, 'maxScore', Number(e.target.value))}
                      min={1}
                      style={{ ...inputStyle, width: '60px' }}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.55rem', color: '#1e4a5a', display: 'block', marginBottom: '0.2rem' }}>WEIGHT %</span>
                    <input
                      type="number"
                      value={Math.round(c.weight * 100)}
                      onChange={(e) => updateCriterion(i, 'weight', Number(e.target.value) / 100)}
                      min={1}
                      max={100}
                      step={1}
                      style={{ ...inputStyle, width: '70px' }}
                    />
                  </div>
                  {criteria.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeCriterion(i)}
                      style={{
                        background: 'none', border: 'none', color: '#1e4a5a',
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
                fontSize: '0.6rem', color: '#4a8fa8', padding: '0.35rem 0.75rem',
                border: '1px dashed #0a2235', borderRadius: '4px', background: 'none',
                cursor: 'pointer', fontFamily: MONOSPACE_FONT,
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
              background: submitting ? '#003a4a' : '#00f0ff',
              color: '#000408', border: 'none', borderRadius: '6px',
              fontSize: '0.72rem', fontWeight: 800, letterSpacing: '2px',
              textTransform: 'uppercase', cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily: MONOSPACE_FONT,
            }}
          >
            {submitting ? 'Creating Tournament…' : '🏆 Launch Tournament'}
          </button>
        </form>
      </div>
    </div>
  );
}
