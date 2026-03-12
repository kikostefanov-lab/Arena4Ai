'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getModelColor, MONOSPACE_FONT, KICKER_STYLE } from '../../lib/design-tokens';

// ── Types ──────────────────────────────────────────────────────────────────

interface CompareStats {
  key: string;
  wins: number;
  losses: number;
  draws: number;
  avgScore: number | null;
}

interface RecentMatch {
  id: string;
  title: string;
  winner: string | null;
  modelAScore: number | null;
  modelBScore: number | null;
  completedAt: string | null;
}

interface CompareResponse {
  matchups: number;
  modelA: CompareStats;
  modelB: CompareStats;
  recentMatches: RecentMatch[];
}

interface CompSummary {
  id: string;
  teams: Array<{ id: string; model: string; persona?: string }>;
  state: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function ScoreBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div style={{ flex: 1, height: '8px', background: '#0a2235', borderRadius: '4px', overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: `linear-gradient(90deg, ${color}88, ${color})`,
        borderRadius: '4px',
        transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

function StatCard({
  label, aVal, bVal, aColor, bColor,
}: {
  label: string;
  aVal: string | number;
  bVal: string | number;
  aColor: string;
  bColor: string;
}) {
  return (
    <div style={{
      background: '#050f1e',
      border: '1px solid #0a2235',
      borderRadius: '8px',
      padding: '1rem 1.25rem',
    }}>
      <div style={{ fontSize: '0.52rem', color: '#3d7d94', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700, marginBottom: '0.75rem' }}>
        {label}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '1.4rem', fontWeight: 800, color: aColor }}>{aVal}</span>
        <span style={{ fontSize: '0.55rem', color: '#0e3050', fontWeight: 700 }}>vs</span>
        <span style={{ fontSize: '1.4rem', fontWeight: 800, color: bColor }}>{bVal}</span>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function ComparePage() {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelA, setModelA] = useState('');
  const [modelB, setModelB] = useState('');
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);

  // Fetch available model keys from the competitions list
  useEffect(() => {
    fetch('/api/competitions')
      .then((r) => r.json())
      .then((comps: CompSummary[]) => {
        if (!Array.isArray(comps)) return;
        const keys = new Set<string>();
        for (const c of comps) {
          for (const t of c.teams ?? []) {
            keys.add(t.persona ? `${t.model}:${t.persona}` : t.model);
          }
        }
        const sorted = Array.from(keys).sort();
        setAvailableModels(sorted);
        if (sorted.length >= 2) {
          setModelA(sorted[0]);
          setModelB(sorted[1]);
        }
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  }, []);

  const fetchCompare = useCallback(() => {
    if (!modelA || !modelB || modelA === modelB) return;
    setLoading(true);
    setError(null);
    fetch(`/api/compare?modelA=${encodeURIComponent(modelA)}&modelB=${encodeURIComponent(modelB)}`)
      .then((r) => r.json())
      .then((d: CompareResponse) => { setData(d); setLoading(false); })
      .catch(() => { setError('Failed to load comparison data.'); setLoading(false); });
  }, [modelA, modelB]);

  // Auto-fetch when both models are selected
  useEffect(() => {
    if (modelA && modelB && modelA !== modelB) fetchCompare();
    else setData(null);
  }, [modelA, modelB, fetchCompare]);

  const colorA = modelA ? getModelColor(modelA) : '#7cc6db';
  const colorB = modelB ? getModelColor(modelB) : '#7cc6db';

  const selectStyle: React.CSSProperties = {
    background: '#050f1e',
    border: '1px solid #0a2235',
    borderRadius: '6px',
    color: '#e4f8ff',
    fontSize: '0.78rem',
    fontFamily: MONOSPACE_FONT,
    padding: '0.55rem 0.9rem',
    outline: 'none',
    cursor: 'pointer',
    minWidth: '180px',
    appearance: 'none',
    WebkitAppearance: 'none',
  };

  const maxAvgScore = Math.max(
    data?.modelA.avgScore ?? 0,
    data?.modelB.avgScore ?? 0,
    1,
  );

  return (
    <div style={{ minHeight: '100vh', fontFamily: MONOSPACE_FONT, color: '#e4f8ff' }}>
      <style>{`
        .compare-card { transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease; }
        .compare-card:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(0,240,255,0.12); border-color: #0e3050 !important; }
        select:hover { border-color: #0e3050 !important; }
      `}</style>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '2.5rem 2rem' }}>

        {/* Header */}
        <div style={{
          marginBottom: '2.25rem',
          padding: '1.5rem 0',
          borderBottom: '1px solid #0a2235',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '2rem',
        }}>
          <div>
            <div style={{ ...KICKER_STYLE, color: '#00f0ff', marginBottom: '0.4rem' }}>
              ⚔ Model Compare
            </div>
            <h1 style={{
              fontSize: '2rem', fontWeight: 800, lineHeight: 1.05, margin: 0,
              background: 'linear-gradient(135deg, #c8eef8 0%, #00f0ff 50%, #0080ff 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              fontFamily: MONOSPACE_FONT,
            }}>
              Head-to-Head Stats
            </h1>
            <p style={{ fontSize: '0.72rem', color: '#4a8fa8', marginTop: '0.4rem', margin: '0.4rem 0 0' }}>
              Compare win rates and scores between any two models
            </p>
          </div>
          <Link href="/competitions/new" className="arena-btn arena-btn-primary new-comp-btn" style={{ flexShrink: 0 }}>
            ⚔ Run a Match
          </Link>
        </div>

        {/* Model Selectors */}
        <div style={{
          background: '#050f1e',
          border: '1px solid #0a2235',
          borderRadius: '10px',
          padding: '1.5rem',
          marginBottom: '2rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1.25rem',
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: '160px' }}>
            <div style={{ fontSize: '0.52rem', color: colorA, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700, marginBottom: '0.45rem' }}>
              Model A
            </div>
            {modelsLoading ? (
              <div style={{ fontSize: '0.7rem', color: '#3d7d94' }}>Loading…</div>
            ) : (
              <div style={{ position: 'relative' }}>
                <select
                  value={modelA}
                  onChange={(e) => setModelA(e.target.value)}
                  style={{ ...selectStyle, borderColor: modelA ? `${colorA}44` : '#0a2235', width: '100%' }}
                >
                  <option value="">-- select --</option>
                  {availableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <span style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: '#3d7d94', pointerEvents: 'none', fontSize: '0.6rem' }}>▾</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
            <span style={{ fontSize: '1.2rem', color: '#0e3050', fontWeight: 800 }}>VS</span>
          </div>

          <div style={{ flex: 1, minWidth: '160px' }}>
            <div style={{ fontSize: '0.52rem', color: colorB, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700, marginBottom: '0.45rem' }}>
              Model B
            </div>
            {modelsLoading ? (
              <div style={{ fontSize: '0.7rem', color: '#3d7d94' }}>Loading…</div>
            ) : (
              <div style={{ position: 'relative' }}>
                <select
                  value={modelB}
                  onChange={(e) => setModelB(e.target.value)}
                  style={{ ...selectStyle, borderColor: modelB ? `${colorB}44` : '#0a2235', width: '100%' }}
                >
                  <option value="">-- select --</option>
                  {availableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <span style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: '#3d7d94', pointerEvents: 'none', fontSize: '0.6rem' }}>▾</span>
              </div>
            )}
          </div>

          {modelA === modelB && modelA && (
            <p style={{ fontSize: '0.65rem', color: '#ef4444', flex: '100%', margin: 0 }}>
              Select two different models to compare.
            </p>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '4rem 0' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem', animation: 'pulse 1.5s ease-in-out infinite' }}>⚔</div>
            <p style={{ color: '#3d7d94', fontSize: '0.75rem' }}>Crunching the numbers…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{
            textAlign: 'center', padding: '3rem 2rem',
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: '8px',
          }}>
            <p style={{ color: '#ef4444', fontSize: '0.75rem' }}>{error}</p>
          </div>
        )}

        {/* No data state */}
        {!loading && !error && !data && modelA && modelB && modelA !== modelB && (
          <div style={{
            textAlign: 'center', padding: '4rem 2rem',
            background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '8px',
          }}>
            <p style={{ color: '#3d7d94', fontSize: '0.75rem' }}>Select models above to see comparison.</p>
          </div>
        )}

        {/* Results */}
        {!loading && !error && data && (
          <>
            {data.matchups === 0 ? (
              <div style={{
                textAlign: 'center', padding: '4rem 2rem',
                background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '8px',
                animation: 'fadeIn 0.3s ease both',
              }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📭</div>
                <p style={{ color: '#3d7d94', fontSize: '0.78rem', marginBottom: '1.25rem' }}>
                  No completed head-to-head matches between <span style={{ color: colorA }}>{modelA}</span> and <span style={{ color: colorB }}>{modelB}</span> yet.
                </p>
                <Link
                  href="/competitions/new"
                  style={{
                    fontSize: '0.65rem', fontWeight: 700, padding: '0.5rem 1.25rem',
                    background: '#00f0ff', color: '#000408', borderRadius: '5px',
                    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  }}
                >
                  ⚔ Run their first match
                </Link>
              </div>
            ) : (
              <div style={{ animation: 'fadeIn 0.3s ease both' }}>

                {/* Big W-L-D record */}
                <div style={{
                  background: '#050f1e',
                  border: '1px solid #0a2235',
                  borderRadius: '10px',
                  padding: '1.75rem',
                  marginBottom: '1.25rem',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto 1fr',
                  gap: '1.5rem',
                  alignItems: 'center',
                }}>
                  {/* Model A record */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      fontSize: '0.6rem', color: colorA, textTransform: 'uppercase',
                      letterSpacing: '3px', fontWeight: 700, marginBottom: '0.5rem',
                    }}>
                      {data.modelA.key}
                    </div>
                    <div style={{ fontSize: '3rem', fontWeight: 900, color: colorA, lineHeight: 1 }}>
                      {data.modelA.wins}–{data.modelA.losses}–{data.modelA.draws}
                    </div>
                    <div style={{ fontSize: '0.52rem', color: '#3d7d94', marginTop: '0.4rem', letterSpacing: '1.5px' }}>
                      W – L – D
                    </div>
                  </div>

                  {/* Center divider */}
                  <div style={{ textAlign: 'center', color: '#0e3050' }}>
                    <div style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                      {data.matchups} match{data.matchups !== 1 ? 'es' : ''}
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>VS</div>
                  </div>

                  {/* Model B record */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      fontSize: '0.6rem', color: colorB, textTransform: 'uppercase',
                      letterSpacing: '3px', fontWeight: 700, marginBottom: '0.5rem',
                    }}>
                      {data.modelB.key}
                    </div>
                    <div style={{ fontSize: '3rem', fontWeight: 900, color: colorB, lineHeight: 1 }}>
                      {data.modelB.wins}–{data.modelB.losses}–{data.modelB.draws}
                    </div>
                    <div style={{ fontSize: '0.52rem', color: '#3d7d94', marginTop: '0.4rem', letterSpacing: '1.5px' }}>
                      W – L – D
                    </div>
                  </div>
                </div>

                {/* Avg score bar comparison */}
                {(data.modelA.avgScore !== null || data.modelB.avgScore !== null) && (
                  <div style={{
                    background: '#050f1e',
                    border: '1px solid #0a2235',
                    borderRadius: '8px',
                    padding: '1.25rem',
                    marginBottom: '1.25rem',
                  }}>
                    <div style={{ fontSize: '0.52rem', color: '#3d7d94', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700, marginBottom: '1rem' }}>
                      Avg Score Comparison
                    </div>
                    {[
                      { key: data.modelA.key, score: data.modelA.avgScore, color: colorA },
                      { key: data.modelB.key, score: data.modelB.avgScore, color: colorB },
                    ].map(({ key, score, color }) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '0.65rem' }}>
                        <span style={{ fontSize: '0.62rem', color, fontWeight: 700, minWidth: '140px', textAlign: 'right' }}>{key}</span>
                        <ScoreBar value={score ?? 0} max={maxAvgScore} color={color} />
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color, minWidth: '3.5rem', textAlign: 'right' }}>
                          {score !== null ? `${(score * 100).toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Stat cards */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '0.75rem',
                  marginBottom: '1.5rem',
                }}>
                  <StatCard
                    label="Wins"
                    aVal={data.modelA.wins}
                    bVal={data.modelB.wins}
                    aColor={colorA}
                    bColor={colorB}
                  />
                  <StatCard
                    label="Losses"
                    aVal={data.modelA.losses}
                    bVal={data.modelB.losses}
                    aColor={colorA}
                    bColor={colorB}
                  />
                  <StatCard
                    label="Draws"
                    aVal={data.modelA.draws}
                    bVal={data.modelB.draws}
                    aColor={colorA}
                    bColor={colorB}
                  />
                </div>

                {/* Recent matches */}
                {data.recentMatches.length > 0 && (
                  <div style={{
                    border: '1px solid #0a2235',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      background: '#020b14',
                      padding: '0.75rem 1rem',
                      borderBottom: '1px solid #0a2235',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#3d7d94', textTransform: 'uppercase', letterSpacing: '2px' }}>
                        📜 Recent Matches
                      </span>
                      <span style={{ fontSize: '0.5rem', color: '#0e3050', letterSpacing: '1px' }}>
                        {data.modelA.key} score / {data.modelB.key} score
                      </span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #0a2235' }}>
                          {[
                            { label: 'Brief', align: 'left' },
                            { label: 'Winner', align: 'left' },
                            { label: data.modelA.key, align: 'right' },
                            { label: data.modelB.key, align: 'right' },
                            { label: 'Date', align: 'right' },
                          ].map(({ label, align }) => (
                            <th key={label} style={{
                              padding: '0.55rem 1rem',
                              textAlign: align as React.CSSProperties['textAlign'],
                              fontSize: '0.5rem', color: '#0e3050',
                              textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700,
                            }}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentMatches.map((match) => {
                          const winnerColor = match.winner ? getModelColor(match.winner) : '#3d7d94';
                          return (
                            <tr
                              key={match.id}
                              className="compare-card"
                              style={{ borderBottom: '1px solid rgba(10,34,53,0.5)' }}
                            >
                              <td style={{ padding: '0.65rem 1rem' }}>
                                <Link
                                  href={`/competitions/${match.id}`}
                                  style={{
                                    color: '#0066ff', textDecoration: 'none', fontWeight: 600,
                                    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                                  }}
                                >
                                  <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>🏆</span>
                                  {match.title}
                                </Link>
                              </td>
                              <td style={{ padding: '0.65rem 1rem' }}>
                                {match.winner ? (
                                  <span style={{ color: winnerColor, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                    <span style={{ color: '#eab308' }}>★</span> {match.winner}
                                  </span>
                                ) : (
                                  <span style={{ color: '#3d7d94' }}>Draw</span>
                                )}
                              </td>
                              <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: colorA, fontWeight: 600 }}>
                                {match.modelAScore !== null ? `${(match.modelAScore * 100).toFixed(1)}%` : '—'}
                              </td>
                              <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: colorB, fontWeight: 600 }}>
                                {match.modelBScore !== null ? `${(match.modelBScore * 100).toFixed(1)}%` : '—'}
                              </td>
                              <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: '#3d7d94', fontSize: '0.62rem' }}>
                                {timeAgo(match.completedAt)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
