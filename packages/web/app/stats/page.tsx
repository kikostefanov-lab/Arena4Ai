'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  MONOSPACE_FONT, BODY_FONT, BODY_FONT_SIZE, BODY_FONT_SIZE_SM,
  KICKER_STYLE, getModelColor,
  ACCENT_GOLD, ACCENT_SILVER, ACCENT_BRONZE, TEXT_MUTED,
} from '../../lib/design-tokens';
import { formatDuration } from '../../lib/format';

// ── Shared types ────────────────────────────────────────────────────────────

type Tab = 'analytics' | 'leaderboard' | 'compare';

const TABS: { id: Tab; label: string }[] = [
  { id: 'analytics',   label: 'Analytics' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'compare',     label: 'Compare' },
];

// ── Analytics types ─────────────────────────────────────────────────────────

interface AgentStat { model: string; wins: number; total: number; winRate: number }
interface FormatStat { format: string; total: number; completed: number; avgDurationMs: number | null }
interface RecentComp { id: string; title: string; format: string | null; agents: string[]; winner: string | null; durationMs: number | null }
interface AnalyticsSummary {
  totalCompetitions: number;
  completedCompetitions: number;
  completionRate: number;
  avgDurationMs: number | null;
  byModel: AgentStat[];
  synthesisCount: number;
  byFormat: FormatStat[];
  headToHead: Record<string, Record<string, { wins: number; losses: number; draws: number }>>;
  recentCompetitions: RecentComp[];
}

// ── Leaderboard types ───────────────────────────────────────────────────────

interface LeaderboardEntry {
  rank: number;
  model: string;
  wins: number;
  losses: number;
  ties: number;
  totalCompetitions: number;
  avgScore: number;
  winRate: number;
}

// ── Compare types ───────────────────────────────────────────────────────────

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

// ── Analytics helpers ───────────────────────────────────────────────────────

const MODEL_ICONS_ANALYTICS: Record<string, string> = { claude: '\u{1F7E0}', codex: '\u{1F7E2}', gemini: '\u{1F7E3}' };

const FORMAT_BADGE_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  SPRINT:      { color: '#06b6d4', icon: '\u26A1',       label: 'SPRINT' },
  HACKATHON:   { color: '#00f0ff', icon: '\u{1F528}', label: 'HACKATHON' },
  RELAY_RACE:  { color: '#0066ff', icon: '\u{1F504}', label: 'RELAY' },
  RED_VS_BLUE: { color: '#ef4444', icon: '\u2694', label: 'RED\u00D7BLUE' },
};

function FormatBadge({ format }: { format: string | null }) {
  if (!format) return <span style={{ color: '#0e3050' }}>&mdash;</span>;
  const cfg = FORMAT_BADGE_CONFIG[format];
  const color = cfg?.color ?? '#4a8fa8';
  const icon = cfg?.icon ?? '';
  const label = cfg?.label ?? format;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
      padding: '0.15rem 0.5rem', borderRadius: '3px',
      background: `${color}1a`, border: `1px solid ${color}44`,
      color, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
    }}>
      <span style={{ fontSize: '0.65rem' }}>{icon}</span> {label}
    </span>
  );
}

function getModelIconAnalytics(key: string): string {
  const base = key.split(':')[0]?.toLowerCase() ?? '';
  return MODEL_ICONS_ANALYTICS[base] ?? '\u2B24';
}

function parseAgentKey(key: string): { model: string; persona: string | null } {
  const colon = key.indexOf(':');
  if (colon === -1) return { model: key, persona: null };
  return { model: key.slice(0, colon), persona: key.slice(colon + 1) };
}

function h2hCellBg(wins: number, losses: number): string {
  const total = wins + losses;
  if (total === 0) return 'transparent';
  const ratio = wins / total;
  if (ratio >= 0.7) return 'rgba(0,102,255,0.15)';
  if (ratio >= 0.5) return 'rgba(0,102,255,0.07)';
  if (ratio >= 0.3) return 'rgba(239,68,68,0.07)';
  return 'rgba(239,68,68,0.15)';
}

// ── Leaderboard helpers ─────────────────────────────────────────────────────

const MODEL_ICONS_LB: Record<string, string> = { claude: '\u25C6', codex: '\u25A0', gemini: '\u25CF' };

