'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getModelColor, getStateStyle, FORMAT_BADGES, MONOSPACE_FONT, HOVER_DARK, HOVER_TEXT, KICKER_STYLE } from '../lib/design-tokens';
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
  brief: { id?: string; title: string; format?: string; timeLimitMs?: number; problem?: string; tags?: string[] };
  teams: Team[];
  winnerId: string | null;
  notes?: string | null;
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
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
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
      .then((data: CompetitionSummary[]) => { setCompetitions(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setError('Failed to load competitions — is the API server running?'); setLoading(false); });
  }, []);

  // Auto-refresh competitions list every 10 seconds while tab is visible
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/competitions')
        .then((r) => r.json())
        .then((data: CompetitionSummary[]) => setCompetitions(Array.isArray(data) ? data : []))
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

  const availableCategories = Array.from(
    new Set(competitions.flatMap((c) => c.brief?.tags ?? []))
  ).sort();

  const filteredCompetitions = competitions.filter((c) => {
    const stateMatch = stateFilter === 'ALL'
      || (stateFilter === 'LIVE' && c.state === 'RUNNING')
      || (stateFilter === 'COMPLETE' && (c.state === 'COMPLETE' || c.state === 'SCORED'))
      || (stateFilter === 'FAILED' && c.state === 'FAILED')
      || (stateFilter === 'CANCELLED' && c.state === 'CANCELLED');
    const modelMatch = modelFilter === 'ALL'
      || c.teams?.some((t) => t.model.toLowerCase().startsWith(modelFilter));
    const categoryMatch = categoryFilter === 'ALL'
      || c.brief?.tags?.includes(categoryFilter);
    if (!stateMatch || !modelMatch || !categoryMatch) return false;
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
      background: '#000408',
      fontFamily: MONOSPACE_FONT,
      color: '#c8eef8',
    }}>
      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Hero Header */}
        <div style={{
          marginBottom: '2rem',
          padding: '1.5rem 0',
          borderBottom: '1px solid #0a2235',
        }}>
          {/* Single flex row: [label+title+stats] [nav] */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2rem' }}>

            {/* Left: label, title, stats */}
            <div>
              <div style={{ ...KICKER_STYLE, color: '#00f0ff', marginBottom: '0.35rem' }}>
                ◆ Tournament Lobby
              </div>
              <h1 style={{
                fontSize: '2rem', fontWeight: 800, lineHeight: 1, margin: 0,
                background: 'linear-gradient(135deg, #c8eef8 0%, #00f0ff 50%, #0080ff 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                fontFamily: MONOSPACE_FONT,
              }}>
                Arena4Ai
              </h1>
              <div style={{
                marginTop: '0.4rem', fontSize: '0.65rem', color: '#4a8fa8',
                display: 'flex', alignItems: 'center', gap: '0.45rem',
              }}>
                {!loading && !error && competitions.length > 0 ? (
                  <>
                    <span>{completedCount} battle{completedCount !== 1 ? 's' : ''} completed</span>
                    <span style={{ color: '#0e3050' }}>·</span>
                    <span>{uniqueModels.size} agent{uniqueModels.size !== 1 ? 's' : ''} competing</span>
                    {runningCount > 0 && (
                      <>
                        <span style={{ color: '#0e3050' }}>·</span>
                        <span style={{ color: '#00f0ff', fontWeight: 700 }}>{runningCount} live</span>
                      </>
                    )}
                  </>
                ) : (
                  <span>AI agent competitions</span>
                )}
                {apiOnline !== null && (
                  <>
                    <span style={{ color: '#0e3050' }}>·</span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                      color: apiOnline ? '#22c55e' : '#ef4444', fontWeight: 600,
                    }}>
                      <span>●</span>
                      {apiOnline ? 'API online' : 'API offline'}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Right: nav */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0 }}>
              {([
                { href: '/briefs', label: 'Briefs' },
                { href: '/analytics', label: 'Analytics' },
                { href: '/compare', label: 'Compare' },
                { href: '/leaderboard', label: 'Leaderboard' },
                { href: '/personas', label: 'Personas' },
                { href: '/tournaments/new', label: 'Tournaments' },
              ] as const).map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="nav-link"
                  style={{
                    fontSize: '0.65rem', color: '#7cc6db', padding: '0.45rem 0.85rem',
                    border: '1px solid #0a2235', borderRadius: '5px', textDecoration: 'none',
                    fontWeight: 600, whiteSpace: 'nowrap',
                    display: 'inline-flex', alignItems: 'center',
                  }}
                >
                  {label}
                </Link>
              ))}
              <Link
                href="/competitions/new"
                className="new-comp-btn"
                style={{
                  fontSize: '0.7rem', fontWeight: 700, padding: '0.45rem 1.1rem',
                  background: '#00f0ff', color: '#000408', borderRadius: '5px',
                  textDecoration: 'none', display: 'inline-flex', alignItems: 'center',
                  gap: '0.3rem', whiteSpace: 'nowrap',
                }}
              >
                ⚔ New Battle
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
                  background: '#010810',
                  border: '1px solid #0a2235',
                  borderRadius: '6px',
                  color: '#c8eef8',
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
                    color: '#4a8fa8',
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
              <p style={{ fontSize: '0.62rem', color: '#1e4a5a', margin: '0 0 0.15rem', fontFamily: 'monospace' }}>
                Showing {filteredCompetitions.length} of {competitions.length} competition{competitions.length !== 1 ? 's' : ''}
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.55rem', color: '#1e4a5a', letterSpacing: '1px', textTransform: 'uppercase', marginRight: '0.2rem', fontWeight: 700 }}>State</span>
              {(['ALL', 'LIVE', 'COMPLETE', 'FAILED', 'CANCELLED'] as const).map((s) => {
                const active = stateFilter === s;
                const style = s === 'ALL' ? { bg: '#0a2235', color: '#4a8fa8' } : s === 'LIVE' ? { bg: 'rgba(0,240,255,0.2)', color: '#00f0ff' } : getStateStyle(s);
                return (
                  <button
                    key={s}
                    onClick={() => setStateFilter(s)}
                    style={{
                      fontSize: '0.52rem', fontWeight: 700, padding: '0.18rem 0.6rem',
                      borderRadius: '3px', letterSpacing: '1px', cursor: 'pointer',
                      border: `1px solid ${active ? 'transparent' : '#0a2235'}`,
                      background: active ? style.bg : 'transparent',
                      color: active ? style.color : '#1e4a5a',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.55rem', color: '#1e4a5a', letterSpacing: '1px', textTransform: 'uppercase', marginRight: '0.2rem', fontWeight: 700 }}>Model</span>
              {(['ALL', 'claude', 'codex', 'gemini'] as const).map((m) => {
                const active = modelFilter === m;
                const color = m === 'ALL' ? '#4a8fa8' : getModelColor(m);
                return (
                  <button
                    key={m}
                    onClick={() => setModelFilter(m)}
                    style={{
                      fontSize: '0.52rem', fontWeight: 700, padding: '0.18rem 0.6rem',
                      borderRadius: '3px', letterSpacing: '1px', cursor: 'pointer',
                      border: `1px solid ${active ? 'transparent' : '#0a2235'}`,
                      background: active ? (m === 'ALL' ? '#0a2235' : `${color}22`) : 'transparent',
                      color: active ? color : '#1e4a5a',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            {availableCategories.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.55rem', color: '#1e4a5a', letterSpacing: '1px', textTransform: 'uppercase', marginRight: '0.2rem', fontWeight: 700 }}>Category</span>
                {(['ALL', ...availableCategories]).map((cat) => {
                  const active = categoryFilter === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      style={{
                        fontSize: '0.52rem', fontWeight: 700, padding: '0.18rem 0.6rem',
                        borderRadius: '3px', letterSpacing: '1px', cursor: 'pointer',
                        border: `1px solid ${active ? 'rgba(0,128,255,0.4)' : '#0a2235'}`,
                        background: active ? 'rgba(0,128,255,0.15)' : 'transparent',
                        color: active ? '#7cc6db' : '#1e4a5a',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '4rem 0' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>⚔️</div>
            <p style={{ color: '#4a8fa8', fontSize: '0.75rem' }}>Loading competitions…</p>
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
            background: '#050f1e',
            border: '1px dashed #0a2235',
            borderRadius: '8px',
            marginBottom: '0.65rem',
          }}>
            <p style={{ fontSize: '0.75rem', color: '#4a8fa8' }}>No competitions match your filters.</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && competitions.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '5rem 2rem',
            background: '#050f1e',
            border: '1px dashed #0a2235',
            borderRadius: '12px',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚔️</div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#c8eef8', marginBottom: '0.5rem' }}>
              No battles yet
            </h2>
            <p style={{ fontSize: '0.75rem', color: '#4a8fa8', marginBottom: '1.5rem', maxWidth: '360px', margin: '0 auto 1.5rem' }}>
              Pit two AI agents against each other in a head-to-head coding competition.
              Create your first battle to see who comes out on top.
            </p>
            <Link
              href="/competitions/new"
              className="new-comp-btn"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                fontSize: '0.72rem', fontWeight: 700, padding: '0.6rem 1.5rem',
                background: '#00f0ff', color: '#000408', borderRadius: '6px',
                textDecoration: 'none', letterSpacing: '0.5px',
              }}
            >
              ⚔️ Launch First Battle
            </Link>
          </div>
        )}

        {/* Competition Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {(() => {
            const briefRunCounts = new Map<string, number>();
            for (const c of competitions) {
              const bid = c.brief?.id;
              if (bid) briefRunCounts.set(bid, (briefRunCounts.get(bid) ?? 0) + 1);
            }
            return filteredCompetitions.map((comp, index) => {
            const teamA = comp.teams?.[0];
            const teamB = comp.teams?.[1];
            const winnerTeam = comp.teams?.find((t) => t.id === comp.winnerId);
            const fmt = comp.brief?.format ? FORMAT_BADGES[comp.brief.format] : null;
            const isRunning = comp.state === 'RUNNING';
            const isComplete = comp.state === 'COMPLETE' || comp.state === 'SCORED';
            const isFailed = comp.state === 'FAILED';
            const isCancelled = comp.state === 'CANCELLED';
            const isHovered = hoveredId === comp.id;
            const briefRunCount = comp.brief?.id ? (briefRunCounts.get(comp.brief.id) ?? 0) : 0;

            return (
              <Link key={comp.id} href={`/competitions/${comp.id}`} style={{ textDecoration: 'none' }}>
                <div
                  className="arena-card"
                  onMouseEnter={() => setHoveredId(comp.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    background: isRunning
                      ? 'linear-gradient(135deg, rgba(0,240,255,0.04) 0%, #050f1e 100%)'
                      : '#050f1e',
                    border: `1px solid ${isRunning ? 'rgba(0,240,255,0.5)' : isHovered ? '#0e3050' : '#0a2235'}`,
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
                      background: 'linear-gradient(180deg, #00f0ff, #0080ff)',
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
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#c8eef8' }}>
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
                        {comp.brief?.tags?.[0] && (
                          <span style={{
                            fontSize: '0.5rem', fontWeight: 700, padding: '0.1rem 0.45rem',
                            borderRadius: '3px', letterSpacing: '1px',
                            background: 'rgba(0,128,255,0.15)', color: '#7cc6db',
                            border: '1px solid rgba(0,128,255,0.2)',
                          }}>
                            {comp.brief.tags[0]}
                          </span>
                        )}
                        {isRunning && (
                          <span style={{
                            fontSize: '0.5rem', fontWeight: 800, padding: '0.1rem 0.45rem',
                            borderRadius: '3px', letterSpacing: '2px', textTransform: 'uppercase',
                            background: 'rgba(0,240,255,0.2)', color: '#00f0ff',
                            animation: 'pulse 1.5s ease-in-out infinite',
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                          }}>
                            <span style={{
                              display: 'inline-block',
                              width: '5px',
                              height: '5px',
                              borderRadius: '50%',
                              background: '#00f0ff',
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
                          <span style={{ color: '#1e4a5a', fontSize: '0.6rem', fontWeight: 700 }}>VS</span>
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
                            <span style={{ color: '#0a2235' }}>·</span>
                            <span style={{
                              color: '#00f0ff', fontSize: '0.6rem', fontWeight: 700,
                              display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                            }}>
                              🏆 {teamLabel(winnerTeam)} wins
                            </span>
                          </>
                        )}
                        {comp.brief?.timeLimitMs != null && (
                          <>
                            <span style={{ color: '#0a2235' }}>·</span>
                            <span style={{ color: '#1e4a5a', fontSize: '0.6rem' }}>
                              ⏱ {formatTimeLimit(comp.brief.timeLimitMs)}
                            </span>
                          </>
                        )}
                        {briefRunCount > 1 && comp.brief?.id && (
                          <>
                            <span style={{ color: '#0a2235' }}>·</span>
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/briefs/${comp.brief!.id}/runs`; }}
                              style={{
                                fontSize: '0.58rem', color: '#7cc6db', background: 'none', border: 'none',
                                cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: 600,
                              }}
                            >
                              📊 {briefRunCount} runs
                            </button>
                          </>
                        )}
                      </div>
                      {comp.notes && (
                        <div style={{ paddingLeft: '1.6rem', marginTop: '0.3rem' }}>
                          <span style={{ fontSize: '0.6rem', color: '#3d7d94', fontStyle: 'italic' }}>
                            {comp.notes}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right section */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexShrink: 0 }}>
                      {(comp.startedAt || comp.completedAt) && (
                        <span style={{ fontSize: '0.58rem', color: '#1e4a5a', whiteSpace: 'nowrap' }}>
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
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/competitions/${comp.id}/replay`; }}
                          className="replay-link"
                          style={{
                            fontSize: '0.58rem', color: '#4a8fa8', background: 'none', border: 'none',
                            cursor: 'pointer', padding: 0, letterSpacing: '0.5px', whiteSpace: 'nowrap',
                            fontFamily: 'inherit',
                          }}
                        >
                          ▶ REPLAY
                        </button>
                      )}

                      {comp.state !== 'RUNNING' && (
                        <button
                          onClick={(e) => handleDelete(e, comp.id)}
                          disabled={deleting === comp.id}
                          className="delete-btn"
                          style={{
                            fontSize: '0.65rem', color: '#0e3050', background: 'none', border: 'none',
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
          });
          })()}
        </div>

        {/* Tournaments Section */}
        <div style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid #0a2235' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <div style={{ ...KICKER_STYLE, color: '#00f0ff', marginBottom: '0.3rem' }}>
                ◆ Tournaments
              </div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: '#c8eef8' }}>
                Round-Robin Tournaments
              </h2>
            </div>
            <Link
              href="/tournaments/new"
              className="new-comp-btn"
              style={{
                fontSize: '0.6rem', fontWeight: 700, padding: '0.4rem 0.9rem',
                background: '#00f0ff', color: '#000408', borderRadius: '4px',
                textDecoration: 'none', letterSpacing: '1px', textTransform: 'uppercase',
                display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
              }}
            >
              🏆 New Tournament
            </Link>
          </div>

          {tournamentsLoading && (
            <p style={{ fontSize: '0.72rem', color: '#4a8fa8' }}>Loading tournaments…</p>
          )}

          {!tournamentsLoading && tournaments.length === 0 && (
            <div style={{
              padding: '2.5rem', textAlign: 'center',
              background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '8px',
            }}>
              <p style={{ fontSize: '0.72rem', color: '#1e4a5a', margin: 0 }}>
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
                        background: '#050f1e',
                        border: `1px solid ${isRunning ? 'rgba(0,240,255,0.4)' : '#0a2235'}`,
                        borderRadius: '8px',
                        padding: '0.85rem 1.1rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
                        animation: `fadeIn 0.3s ease ${index * 0.04}s both`,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#c8eef8', marginBottom: '0.3rem' }}>
                          {t.name || t.brief?.title || t.id}
                        </div>
                        <div style={{ fontSize: '0.62rem', color: '#4a8fa8', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span>{t.teams.length} teams</span>
                          <span style={{ color: '#0a2235' }}>·</span>
                          <span>{t.matchIds.length} match{t.matchIds.length !== 1 ? 'es' : ''}</span>
                          <span style={{ color: '#0a2235' }}>·</span>
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
                        <span style={{ fontSize: '0.6rem', color: '#4a8fa8' }}>View →</span>
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
