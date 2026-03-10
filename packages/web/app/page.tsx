'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getModelColor, getStateStyle, FORMAT_BADGES } from '../lib/design-tokens';
import { formatTimeLimit } from '../lib/format';

interface TournamentSummary {
  id: string;
  name: string;
  state: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  teams: string[];
  matchIds: string[];
  brief?: { title?: string };
}

interface Team {
  id: string;
  model: string;
  persona?: string;
}

interface CompetitionSummary {
  id: string;
  state: string;
  startedAt: string | null;
  completedAt: string | null;
  brief: { title: string; format?: string; timeLimitMs?: number; problem?: string };
  teams: Team[];
  winnerId: string | null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function teamLabel(t: Team) {
  return t.persona ? `${t.model}:${t.persona}` : t.model;
}

function teamColor(t: Team): string {
  return getModelColor(t.model);
}

export default function GalleryPage() {
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string>('ALL');
  const [modelFilter, setModelFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(true);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  // Health check on mount and every 30 seconds
  useEffect(() => {
    const checkHealth = () => {
      fetch('/api/health')
        .then((r) => r.json())
        .then((data: { ok: boolean }) => setApiOnline(data.ok))
        .catch(() => setApiOnline(false));
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch competitions on mount
  useEffect(() => {
    fetch('/api/competitions')
      .then((r) => r.json())
      .then((data: CompetitionSummary[]) => { setCompetitions(data); setLoading(false); })
      .catch(() => { setError('Failed to load competitions — is the API server running?'); setLoading(false); });
  }, []);

  // Auto-refresh competitions list every 10 seconds while tab is visible
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/competitions')
        .then((r) => r.json())
        .then((data: CompetitionSummary[]) => setCompetitions(data))
        .catch(() => { /* silently ignore refresh errors */ });
    };
    const interval = setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useEffect(() => {
    fetch('/api/tournaments')
      .then((r) => r.json())
      .then((data: TournamentSummary[]) => { setTournaments(Array.isArray(data) ? data : []); })
      .catch(() => { /* silently ignore if tournaments endpoint not yet running */ })
      .finally(() => setTournamentsLoading(false));
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this competition and all its data?')) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/competitions/${id}`, { method: 'DELETE' });
      if (res.ok) setCompetitions((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const completedCount = competitions.filter((c) => c.state === 'COMPLETE' || c.state === 'SCORED').length;
  const runningCount = competitions.filter((c) => c.state === 'RUNNING').length;
  const uniqueModels = new Set(competitions.flatMap((c) => c.teams?.map((t) => t.model) ?? []));

  const filteredCompetitions = competitions.filter((c) => {
    const stateMatch = stateFilter === 'ALL'
      || (stateFilter === 'LIVE' && c.state === 'RUNNING')
      || (stateFilter === 'COMPLETE' && (c.state === 'COMPLETE' || c.state === 'SCORED'))
      || (stateFilter === 'FAILED' && c.state === 'FAILED')
      || (stateFilter === 'CANCELLED' && c.state === 'CANCELLED');
    const modelMatch = modelFilter === 'ALL'
      || c.teams?.some((t) => t.model.toLowerCase().startsWith(modelFilter));
    if (!stateMatch || !modelMatch) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const title = (c.brief?.title ?? '').toLowerCase();
      const problem = (c.brief?.problem ?? '').toLowerCase();
      if (!title.includes(q) && !problem.includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0e17',
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      color: '#e2e8f0',
    }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes liveBorder {
          0%, 100% { border-color: rgba(249,115,22,0.6); }
          50% { border-color: rgba(249,115,22,0.25); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .arena-card {
          transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
        }
        .arena-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 24px rgba(0,0,0,0.3);
        }
        .delete-btn {
          transition: color 0.15s ease, background 0.15s ease;
        }
        .delete-btn:hover {
          color: #ef4444 !important;
          background: rgba(239,68,68,0.1) !important;
        }
        .replay-link {
          transition: color 0.15s ease;
        }
        .replay-link:hover {
          color: #f97316 !important;
        }
        .nav-link {
          transition: color 0.15s ease, border-color 0.15s ease;
        }
        .nav-link:hover {
          color: #e2e8f0 !important;
          border-color: #2d4060 !important;
        }
        .new-comp-btn {
          transition: background 0.15s ease, transform 0.1s ease;
        }
        .new-comp-btn:hover {
          background: #fb923c !important;
          transform: translateY(-1px);
        }
      `}</style>

      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Hero Header */}
        <div style={{
          marginBottom: '2.5rem',
          padding: '2rem 0',
          borderBottom: '1px solid #1e2d45',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{
                fontSize: '0.6rem',
                color: '#f97316',
                letterSpacing: '4px',
                textTransform: 'uppercase',
                marginBottom: '0.6rem',
                fontWeight: 700,
              }}>
                ◆ Tournament Lobby
              </div>
              <h1 style={{
                fontSize: '2.4rem',
                fontWeight: 800,
                lineHeight: 1.05,
                margin: 0,
                background: 'linear-gradient(135deg, #e2e8f0 0%, #f97316 50%, #a855f7 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                Agent Arena
              </h1>
              {!loading && !error && competitions.length > 0 && (
                <p style={{
                  fontSize: '0.72rem',
                  color: '#8896ab',
                  marginTop: '0.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                }}>
                  <span>{completedCount} battle{completedCount !== 1 ? 's' : ''} completed</span>
                  <span style={{ color: '#1e2d45' }}>·</span>
                  <span>{uniqueModels.size} agent{uniqueModels.size !== 1 ? 's' : ''} competing</span>
                  {runningCount > 0 && (
                    <>
                      <span style={{ color: '#1e2d45' }}>·</span>
                      <span style={{ color: '#f97316', fontWeight: 700 }}>{runningCount} live now</span>
                    </>
                  )}
                </p>
              )}
              {!loading && !error && competitions.length === 0 && (
                <p style={{ fontSize: '0.72rem', color: '#8896ab', marginTop: '0.6rem' }}>
                  AI agent head-to-head competitions
                </p>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.5rem' }}>
              {apiOnline !== null && (
                <span style={{
                  fontSize: '0.6rem', fontFamily: 'monospace', fontWeight: 600,
                  color: apiOnline ? '#22c55e' : '#ef4444',
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  whiteSpace: 'nowrap',
                }}>
                  <span style={{ fontSize: '0.7rem' }}>●</span>
                  {apiOnline ? 'API Online' : 'API Offline'}
                </span>
              )}
              <a
                href="/analytics"
                className="nav-link"
                style={{
                  fontSize: '0.62rem', color: '#8896ab', padding: '0.45rem 0.85rem',
                  border: '1px solid #1e2d45', borderRadius: '4px', textDecoration: 'none',
                  letterSpacing: '1px', fontWeight: 600,
                }}
              >
                📊 ANALYTICS
              </a>
              <Link
                href="/leaderboard"
                className="nav-link"
                style={{
                  fontSize: '0.62rem', color: '#8896ab', padding: '0.45rem 0.85rem',
                  border: '1px solid #1e2d45', borderRadius: '4px', textDecoration: 'none',
                  letterSpacing: '1px', fontWeight: 600,
                }}
              >
                🏆 LEADERBOARD
              </Link>
              <Link
                href="/tournaments/new"
                className="nav-link"
                style={{
                  fontSize: '0.62rem', color: '#8896ab', padding: '0.45rem 0.85rem',
                  border: '1px solid #1e2d45', borderRadius: '4px', textDecoration: 'none',
                  letterSpacing: '1px', fontWeight: 600,
                }}
              >
                🏆 TOURNAMENTS →
              </Link>
              <Link
                href="/competitions/new"
                className="new-comp-btn"
                style={{
                  fontSize: '0.62rem', fontWeight: 700, padding: '0.45rem 1.1rem',
                  background: '#f97316', color: '#0a0e17', borderRadius: '4px',
                  textDecoration: 'none', letterSpacing: '1px', textTransform: 'uppercase',
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                }}
              >
                ⚔️ New Battle
              </Link>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        {competitions.length > 0 && !loading && !error && (
          <div style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {/* Search Input */}
            <div style={{ position: 'relative', width: '100%', marginBottom: '0.25rem' }}>
              <span style={{
                position: 'absolute',
                left: '0.65rem',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '0.8rem',
                pointerEvents: 'none',
                lineHeight: 1,
              }}>🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search competitions..."
                style={{
                  width: '100%',
                  background: '#0a1628',
                  border: '1px solid #1e2d45',
                  borderRadius: '6px',
                  color: '#e2e8f0',
                  fontSize: '0.72rem',
                  fontFamily: 'monospace',
                  padding: '0.5rem 2rem 0.5rem 2rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '0.6rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#8896ab',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    lineHeight: 1,
                    padding: '0.1rem',
                  }}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
            {searchQuery.trim() && (
              <p style={{ fontSize: '0.62rem', color: '#4a5568', margin: '0 0 0.15rem', fontFamily: 'monospace' }}>
                Showing {filteredCompetitions.length} of {competitions.length} competition{competitions.length !== 1 ? 's' : ''}
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.55rem', color: '#4a5568', letterSpacing: '1px', textTransform: 'uppercase', marginRight: '0.2rem', fontWeight: 700 }}>State</span>
              {(['ALL', 'LIVE', 'COMPLETE', 'FAILED', 'CANCELLED'] as const).map((s) => {
                const active = stateFilter === s;
                const style = s === 'ALL' ? { bg: '#1e2d45', color: '#8896ab' } : s === 'LIVE' ? { bg: 'rgba(249,115,22,0.2)', color: '#f97316' } : getStateStyle(s);
                return (
                  <button
                    key={s}
                    onClick={() => setStateFilter(s)}
                    style={{
                      fontSize: '0.52rem', fontWeight: 700, padding: '0.18rem 0.6rem',
                      borderRadius: '3px', letterSpacing: '1px', cursor: 'pointer',
                      border: `1px solid ${active ? 'transparent' : '#1e2d45'}`,
                      background: active ? style.bg : 'transparent',
                      color: active ? style.color : '#4a5568',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.55rem', color: '#4a5568', letterSpacing: '1px', textTransform: 'uppercase', marginRight: '0.2rem', fontWeight: 700 }}>Model</span>
              {(['ALL', 'claude', 'codex', 'gemini'] as const).map((m) => {
                const active = modelFilter === m;
                const color = m === 'ALL' ? '#8896ab' : getModelColor(m);
                return (
                  <button
                    key={m}
                    onClick={() => setModelFilter(m)}
                    style={{
                      fontSize: '0.52rem', fontWeight: 700, padding: '0.18rem 0.6rem',
                      borderRadius: '3px', letterSpacing: '1px', cursor: 'pointer',
                      border: `1px solid ${active ? 'transparent' : '#1e2d45'}`,
                      background: active ? (m === 'ALL' ? '#1e2d45' : `${color}22`) : 'transparent',
                      color: active ? color : '#4a5568',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '4rem 0' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>⚔️</div>
            <p style={{ color: '#8896ab', fontSize: '0.75rem' }}>Loading competitions…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{
            textAlign: 'center', padding: '3rem 2rem',
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: '8px',
          }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>⚠️</div>
            <p style={{ color: '#ef4444', fontSize: '0.75rem' }}>{error}</p>
          </div>
        )}

        {/* Filtered empty state */}
        {!loading && !error && filteredCompetitions.length === 0 && competitions.length > 0 && (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            background: '#111827',
            border: '1px dashed #1e2d45',
            borderRadius: '8px',
            marginBottom: '0.65rem',
          }}>
            <p style={{ fontSize: '0.75rem', color: '#8896ab' }}>No competitions match your filters.</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && competitions.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '5rem 2rem',
            background: '#111827',
            border: '1px dashed #1e2d45',
            borderRadius: '12px',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚔️</div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.5rem' }}>
              No battles yet
            </h2>
            <p style={{ fontSize: '0.75rem', color: '#8896ab', marginBottom: '1.5rem', maxWidth: '360px', margin: '0 auto 1.5rem' }}>
              Pit two AI agents against each other in a head-to-head coding competition.
              Create your first battle to see who comes out on top.
            </p>
            <Link
              href="/competitions/new"
              className="new-comp-btn"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                fontSize: '0.72rem', fontWeight: 700, padding: '0.6rem 1.5rem',
                background: '#f97316', color: '#0a0e17', borderRadius: '6px',
                textDecoration: 'none', letterSpacing: '0.5px',
              }}
            >
              ⚔️ Launch First Battle
            </Link>
          </div>
        )}

        {/* Competition Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {filteredCompetitions.map((comp, index) => {
            const teamA = comp.teams?.[0];
            const teamB = comp.teams?.[1];
            const winnerTeam = comp.teams?.find((t) => t.id === comp.winnerId);
            const fmt = comp.brief?.format ? FORMAT_BADGES[comp.brief.format] : null;
            const isRunning = comp.state === 'RUNNING';
            const isComplete = comp.state === 'COMPLETE' || comp.state === 'SCORED';
            const isFailed = comp.state === 'FAILED';
            const isCancelled = comp.state === 'CANCELLED';
            const isHovered = hoveredId === comp.id;

            return (
              <Link key={comp.id} href={`/competitions/${comp.id}`} style={{ textDecoration: 'none' }}>
                <div
                  className="arena-card"
                  onMouseEnter={() => setHoveredId(comp.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    background: isRunning
                      ? 'linear-gradient(135deg, rgba(249,115,22,0.04) 0%, #111827 100%)'
                      : '#111827',
                    border: `1px solid ${isRunning ? 'rgba(249,115,22,0.5)' : isHovered ? '#2d4060' : '#1e2d45'}`,
                    borderRadius: '8px',
                    padding: '1rem 1.25rem',
                    cursor: 'pointer',
                    animation: isRunning
                      ? 'liveBorder 2s ease-in-out infinite'
                      : `fadeIn 0.3s ease ${index * 0.04}s both`,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* Accent stripe on left for completed with winner */}
                  {winnerTeam && (
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: '3px',
                      background: 'linear-gradient(180deg, #eab308, #f97316)',
                    }} />
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    {/* Left section */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Title row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.45rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.78rem', opacity: 0.7 }}>
                          {isRunning ? '⚔️' : isComplete ? '🏆' : isFailed ? '💥' : isCancelled ? '🚫' : '📋'}
                        </span>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0' }}>
                          {comp.brief?.title ?? comp.id}
                        </span>
                        {fmt && (
                          <span style={{
                            fontSize: '0.52rem', fontWeight: 700, padding: '0.12rem 0.5rem',
                            borderRadius: '3px', letterSpacing: '1.2px',
                            background: fmt.bg, color: fmt.color,
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                          }}>
                            <span style={{ fontSize: '0.6rem' }}>{fmt.icon}</span> {fmt.label}
                          </span>
                        )}
                        {isRunning && (
                          <span style={{
                            fontSize: '0.5rem', fontWeight: 800, padding: '0.1rem 0.45rem',
                            borderRadius: '3px', letterSpacing: '2px',
                            background: 'rgba(249,115,22,0.2)', color: '#f97316',
                            animation: 'pulse 1.5s ease-in-out infinite',
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                          }}>
                            <span style={{
                              display: 'inline-block',
                              width: '5px',
                              height: '5px',
                              borderRadius: '50%',
                              background: '#f97316',
                              animation: 'pulse 1s ease-in-out infinite',
                            }} />
                            LIVE
                          </span>
                        )}
                      </div>

                      {/* Matchup row */}
                      <div style={{ fontSize: '0.67rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', paddingLeft: '1.6rem' }}>
                        {teamA && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                            padding: '0.1rem 0.5rem', borderRadius: '3px',
                            background: `${teamColor(teamA)}12`,
                            border: `1px solid ${teamColor(teamA)}33`,
                            color: teamColor(teamA), fontWeight: 600, fontSize: '0.62rem',
                          }}>
                            {teamLabel(teamA)}
                          </span>
                        )}
                        {teamA && teamB && (
                          <span style={{ color: '#4a5568', fontSize: '0.6rem', fontWeight: 700 }}>VS</span>
                        )}
                        {teamB && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                            padding: '0.1rem 0.5rem', borderRadius: '3px',
                            background: `${teamColor(teamB)}12`,
                            border: `1px solid ${teamColor(teamB)}33`,
                            color: teamColor(teamB), fontWeight: 600, fontSize: '0.62rem',
                          }}>
                            {teamLabel(teamB)}
                          </span>
                        )}
                        {winnerTeam && (
                          <>
                            <span style={{ color: '#2d3748' }}>·</span>
                            <span style={{
                              color: '#eab308', fontSize: '0.6rem', fontWeight: 700,
                              display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                            }}>
                              🏆 {teamLabel(winnerTeam)} wins
                            </span>
                          </>
                        )}
                        {comp.brief?.timeLimitMs != null && (
                          <>
                            <span style={{ color: '#2d3748' }}>·</span>
                            <span style={{ color: '#4a5568', fontSize: '0.6rem' }}>
                              ⏱ {formatTimeLimit(comp.brief.timeLimitMs)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right section */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexShrink: 0 }}>
                      {(comp.startedAt || comp.completedAt) && (
                        <span style={{ fontSize: '0.58rem', color: '#4a5568', whiteSpace: 'nowrap' }}>
                          {timeAgo(comp.completedAt ?? comp.startedAt)}
                        </span>
                      )}

                      {/* State badge */}
                      {(() => {
                        const s = getStateStyle(comp.state);
                        return (
                          <span style={{
                            fontSize: '0.52rem', fontWeight: 700, padding: '0.14rem 0.55rem',
                            borderRadius: '3px', letterSpacing: '1.5px',
                            background: s.bg, color: s.color,
                            whiteSpace: 'nowrap',
                          }}>
                            {comp.state}
                          </span>
                        );
                      })()}

                      {comp.state === 'COMPLETE' && (
                        <a
                          href={`/competitions/${comp.id}/replay`}
                          onClick={(e) => e.stopPropagation()}
                          className="replay-link"
                          style={{
                            fontSize: '0.58rem', color: '#8896ab', textDecoration: 'none',
                            letterSpacing: '0.5px', whiteSpace: 'nowrap',
                          }}
                        >
                          ▶ REPLAY
                        </a>
                      )}

                      {comp.state !== 'RUNNING' && (
                        <button
                          onClick={(e) => handleDelete(e, comp.id)}
                          disabled={deleting === comp.id}
                          className="delete-btn"
                          style={{
                            fontSize: '0.65rem', color: '#2d4060', background: 'none', border: 'none',
                            cursor: 'pointer', padding: '0.15rem 0.3rem', borderRadius: '3px',
                            opacity: deleting === comp.id ? 0.4 : 1,
                          }}
                        >
                          {deleting === comp.id ? '…' : '✕'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Tournaments Section */}
        <div style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid #1e2d45' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.58rem', color: '#f97316', letterSpacing: '3px', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.3rem' }}>
                ◆ Tournaments
              </div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: '#e2e8f0' }}>
                Round-Robin Tournaments
              </h2>
            </div>
            <Link
              href="/tournaments/new"
              className="new-comp-btn"
              style={{
                fontSize: '0.6rem', fontWeight: 700, padding: '0.4rem 0.9rem',
                background: '#f97316', color: '#0a0e17', borderRadius: '4px',
                textDecoration: 'none', letterSpacing: '1px', textTransform: 'uppercase',
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
              }}
            >
              🏆 New Tournament
            </Link>
          </div>

          {tournamentsLoading && (
            <p style={{ fontSize: '0.72rem', color: '#8896ab' }}>Loading tournaments…</p>
          )}

          {!tournamentsLoading && tournaments.length === 0 && (
            <div style={{
              padding: '2.5rem', textAlign: 'center',
              background: '#111827', border: '1px dashed #1e2d45', borderRadius: '8px',
            }}>
              <p style={{ fontSize: '0.72rem', color: '#4a5568', margin: 0 }}>
                No tournaments yet — start a round-robin to compare multiple agents head-to-head.
              </p>
            </div>
          )}

          {!tournamentsLoading && tournaments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {tournaments.map((t, index) => {
                const s = getStateStyle(t.state);
                const isRunning = t.state === 'RUNNING' || t.state === 'PENDING';
                return (
                  <Link key={t.id} href={`/tournaments/${t.id}`} style={{ textDecoration: 'none' }}>
                    <div
                      className="arena-card"
                      style={{
                        background: '#111827',
                        border: `1px solid ${isRunning ? 'rgba(249,115,22,0.4)' : '#1e2d45'}`,
                        borderRadius: '8px',
                        padding: '0.85rem 1.1rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
                        animation: `fadeIn 0.3s ease ${index * 0.04}s both`,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#e2e8f0', marginBottom: '0.3rem' }}>
                          {t.name || t.brief?.title || t.id}
                        </div>
                        <div style={{ fontSize: '0.62rem', color: '#8896ab', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span>{t.teams.length} teams</span>
                          <span style={{ color: '#1e2d45' }}>·</span>
                          <span>{t.matchIds.length} match{t.matchIds.length !== 1 ? 'es' : ''}</span>
                          <span style={{ color: '#1e2d45' }}>·</span>
                          <span>{t.teams.slice(0, 3).join(', ')}{t.teams.length > 3 ? ` +${t.teams.length - 3}` : ''}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexShrink: 0 }}>
                        <span style={{
                          fontSize: '0.52rem', fontWeight: 700, padding: '0.14rem 0.55rem',
                          borderRadius: '3px', letterSpacing: '1.5px',
                          background: s.bg, color: s.color,
                        }}>
                          {t.state}
                        </span>
                        <span style={{ fontSize: '0.6rem', color: '#8896ab' }}>View →</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