function WinRateBar({ winRate, color }: { winRate: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '120px' }}>
      <div style={{ flex: 1, height: '6px', background: '#0a2235', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${Math.round(winRate * 100)}%`,
          background: `linear-gradient(90deg, ${color}99, ${color})`,
          borderRadius: '3px', transition: 'width 0.6s ease',
        }} />
      </div>
      <span style={{ fontSize: '0.7rem', fontWeight: 700, color, minWidth: '3rem', textAlign: 'right' }}>
        {Math.round(winRate * 100)}%
      </span>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const color = rank === 1 ? ACCENT_GOLD : rank === 2 ? ACCENT_SILVER : rank === 3 ? ACCENT_BRONZE : TEXT_MUTED;
  const medal = rank === 1 ? '\u{1F947}' : rank === 2 ? '\u{1F948}' : rank === 3 ? '\u{1F949}' : null;
  const bg = medal ? `${color}26` : 'rgba(10,34,53,0.5)';
  const border = medal ? `${color}66` : '#0a2235';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '2.2rem', height: '2.2rem', borderRadius: '6px',
      background: bg, border: `1px solid ${border}`,
      fontSize: medal ? '1.1rem' : '0.85rem', fontWeight: 800, color, flexShrink: 0,
    }}>
      {medal ?? `#${rank}`}
    </div>
  );
}

// ── Compare helpers ─────────────────────────────────────────────────────────

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
        height: '100%', width: `${pct}%`,
        background: `linear-gradient(90deg, ${color}88, ${color})`,
        borderRadius: '4px', transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

