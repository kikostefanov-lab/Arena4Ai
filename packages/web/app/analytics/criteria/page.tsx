'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getModelColor } from '../../../lib/design-tokens';

const FONT = "'SF Mono', 'Fira Code', 'Cascadia Code', monospace";

// ── Types ──────────────────────────────────────────────────────────────────

interface CriteriaData {
  models: string[];
  criteria: string[];
  matrix: Record<string, Record<string, { avg: number; count: number }>>;
}

// ── Heatmap color ──────────────────────────────────────────────────────────

/**
 * Return a background + text color pair for a 0–1 score value.
 * Low: dim red tint. High: cyan tint.
 */
function heatmapStyle(score: number | undefined): { bg: string; fg: string } {
  if (score === undefined) return { bg: 'transparent', fg: '#0e3050' };
  // Clamp to 0–1
  const v = Math.max(0, Math.min(1, score));
  if (v >= 0.75) return { bg: 'rgba(0,240,255,0.18)', fg: '#00f0ff' };
  if (v >= 0.55) return { bg: 'rgba(0,240,255,0.08)', fg: '#7cc6db' };
  if (v >= 0.40) return { bg: 'rgba(30,74,90,0.15)',   fg: '#3d7d94' };
  if (v >= 0.25) return { bg: 'rgba(239,68,68,0.07)',  fg: '#ef7b7b' };
  return              { bg: 'rgba(239,68,68,0.15)',  fg: '#ef4444' };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function CriterionLabel({ cid }: { cid: string }) {
  // Truncate long criteria names gracefully
  const label = cid.length > 32 ? `${cid.slice(0, 30)}…` : cid;
  return (
    <span title={cid} style={{ display: 'block', maxWidth: '220px', wordBreak: 'break-word', lineHeight: 1.3 }}>
      {label}
    </span>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function CriteriaPage() {
  const [data, setData] = useState<CriteriaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/analytics/criteria', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: CriteriaData) => { setData(d); setLoading(false); })
      .catch(() => { setError('Could not load criteria data.'); setLoading(false); });
  }, []);

  const thBase: React.CSSProperties = {
    padding: '0.55rem 0.75rem',
    fontSize: '0.5rem',
    color: '#0e3050',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    fontWeight: 700,
    fontFamily: FONT,
    whiteSpace: 'nowrap',
  };

  // Compute per-model strengths and weaknesses
  function modelInsights(model: string, criteria: string[], matrix: CriteriaData['matrix']) {
    const row = matrix[model] ?? {};
    const scored = criteria
      .map((cid) => ({ cid, avg: row[cid]?.avg }))
      .filter((x) => x.avg !== undefined)
      .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0));
    return {
      strengths: scored.slice(0, 2),
      weaknesses: [...scored].reverse().slice(0, 2),
    };
  }

  return (
    <div style={{ minHeight: '100vh', background: '#000408', fontFamily: FONT, color: '#e4f8ff' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse  { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .nav-link { transition: color 0.15s ease, border-color 0.15s ease; }
        .nav-link:hover { color: #e4f8ff !important; border-color: #0e3050 !important; }
        .crit-row:hover td { background: rgba(14,48,80,0.35) !important; }
        .insight-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .insight-card:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(0,240,255,0.1); }
      `}</style>

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Header */}
        <div style={{
          marginBottom: '2.25rem',
          paddingBottom: '1.25rem',
          borderBottom: '1px solid #0a2235',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Link href="/" className="nav-link" style={{
                fontSize: '0.62rem', color: '#3d7d94', textDecoration: 'none',
                padding: '0.35rem 0.7rem', border: '1px solid #0a2235', borderRadius: '4px',
                letterSpacing: '0.5px',
              }}>
                ← Gallery
              </Link>
              <Link href="/analytics" className="nav-link" style={{
                fontSize: '0.62rem', color: '#3d7d94', textDecoration: 'none',
                padding: '0.35rem 0.7rem', border: '1px solid #0a2235', borderRadius: '4px',
                letterSpacing: '0.5px',
              }}>
                Analytics
              </Link>
            </div>
            <span style={{ color: '#0a2235' }}>│</span>
            <div>
              <div style={{ fontSize: '0.6rem', color: '#00f0ff', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase' }}>
                📊 Criterion Analytics
              </div>
              <div style={{ fontSize: '0.52rem', color: '#0e3050', marginTop: '0.15rem', letterSpacing: '1px' }}>
                Per-criterion performance heatmap
              </div>
            </div>
          </div>
          <Link href="/compare" className="nav-link" style={{
            fontSize: '0.62rem', color: '#3d7d94', textDecoration: 'none',
            padding: '0.35rem 0.7rem', border: '1px solid #0a2235', borderRadius: '4px',
            letterSpacing: '0.5px',
          }}>
            ⚔ Compare Models →
          </Link>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '4rem 0' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem', animation: 'pulse 1.5s ease-in-out infinite' }}>📊</div>
            <p style={{ color: '#3d7d94', fontSize: '0.75rem' }}>Loading criterion data…</p>
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

        {/* Empty */}
        {!loading && !error && data && (data.models.length === 0 || data.criteria.length === 0) && (
          <div style={{
            textAlign: 'center', padding: '5rem 2rem',
            background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '10px',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📭</div>
            <p style={{ color: '#3d7d94', fontSize: '0.78rem', marginBottom: '1.25rem' }}>
              No scored competitions with rubric criteria yet.
            </p>
            <Link href="/competitions/new" style={{
              fontSize: '0.65rem', fontWeight: 700, padding: '0.5rem 1.25rem',
              background: '#00f0ff', color: '#000408', borderRadius: '5px',
              textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            }}>
              ⚔ Start a Competition
            </Link>
          </div>
        )}

        {/* Heatmap table */}
        {!loading && !error && data && data.models.length > 0 && data.criteria.length > 0 && (
          <div style={{ animation: 'fadeIn 0.3s ease both' }}>

            {/* Legend */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1.5rem',
              marginBottom: '1.25rem',
              flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: '0.52rem', color: '#3d7d94', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700 }}>Score Legend</span>
              {[
                { label: '≥75%',  ...heatmapStyle(0.8) },
                { label: '55–75%', ...heatmapStyle(0.65) },
                { label: '40–55%', ...heatmapStyle(0.47) },
                { label: '25–40%', ...heatmapStyle(0.32) },
                { label: '<25%',  ...heatmapStyle(0.1) },
              ].map(({ label, bg, fg }) => (
                <span key={label} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  fontSize: '0.55rem', color: '#3d7d94',
                }}>
                  <span style={{
                    display: 'inline-block', width: '24px', height: '14px',
                    borderRadius: '3px', background: bg,
                    border: `1px solid ${fg}33`,
                  }} />
                  {label}
                </span>
              ))}
            </div>

            {/* Table */}
            <div style={{
              border: '1px solid #0a2235',
              borderRadius: '8px',
              overflow: 'auto',
              marginBottom: '2rem',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', minWidth: '600px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #0a2235', background: '#020b14' }}>
                    <th style={{ ...thBase, textAlign: 'left', minWidth: '200px', padding: '0.65rem 1rem' }}>
                      Criterion
                    </th>
                    {data.models.map((model) => (
                      <th key={model} style={{
                        ...thBase,
                        textAlign: 'center',
                        color: getModelColor(model),
                        padding: '0.65rem 0.75rem',
                        minWidth: '90px',
                      }}>
                        {model}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.criteria.map((cid, i) => (
                    <tr
                      key={cid}
                      className="crit-row"
                      style={{ borderBottom: i < data.criteria.length - 1 ? '1px solid rgba(10,34,53,0.5)' : 'none' }}
                    >
                      <td style={{ padding: '0.65rem 1rem', color: '#7cc6db', fontSize: '0.68rem' }}>
                        <CriterionLabel cid={cid} />
                      </td>
                      {data.models.map((model) => {
                        const cell = data.matrix[model]?.[cid];
                        const { bg, fg } = heatmapStyle(cell?.avg);
                        return (
                          <td key={model} style={{
                            padding: '0.55rem 0.75rem',
                            textAlign: 'center',
                            background: bg,
                            transition: 'background 0.15s ease',
                          }}>
                            {cell ? (
                              <div>
                                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: fg }}>
                                  {(cell.avg * 100).toFixed(0)}%
                                </div>
                                <div style={{ fontSize: '0.48rem', color: '#3d7d94', marginTop: '0.1rem' }}>
                                  n={cell.count}
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: '#0e3050', fontSize: '0.7rem' }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Strengths & Weaknesses */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{
                fontSize: '0.58rem', color: '#3d7d94', textTransform: 'uppercase',
                letterSpacing: '2px', fontWeight: 700, marginBottom: '0.85rem',
              }}>
                Model Insights
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(data.models.length, 3)}, 1fr)`,
                gap: '0.75rem',
              }}>
                {data.models.map((model) => {
                  const color = getModelColor(model);
                  const { strengths, weaknesses } = modelInsights(model, data.criteria, data.matrix);
                  return (
                    <div
                      key={model}
                      className="insight-card"
                      style={{
                        background: '#050f1e',
                        border: `1px solid ${color}22`,
                        borderTop: `3px solid ${color}`,
                        borderRadius: '8px',
                        padding: '1.1rem',
                      }}
                    >
                      <div style={{
                        fontSize: '0.62rem', color, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '0.85rem',
                      }}>
                        {model}
                      </div>

                      <div style={{ marginBottom: '0.65rem' }}>
                        <div style={{ fontSize: '0.5rem', color: '#00f0ff', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700, marginBottom: '0.35rem' }}>
                          Top Criteria
                        </div>
                        {strengths.length > 0 ? strengths.map(({ cid, avg }) => (
                          <div key={cid} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            gap: '0.5rem', marginBottom: '0.25rem',
                          }}>
                            <span style={{
                              fontSize: '0.6rem', color: '#7cc6db', overflow: 'hidden',
                              textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                            }} title={cid}>
                              {cid.length > 22 ? `${cid.slice(0, 20)}…` : cid}
                            </span>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#00f0ff', flexShrink: 0 }}>
                              {avg !== undefined ? `${(avg * 100).toFixed(0)}%` : '—'}
                            </span>
                          </div>
                        )) : (
                          <p style={{ fontSize: '0.6rem', color: '#0e3050', margin: 0 }}>No data</p>
                        )}
                      </div>

                      <div>
                        <div style={{ fontSize: '0.5rem', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700, marginBottom: '0.35rem' }}>
                          Weak Areas
                        </div>
                        {weaknesses.length > 0 ? weaknesses.map(({ cid, avg }) => (
                          <div key={cid} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            gap: '0.5rem', marginBottom: '0.25rem',
                          }}>
                            <span style={{
                              fontSize: '0.6rem', color: '#7cc6db', overflow: 'hidden',
                              textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                            }} title={cid}>
                              {cid.length > 22 ? `${cid.slice(0, 20)}…` : cid}
                            </span>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#ef4444', flexShrink: 0 }}>
                              {avg !== undefined ? `${(avg * 100).toFixed(0)}%` : '—'}
                            </span>
                          </div>
                        )) : (
                          <p style={{ fontSize: '0.6rem', color: '#0e3050', margin: 0 }}>No data</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