function StatCard({ label, aVal, bVal, aColor, bColor }: {
  label: string; aVal: string | number; bVal: string | number; aColor: string; bColor: string;
}) {
  return (
    <div style={{ background: '#050f1e', border: '1px solid #0a2235', borderRadius: '8px', padding: '1rem 1.25rem' }}>
      <div style={{ fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT, color: '#3d7d94', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700, marginBottom: '0.75rem' }}>
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

// ══════════════════════════════════════════════════════════════════════════════
// ── Analytics Tab ────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/analytics')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: AnalyticsSummary) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  const font = MONOSPACE_FONT;
  const thStyle: React.CSSProperties = {
    textAlign: 'left', padding: '0.6rem 1rem', fontSize: '0.55rem',
    color: '#1e4a5a', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700, fontFamily: font,
  };
  const thRightStyle: React.CSSProperties = { ...thStyle, textAlign: 'right' };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 0' }}>
        <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem', animation: 'pulse 1.5s ease-in-out infinite' }}>{'\u{1F4CA}'}</div>
        <p style={{ color: '#4a8fa8', fontSize: '0.75rem' }}>Loading analytics...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{
        textAlign: 'center', padding: '4rem 2rem',
        background: '#050f1e', border: '1px solid #0a2235', borderRadius: '8px',
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>{'\u26A0\uFE0F'}</div>
        <p style={{ color: '#4a8fa8', fontSize: BODY_FONT_SIZE, fontFamily: BODY_FONT }}>
          Could not reach orchestrator. Is it running?
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Overview tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '2rem' }}>
        {[
          { icon: '\u{1F4CA}', label: 'Total Battles', value: data.totalCompetitions, accent: '#3b82f6' },
          { icon: '\u2705', label: 'Completed', value: data.completedCompetitions, accent: '#0066ff' },
          { icon: '\u23F1\uFE0F', label: 'Avg Duration', value: formatDuration(data.avgDurationMs), accent: '#00f0ff' },
          { icon: '\u{1F52C}', label: 'Syntheses', value: data.synthesisCount, accent: '#00f0ff' },
        ].map(({ icon, label, value, accent }) => (
          <div key={label} style={{
            background: '#050f1e', border: '1px solid #0a2235', borderLeft: `3px solid ${accent}`,
            borderRadius: '6px', padding: '1rem 1.1rem', position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: '0.8rem', right: '0.9rem', fontSize: '1.4rem', opacity: 0.7 }}>{icon}</div>
            <div style={{ fontSize: '0.52rem', color: '#4a8fa8', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '0.5rem', fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#c8eef8' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Win Rate by Agent */}
      <div style={{ border: '1px solid #0a2235', borderRadius: '8px', overflow: 'hidden', marginBottom: '2rem' }}>
        <div style={{
          background: '#010810', padding: '0.75rem 1rem', borderBottom: '1px solid #0a2235',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#4a8fa8', textTransform: 'uppercase', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {'\u{1F3C6}'} Win Rate by Agent
          </span>
          <span style={{ fontSize: '0.5rem', color: '#1e4a5a', letterSpacing: '1px' }}>model:persona</span>
        </div>

        {data.byModel.length === 0 ? (
          <div style={{ padding: '3rem', color: '#4a8fa8', fontSize: '0.75rem', textAlign: 'center' }}>
            No completed competitions yet.
          </div>
        ) : (() => {
          const sorted = [...data.byModel].sort((a, b) => b.winRate - a.winRate);
          const topWinRate = sorted[0]?.winRate ?? 0;
          return (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #0a2235' }}>
                  <th style={{ ...thStyle, width: '2rem' }}>#</th>
                  <th style={thStyle}>Agent</th>
                  <th style={thRightStyle}>W</th>
                  <th style={thRightStyle}>Total</th>
                  <th style={thRightStyle}>Win %</th>
                  <th style={{ ...thStyle, width: '9rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((stat, idx) => {
                  const { model, persona } = parseAgentKey(stat.model);
                  const modelColor = getModelColor(stat.model);
                  const modelIcon = getModelIconAnalytics(stat.model);
                  const isTop = stat.winRate === topWinRate && stat.winRate > 0;
                  return (
                    <tr key={stat.model} style={{
                      borderBottom: '1px solid rgba(10,34,53,0.5)',
                      background: isTop ? 'rgba(234,179,8,0.04)' : 'transparent',
                    }}>
                      <td style={{ padding: '0.65rem 1rem', color: '#1e4a5a', fontSize: '0.6rem', fontWeight: 700 }}>
                        {isTop ? '\u{1F947}' : `${idx + 1}`}
                      </td>
                      <td style={{ padding: '0.65rem 1rem' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{ fontSize: '0.7rem' }}>{modelIcon}</span>
                          <span style={{ color: modelColor, fontWeight: 700 }}>{model}</span>
                          {persona && <span style={{ color: '#4a8fa8', fontSize: '0.62rem' }}>:{persona}</span>}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: '#c8eef8', fontWeight: 600 }}>{stat.wins}</td>
                      <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: '#4a8fa8' }}>{stat.total}</td>
                      <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: isTop ? '#eab308' : '#c8eef8', fontWeight: 700 }}>
                        {(stat.winRate * 100).toFixed(0)}%
                      </td>
                      <td style={{ padding: '0.65rem 1rem' }}>
                        <div style={{ height: '6px', background: '#081520', borderRadius: '3px', overflow: 'hidden', width: '100%' }}>
                          <div style={{
                            height: '100%',
                            background: isTop ? 'linear-gradient(90deg, #eab308, #00f0ff)' : modelColor,
                            borderRadius: '3px', width: `${stat.winRate * 100}%`, transition: 'width 0.5s ease',
                          }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })()}
      </div>

      {/* Head-to-Head Matrix */}
      <div style={{ border: '1px solid #0a2235', borderRadius: '8px', overflow: 'hidden', marginBottom: '2rem' }}>
        <div style={{ background: '#010810', padding: '0.75rem 1rem', borderBottom: '1px solid #0a2235' }}>
          <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#4a8fa8', textTransform: 'uppercase', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {'\u2694'} Head-to-Head
          </span>
        </div>

        {(!data.headToHead || Object.keys(data.headToHead).length === 0) ? (
          <div style={{ padding: '3rem', color: '#4a8fa8', fontSize: '0.75rem', textAlign: 'center' }}>
            Not enough data for head-to-head analysis.
          </div>
        ) : (() => {
          const personas = Object.keys(data.headToHead);
          return (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.66rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #0a2235' }}>
                    <th style={{
                      padding: '0.6rem 0.75rem', textAlign: 'left', fontSize: '0.52rem', color: '#1e4a5a',
                      textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700, minWidth: '130px',
                    }}>
                      vs {'\u2192'}
                    </th>
                    {personas.map((p) => (
                      <th key={p} style={{
                        padding: '0.6rem 0.75rem', textAlign: 'center', fontSize: '0.56rem',
                        color: getModelColor(p), fontWeight: 700, whiteSpace: 'nowrap',
                      }}>
                        <span style={{ marginRight: '0.2rem' }}>{getModelIconAnalytics(p)}</span> {p}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {personas.map((rowPersona) => (
                    <tr key={rowPersona} style={{ borderBottom: '1px solid rgba(10,34,53,0.5)' }}>
                      <td style={{ padding: '0.65rem 0.75rem', color: getModelColor(rowPersona), fontWeight: 700, whiteSpace: 'nowrap' }}>
                        <span style={{ marginRight: '0.3rem' }}>{getModelIconAnalytics(rowPersona)}</span>
                        {rowPersona}
                      </td>
                      {personas.map((colPersona) => {
                        if (rowPersona === colPersona) {
                          return (
                            <td key={colPersona} style={{ padding: '0.65rem 0.75rem', textAlign: 'center', background: 'rgba(10,34,53,0.15)' }}>
                              <span style={{ display: 'inline-block', width: '18px', height: '2px', background: '#0e3050', borderRadius: '1px' }} />
                            </td>
                          );
                        }
                        const cell = data.headToHead[rowPersona]?.[colPersona];
                        if (!cell) {
                          return <td key={colPersona} style={{ padding: '0.65rem 0.75rem', textAlign: 'center', color: '#0e3050' }}>&mdash;</td>;
                        }
                        return (
                          <td key={colPersona} style={{ padding: '0.65rem 0.75rem', textAlign: 'center', background: h2hCellBg(cell.wins, cell.losses) }}>
                            {cell.wins > 0 && <span style={{ color: '#0066ff', fontWeight: 700 }}>{cell.wins}W</span>}
                            {cell.wins > 0 && cell.losses > 0 && <span style={{ color: '#1e4a5a', margin: '0 0.2rem' }}>/</span>}
                            {cell.losses > 0 && <span style={{ color: '#ef4444', fontWeight: 700 }}>{cell.losses}L</span>}
                            {cell.draws > 0 && (
                              <span style={{ color: '#4a8fa8', fontWeight: 700, marginLeft: cell.wins > 0 || cell.losses > 0 ? '0.25rem' : '0' }}>
                                {cell.draws}D
                              </span>
                            )}
                            {cell.wins === 0 && cell.losses === 0 && cell.draws === 0 && <span style={{ color: '#0e3050' }}>&mdash;</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* By Format */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
          <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#4a8fa8', textTransform: 'uppercase', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {'\u{1F3AF}'} By Format
          </span>
        </div>

        {(!data.byFormat || data.byFormat.length === 0) ? (
          <div style={{ color: '#4a8fa8', fontSize: '0.75rem', padding: '2rem', textAlign: 'center', background: '#050f1e', border: '1px solid #0a2235', borderRadius: '8px' }}>
            No format data available.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
            {(data.byFormat ?? []).map((f) => {
              const cfg = FORMAT_BADGE_CONFIG[f.format];
              const color = cfg?.color ?? '#4a8fa8';
              const icon = cfg?.icon ?? '\u{1F4CB}';
              const completionPct = f.total > 0 ? (f.completed / f.total) * 100 : 0;
              return (
                <div key={f.format} style={{
                  background: '#050f1e', border: `1px solid ${color}33`, borderTop: `3px solid ${color}`,
                  borderRadius: '8px', padding: '1.1rem', position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{ position: 'absolute', top: '0.8rem', right: '0.8rem', fontSize: '1.8rem', opacity: 0.08 }}>{icon}</div>
                  <div style={{ marginBottom: '0.8rem' }}><FormatBadge format={f.format} /></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT }}>
                      <span style={{ color: '#4a8fa8' }}>Total</span>
                      <span style={{ color: '#c8eef8', fontWeight: 700 }}>{f.total}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT }}>
                      <span style={{ color: '#4a8fa8' }}>Completed</span>
                      <span style={{ color: '#0066ff', fontWeight: 700 }}>{f.completed}</span>
                    </div>
                    <div style={{ height: '3px', background: '#081520', borderRadius: '2px', overflow: 'hidden', margin: '0.1rem 0' }}>
                      <div style={{ height: '100%', background: color, borderRadius: '2px', width: `${completionPct}%` }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT }}>
                      <span style={{ color: '#4a8fa8' }}>Avg Duration</span>
                      <span style={{ color: '#c8eef8' }}>{formatDuration(f.avgDurationMs)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Competitions */}
      <div style={{ border: '1px solid #0a2235', borderRadius: '8px', overflow: 'hidden', marginBottom: '2rem' }}>
        <div style={{ background: '#010810', padding: '0.75rem 1rem', borderBottom: '1px solid #0a2235' }}>
          <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#4a8fa8', textTransform: 'uppercase', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {'\u{1F4DC}'} Recent Competitions
          </span>
        </div>

        {(!data.recentCompetitions || data.recentCompetitions.length === 0) ? (
          <div style={{ padding: '3rem', color: '#4a8fa8', fontSize: '0.75rem', textAlign: 'center' }}>
            No completed competitions yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #0a2235' }}>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Format</th>
                <th style={thStyle}>Matchup</th>
                <th style={thStyle}>Winner</th>
                <th style={thRightStyle}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {(data.recentCompetitions ?? []).map((comp) => {
                const winnerColor = comp.winner ? getModelColor(comp.winner) : '#4a8fa8';
                return (
                  <tr key={comp.id} style={{ borderBottom: '1px solid rgba(10,34,53,0.5)' }}>
                    <td style={{ padding: '0.65rem 1rem' }}>
                      <a href={`/competitions/${comp.id}`} style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>{'\u{1F3C6}'}</span>
                        {comp.title}
                      </a>
                    </td>
                    <td style={{ padding: '0.65rem 1rem' }}><FormatBadge format={comp.format} /></td>
                    <td style={{ padding: '0.65rem 1rem', color: '#4a8fa8' }}>
                      {comp.agents.length >= 2 ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                          <span style={{ color: getModelColor(comp.agents[0]), fontWeight: 600 }}>{comp.agents[0]}</span>
                          <span style={{ color: '#1e4a5a', fontSize: '0.58rem', fontWeight: 700 }}>VS</span>
                          <span style={{ color: getModelColor(comp.agents[1]), fontWeight: 600 }}>{comp.agents[1]}</span>
                        </span>
                      ) : comp.agents.join(', ')}
                    </td>
                    <td style={{ padding: '0.65rem 1rem' }}>
                      {comp.winner ? (
                        <span style={{ color: winnerColor, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ color: '#eab308' }}>{'\u2605'}</span> {comp.winner}
                        </span>
                      ) : <span style={{ color: '#0e3050' }}>&mdash;</span>}
                    </td>
                    <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: '#4a8fa8' }}>
                      {formatDuration(comp.durationMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Leaderboard Tab ──────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function LeaderboardTab() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then((data: LeaderboardEntry[]) => { setEntries(data); setLoading(false); })
      .catch(() => { setError('Failed to load leaderboard \u2014 is the API server running?'); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 0' }}>
        <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem', animation: 'pulse 1.5s ease-in-out infinite' }}>{'\u{1F3C6}'}</div>
        <p style={{ color: '#4a8fa8', fontSize: '0.75rem' }}>Loading leaderboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        textAlign: 'center', padding: '3rem 2rem',
        background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px',
      }}>
        <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>{'\u26A0\uFE0F'}</div>
        <p style={{ color: '#ef4444', fontSize: '0.75rem' }}>{error}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '5rem 2rem',
        background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '12px',
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{'\u{1F3C6}'}</div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#c8eef8', marginBottom: '0.5rem' }}>
          No champions yet {'\u2014'} the arena awaits its first victor.
        </h2>
        <Link href="/competitions/new" className="arena-btn arena-btn-primary new-comp-btn">
          {'\u2694'} Launch First Battle
        </Link>
      </div>
    );
  }

  return (
    <>
      <div style={{
        background: '#050f1e', border: '1px solid #0a2235', borderRadius: '10px',
        overflow: 'hidden', animation: 'fadeIn 0.3s ease both',
      }}>
        {/* Table Header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '3.5rem 1fr 4rem 4rem 4rem 6rem 6rem 10rem',
          gap: '0', padding: '0.65rem 1.25rem', background: '#020b14',
          borderBottom: '1px solid #0a2235', fontSize: '0.5rem', fontWeight: 700,
          letterSpacing: '1.5px', color: '#1e4a5a', textTransform: 'uppercase', alignItems: 'center',
        }}>
          <span>Rank</span>
          <span>Model</span>
          <span style={{ textAlign: 'center' }}>W</span>
          <span style={{ textAlign: 'center' }}>L</span>
          <span style={{ textAlign: 'center' }}>T</span>
          <span style={{ textAlign: 'center' }}>Battles</span>
          <span style={{ textAlign: 'right' }}>Avg Score</span>
          <span style={{ paddingLeft: '0.5rem' }}>Win Rate</span>
        </div>

        {/* Table Rows */}
        {entries.map((entry, i) => {
          const color = getModelColor(entry.model);
          const icon = MODEL_ICONS_LB[entry.model] ?? '\u25C7';
          return (
            <div key={entry.model} className="lb-row" style={{
              display: 'grid', gridTemplateColumns: '3.5rem 1fr 4rem 4rem 4rem 6rem 6rem 10rem',
              gap: '0', padding: '0.9rem 1.25rem',
              borderBottom: i < entries.length - 1 ? '1px solid #081520' : 'none',
              background: 'transparent', alignItems: 'center',
              animation: `fadeIn 0.3s ease ${i * 0.06}s both`,
            }}>
              <div><RankBadge rank={entry.rank} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontSize: '0.85rem', color, fontWeight: 800 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '1px' }}>{entry.model}</div>
                  <div style={{ fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT, color: '#1e4a5a', marginTop: '0.1rem', letterSpacing: '0.5px' }}>
                    {entry.totalCompetitions} competition{entry.totalCompetitions !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'center', fontSize: '0.82rem', fontWeight: 700, color: entry.wins > 0 ? '#0066ff' : '#0e3050' }}>{entry.wins}</div>
              <div style={{ textAlign: 'center', fontSize: '0.82rem', fontWeight: 700, color: entry.losses > 0 ? '#ef4444' : '#0e3050' }}>{entry.losses}</div>
              <div style={{ textAlign: 'center', fontSize: '0.82rem', fontWeight: 700, color: entry.ties > 0 ? '#eab308' : '#0e3050' }}>{entry.ties}</div>
              <div style={{ textAlign: 'center', fontSize: '0.78rem', color: '#4a8fa8', fontWeight: 600 }}>{entry.totalCompetitions}</div>
              <div style={{ textAlign: 'right', fontSize: '0.78rem', fontWeight: 600, color: '#c8eef8' }}>{Math.round(entry.avgScore * 100)}%</div>
              <div style={{ paddingLeft: '0.5rem' }}><WinRateBar winRate={entry.winRate} color={color} /></div>
            </div>
          );
        })}
      </div>

      <p style={{
        marginTop: '1rem', fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT,
        color: '#0e3050', textAlign: 'center', letterSpacing: '0.5px',
      }}>
        Rankings based on completed competitions only {'\u00B7'} Sorted by win rate, then avg score, then total wins
      </p>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Compare Tab ──────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function CompareTab() {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelA, setModelA] = useState('');
  const [modelB, setModelB] = useState('');
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);

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
        if (sorted.length >= 2) { setModelA(sorted[0]); setModelB(sorted[1]); }
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

  useEffect(() => {
    if (modelA && modelB && modelA !== modelB) fetchCompare();
    else setData(null);
  }, [modelA, modelB, fetchCompare]);

  const colorA = modelA ? getModelColor(modelA) : '#7cc6db';
  const colorB = modelB ? getModelColor(modelB) : '#7cc6db';

  const selectStyle: React.CSSProperties = {
    background: '#050f1e', border: '1px solid #0a2235', borderRadius: '6px',
    color: '#e4f8ff', fontSize: '0.78rem', fontFamily: MONOSPACE_FONT,
    padding: '0.55rem 0.9rem', outline: 'none', cursor: 'pointer',
    minWidth: '180px', appearance: 'none', WebkitAppearance: 'none',
  };

  const maxAvgScore = Math.max(data?.modelA.avgScore ?? 0, data?.modelB.avgScore ?? 0, 1);

  return (
    <>
      <style>{`
        .compare-card { transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease; }
        .compare-card:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(0,240,255,0.12); border-color: #0e3050 !important; }
        select:hover { border-color: #0e3050 !important; }
      `}</style>

      {/* Model Selectors */}
      <div style={{
        background: '#050f1e', border: '1px solid #0a2235', borderRadius: '10px',
        padding: '1.5rem', marginBottom: '2rem',
        display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: '160px' }}>
          <div style={{ fontSize: '0.52rem', color: colorA, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700, marginBottom: '0.45rem' }}>Model A</div>
          {modelsLoading ? (
            <div style={{ fontSize: '0.7rem', color: '#3d7d94' }}>Loading...</div>
          ) : (
            <div style={{ position: 'relative' }}>
              <select value={modelA} onChange={(e) => setModelA(e.target.value)} style={{ ...selectStyle, borderColor: modelA ? `${colorA}44` : '#0a2235', width: '100%' }}>
                <option value="">-- select --</option>
                {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <span style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: '#3d7d94', pointerEvents: 'none', fontSize: '0.6rem' }}>{'\u25BE'}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
          <span style={{ fontSize: '1.2rem', color: '#0e3050', fontWeight: 800 }}>VS</span>
        </div>

        <div style={{ flex: 1, minWidth: '160px' }}>
          <div style={{ fontSize: '0.52rem', color: colorB, textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700, marginBottom: '0.45rem' }}>Model B</div>
          {modelsLoading ? (
            <div style={{ fontSize: '0.7rem', color: '#3d7d94' }}>Loading...</div>
          ) : (
            <div style={{ position: 'relative' }}>
              <select value={modelB} onChange={(e) => setModelB(e.target.value)} style={{ ...selectStyle, borderColor: modelB ? `${colorB}44` : '#0a2235', width: '100%' }}>
                <option value="">-- select --</option>
                {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <span style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: '#3d7d94', pointerEvents: 'none', fontSize: '0.6rem' }}>{'\u25BE'}</span>
            </div>
          )}
        </div>

        {modelA === modelB && modelA && (
          <p style={{ fontSize: '0.65rem', fontFamily: BODY_FONT, color: '#ef4444', flex: '100%', margin: 0 }}>
            Select two different models to compare.
          </p>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '4rem 0' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem', animation: 'pulse 1.5s ease-in-out infinite' }}>{'\u2694'}</div>
          <p style={{ color: '#3d7d94', fontSize: '0.75rem' }}>Crunching the numbers...</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{
          textAlign: 'center', padding: '3rem 2rem',
          background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px',
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
              <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>{'\u{1F4ED}'}</div>
              <p style={{ color: '#3d7d94', fontSize: BODY_FONT_SIZE, fontFamily: BODY_FONT, marginBottom: '1.25rem' }}>
                No completed head-to-head matches between <span style={{ color: colorA }}>{modelA}</span> and <span style={{ color: colorB }}>{modelB}</span> yet.
              </p>
              <Link href="/competitions/new" style={{
                fontSize: '0.65rem', fontWeight: 700, padding: '0.5rem 1.25rem',
                background: '#00f0ff', color: '#000408', borderRadius: '5px',
                textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              }}>
                {'\u2694'} Run their first match
              </Link>
            </div>
          ) : (
            <div style={{ animation: 'fadeIn 0.3s ease both' }}>
              {/* Big W-L-D record */}
              <div style={{
                background: '#050f1e', border: '1px solid #0a2235', borderRadius: '10px',
                padding: '1.75rem', marginBottom: '1.25rem',
                display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '1.5rem', alignItems: 'center',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6rem', color: colorA, textTransform: 'uppercase', letterSpacing: '3px', fontWeight: 700, marginBottom: '0.5rem' }}>{data.modelA.key}</div>
                  <div style={{ fontSize: '3rem', fontWeight: 900, color: colorA, lineHeight: 1 }}>{data.modelA.wins}{'\u2013'}{data.modelA.losses}{'\u2013'}{data.modelA.draws}</div>
                  <div style={{ fontSize: '0.52rem', color: '#3d7d94', marginTop: '0.4rem', letterSpacing: '1.5px' }}>W {'\u2013'} L {'\u2013'} D</div>
                </div>
                <div style={{ textAlign: 'center', color: '#0e3050' }}>
                  <div style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '0.35rem' }}>{data.matchups} match{data.matchups !== 1 ? 'es' : ''}</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>VS</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.6rem', color: colorB, textTransform: 'uppercase', letterSpacing: '3px', fontWeight: 700, marginBottom: '0.5rem' }}>{data.modelB.key}</div>
                  <div style={{ fontSize: '3rem', fontWeight: 900, color: colorB, lineHeight: 1 }}>{data.modelB.wins}{'\u2013'}{data.modelB.losses}{'\u2013'}{data.modelB.draws}</div>
                  <div style={{ fontSize: '0.52rem', color: '#3d7d94', marginTop: '0.4rem', letterSpacing: '1.5px' }}>W {'\u2013'} L {'\u2013'} D</div>
                </div>
              </div>

              {/* Avg score bar comparison */}
              {(data.modelA.avgScore !== null || data.modelB.avgScore !== null) && (
                <div style={{ background: '#050f1e', border: '1px solid #0a2235', borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }}>
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
                        {score !== null ? `${(score * 100).toFixed(1)}%` : '\u2014'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Stat cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <StatCard label="Wins" aVal={data.modelA.wins} bVal={data.modelB.wins} aColor={colorA} bColor={colorB} />
                <StatCard label="Losses" aVal={data.modelA.losses} bVal={data.modelB.losses} aColor={colorA} bColor={colorB} />
                <StatCard label="Draws" aVal={data.modelA.draws} bVal={data.modelB.draws} aColor={colorA} bColor={colorB} />
              </div>

              {/* Recent matches */}
              {data.recentMatches.length > 0 && (
                <div style={{ border: '1px solid #0a2235', borderRadius: '8px', overflow: 'hidden' }}>
                  <div style={{
                    background: '#020b14', padding: '0.75rem 1rem', borderBottom: '1px solid #0a2235',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#3d7d94', textTransform: 'uppercase', letterSpacing: '2px' }}>
                      {'\u{1F4DC}'} Recent Matches
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
                            padding: '0.55rem 1rem', textAlign: align as React.CSSProperties['textAlign'],
                            fontSize: '0.5rem', color: '#0e3050', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700,
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
                          <tr key={match.id} className="compare-card" style={{ borderBottom: '1px solid rgba(10,34,53,0.5)' }}>
                            <td style={{ padding: '0.65rem 1rem' }}>
                              <Link href={`/competitions/${match.id}`} style={{ color: '#0066ff', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>{'\u{1F3C6}'}</span>
                                {match.title}
                              </Link>
                            </td>
                            <td style={{ padding: '0.65rem 1rem' }}>
                              {match.winner ? (
                                <span style={{ color: winnerColor, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                  <span style={{ color: '#eab308' }}>{'\u2605'}</span> {match.winner}
                                </span>
                              ) : <span style={{ color: '#3d7d94' }}>Draw</span>}
                            </td>
                            <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: colorA, fontWeight: 600 }}>
                              {match.modelAScore !== null ? `${(match.modelAScore * 100).toFixed(1)}%` : '\u2014'}
                            </td>
                            <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: colorB, fontWeight: 600 }}>
                              {match.modelBScore !== null ? `${(match.modelBScore * 100).toFixed(1)}%` : '\u2014'}
                            </td>
                            <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: '#3d7d94', fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT }}>
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
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Main Stats Page (inner, reads searchParams) ──────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function StatsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabParam = searchParams.get('tab');
  const activeTab: Tab = (tabParam === 'leaderboard' || tabParam === 'compare') ? tabParam : 'analytics';

  function setTab(tab: Tab) {
    router.replace(`/stats?tab=${tab}`);
  }

  return (
    <div style={{ minHeight: '100vh', fontFamily: MONOSPACE_FONT, color: '#c8eef8' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '2.5rem 2rem' }}>

        {/* Hero header */}
        <div style={{
          marginBottom: '2.25rem', paddingBottom: '1.25rem',
          borderBottom: '1px solid #0a2235',
        }}>
          <div style={{ ...KICKER_STYLE, color: '#00f0ff', marginBottom: '0.4rem' }}>
            {'\u25C6'} ARENA4AI | STATS
          </div>
          <h1 style={{
            fontSize: '2rem', fontWeight: 800, lineHeight: 1.05, margin: 0,
            background: 'linear-gradient(135deg, #c8eef8 0%, #00f0ff 50%, #0080ff 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            fontFamily: 'var(--font-orbitron), monospace',
          }}>
            Model Stats
          </h1>
          <p style={{ fontSize: '0.72rem', fontFamily: BODY_FONT, color: '#4a8fa8', marginTop: '0.4rem', margin: '0.4rem 0 0' }}>
            Performance analytics, leaderboard rankings, and head-to-head comparisons
          </p>
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex', gap: 0,
          borderBottom: '1px solid rgba(0,240,255,0.15)',
          marginBottom: '2rem',
        }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              style={{
                padding: '0.6rem 1.4rem',
                background: 'none',
                cursor: 'pointer',
                fontSize: '0.75rem',
                border: 'none',
                borderBottomWidth: 2,
                borderBottomStyle: 'solid',
                borderBottomColor: activeTab === tab.id ? '#00f0ff' : 'transparent',
                color: activeTab === tab.id ? '#00f0ff' : '#3d7d94',
                fontFamily: MONOSPACE_FONT,
                letterSpacing: 1,
                fontWeight: activeTab === tab.id ? 700 : 400,
                transition: 'color 0.15s ease, border-color 0.15s ease',
              }}
            >
              {tab.label.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'analytics' && <AnalyticsTab />}
        {activeTab === 'leaderboard' && <LeaderboardTab />}
        {activeTab === 'compare' && <CompareTab />}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Exported page (Suspense boundary for useSearchParams) ────────────────────
// ══════════════════════════════════════════════════════════════════════════════

export default function StatsPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#4a8fa8', fontFamily: MONOSPACE_FONT, fontSize: '0.75rem' }}>Loading...</p>
      </div>
    }>
      <StatsPageInner />
    </Suspense>
  );
}
