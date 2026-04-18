'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getModelColor, getStateStyle, FORMAT_BADGES, MONOSPACE_FONT, HOVER_DARK, HOVER_TEXT, KICKER_STYLE, BODY_FONT, BODY_FONT_SIZE, BODY_FONT_SIZE_SM } from '../lib/design-tokens';
import { formatTimeLimit, resolveTeamLabel } from '../lib/format';

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
  scorecards?: Array<{ teamId: string; finalScore?: number }> | null;
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

function teamColor(t: Team): string {
  return getModelColor(t.model);
}

export default function GalleryPage() {
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [everLoaded, setEverLoaded] = useState(false);
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

  // Fetch competitions on mount — retry once on failure before showing error
  useEffect(() => {
    let cancelled = false;
    const doFetch = (attempt: number) => {
      fetch('/api/competitions', { cache: 'no-store' })
        .then((r) => r.json())
        .then((data: CompetitionSummary[]) => {
          if (cancelled) return;
          if (Array.isArray(data)) { setCompetitions(data); setLoading(false); setEverLoaded(true); }
          else if (attempt < 2) { setTimeout(() => doFetch(attempt + 1), 2000); }
          else { setLoading(false); }
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 2) { setTimeout(() => doFetch(attempt + 1), 2000); }
          else { setError('Failed to load competitions — is the API server running?'); setLoading(false); }
        });
    };
    doFetch(0);
    return () => { cancelled = true; };
  }, []);

  // Auto-refresh competitions list every 10 seconds while tab is visible
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/competitions', { cache: 'no-store' })
        .then((r) => r.json())
        .then((data: CompetitionSummary[]) => { if (Array.isArray(data)) setCompetitions(data); })
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
      fontFamily: MONOSPACE_FONT,
      color: '#c8eef8',
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2.5rem 2rem' }}>

        {/* Hero Header */}
        <div style={{
          marginBottom: '2.5rem',
          padding: '2rem 0 1.75rem',
          borderBottom: '1px solid #0a2235',
        }}>
          <h1 style={{
            fontSize: '3rem', fontWeight: 900, lineHeight: 0.95, margin: 0,
            background: 'linear-gradient(135deg, #c8eef8 0%, #00f0ff 50%, #0080ff 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            fontFamily: MONOSPACE_FONT,
            letterSpacing: '0.5px',
          }}>
            Competition Gallery
          </h1>
          <p style={{
            margin: '0.85rem 0 0', fontFamily: BODY_FONT, fontSize: '0.85rem',
            color: '#7cc6db', maxWidth: '62ch', lineHeight: 1.55,
          }}>
            Two agents enter. A cross-judge scores their work. Watch them think in real time.
          </p>
          <div style={{
            marginTop: '1.1rem', fontSize: '0.72rem', fontFamily: BODY_FONT, color: '#4a8fa8',
            display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap',
          }}>
            {!loading && !error && competitions.length > 0 && (
              <>
                <span>{completedCount} battle{completedCount !== 1 ? 's' : ''} completed</span>
                <span style={{ color: '#1e4a5a' }}>·</span>
                <span>{uniqueModels.size} agent{uniqueModels.size !== 1 ? 's' : ''} competing</span>
                {runningCount > 0 && (
                  <>
                    <span style={{ color: '#1e4a5a' }}>·</span>
                    <span style={{ color: '#00f0ff', fontWeight: 700 }}>{runningCount} live</span>
                  </>
                )}
              </>
            )}
            {apiOnline !== null && (
              <>
                {!loading && !error && competitions.length > 0 && (
                  <span style={{ color: '#1e4a5a' }}>·</span>
                )}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  color: apiOnline ? '#22c55e' : '#ef4444', fontWeight: 600,
                }}>
                  <span>●</span>
                  {apiOnline ? 'API online' : 'API offline'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Filter Toolbar — single horizontal row */}
        {competitions.length > 0 && !loading && !error && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
            }}>
              {/* Search */}
              <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
                <span style={{
                  position: 'absolute', left: '0.7rem', top: '50%',
                  transform: 'translateY(-50%)', fontSize: '0.72rem',
                  color: '#3d7d94', pointerEvents: 'none', lineHeight: 1,
                }}>◆</span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search competitions…"
                  style={{
                    width: '100%',
                    background: '#010810',
                    border: '1px solid #0a2235',
                    borderRadius: '6px',
                    color: '#c8eef8',
                    fontSize: '0.75rem',
                    fontFamily: MONOSPACE_FONT,
                    padding: '0.55rem 2rem 0.55rem 2rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                    letterSpacing: '0.5px',
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute', right: '0.65rem', top: '50%',
                      transform: 'translateY(-50%)', background: 'none', border: 'none',
                      color: '#4a8fa8', cursor: 'pointer', fontSize: '0.8rem',
                      lineHeight: 1, padding: '0.15rem',
                    }}
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* State — segmented */}
              <div style={{
                display: 'flex', gap: '2px',
                background: '#010810', border: '1px solid #0a2235',
                borderRadius: '6px', padding: '2px',
              }}>
                {(['ALL', 'LIVE', 'COMPLETE', 'FAILED', 'CANCELLED'] as const).map((s) => {
                  const active = stateFilter === s;
                  const style = s === 'ALL' ? { bg: '#0a2235', color: '#7cc6db' }
                    : s === 'LIVE' ? { bg: 'rgba(0,240,255,0.18)', color: '#00f0ff' }
                    : getStateStyle(s);
                  return (
                    <button
                      key={s}
                      onClick={() => setStateFilter(s)}
                      style={{
                        fontSize: '0.65rem', fontWeight: 700, padding: '0.4rem 0.7rem',
                        borderRadius: '4px', letterSpacing: '1px', cursor: 'pointer',
                        border: 'none',
                        background: active ? style.bg : 'transparent',
                        color: active ? style.color : '#3d7d94',
                        transition: 'all 0.15s ease',
                        fontFamily: MONOSPACE_FONT,
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>

              {/* Model — select */}
              <select
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                style={{
                  background: '#010810', border: '1px solid #0a2235', borderRadius: '6px',
                  color: modelFilter === 'ALL' ? '#7cc6db' : getModelColor(modelFilter),
                  fontSize: '0.65rem', fontFamily: MONOSPACE_FONT,
                  padding: '0.5rem 0.75rem', letterSpacing: '1px', fontWeight: 700,
                  cursor: 'pointer', outline: 'none',
                }}
              >
                <option value="ALL">MODEL · ALL</option>
                <option value="claude">MODEL · CLAUDE</option>
                <option value="codex">MODEL · CODEX</option>
                <option value="gemini">MODEL · GEMINI</option>
              </select>

              {/* Category — select, only when categories exist */}
              {availableCategories.length > 0 && (
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={{
                    background: '#010810', border: '1px solid #0a2235', borderRadius: '6px',
                    color: categoryFilter === 'ALL' ? '#7cc6db' : '#7cc6db',
                    fontSize: '0.65rem', fontFamily: MONOSPACE_FONT,
                    padding: '0.5rem 0.75rem', letterSpacing: '1px', fontWeight: 700,
                    cursor: 'pointer', outline: 'none',
                  }}
                >
                  <option value="ALL">CATEGORY · ALL</option>
                  {availableCategories.map((cat) => (
                    <option key={cat} value={cat}>{cat.toUpperCase()}</option>
                  ))}
                </select>
              )}
            </div>

            {searchQuery.trim() && (
              <p style={{
                fontSize: '0.7rem', color: '#3d7d94',
                margin: '0.55rem 0 0', fontFamily: BODY_FONT,
              }}>
                Showing {filteredCompetitions.length} of {competitions.length} competition{competitions.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        {/* Loading — 3 skeleton rows */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  background: '#050f1e',
                  border: '1px solid #0a2235',
                  borderRadius: '8px',
                  padding: '1.35rem 1.5rem',
                  opacity: 0.4,
                  animation: `pulse 1.6s ease-in-out ${i * 0.2}s infinite`,
                }}
              >
                <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '0.55rem' }}>
                  <div style={{ height: '0.95rem', width: '12rem', background: '#0a2235', borderRadius: '3px' }} />
                  <div style={{ height: '0.95rem', width: '3.5rem', background: '#0a2235', borderRadius: '3px' }} />
                  <div style={{ height: '0.95rem', width: '4rem', background: '#0a2235', borderRadius: '3px' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.55rem' }}>
                  <div style={{ height: '0.7rem', width: '7rem', background: '#0a2235', borderRadius: '3px' }} />
                  <div style={{ height: '0.7rem', width: '1.5rem', background: '#0a2235', borderRadius: '3px' }} />
                  <div style={{ height: '0.7rem', width: '7rem', background: '#0a2235', borderRadius: '3px' }} />
                </div>
              </div>
            ))}
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

        {/* Empty State — onboarding with 3 example briefs */}
        {!loading && !error && everLoaded && competitions.length === 0 && (
          <div style={{
            padding: '3rem 2rem',
            background: 'linear-gradient(135deg, rgba(0,240,255,0.03) 0%, #050f1e 100%)',
            border: '1px dashed #0e3050',
            borderRadius: '12px',
          }}>
            <div style={{ textAlign: 'center', marginBottom: '2.25rem' }}>
              <h2 style={{
                fontFamily: MONOSPACE_FONT,
                fontSize: '1.4rem', fontWeight: 900, color: '#c8eef8',
                margin: '0 0 0.5rem', letterSpacing: '0.5px',
              }}>
                Launch your first battle
              </h2>
              <p style={{
                fontFamily: BODY_FONT, fontSize: '0.8rem',
                color: '#7cc6db', margin: 0, lineHeight: 1.5,
              }}>
                Pick a brief, add two agents, watch them race.
              </p>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '0.9rem',
              marginBottom: '1.75rem',
            }}>
              {[
                { slug: 'fizzbuzz-cli-001', title: 'FizzBuzz CLI', blurb: 'Classic interview warm-up. Fast, deterministic, easy to score.', kind: 'ALGO' },
                { slug: 'roman-numerals', title: 'Roman Numerals', blurb: 'Bidirectional converter with edge-case handling.', kind: 'ALGO' },
                { slug: 'debate-championship-001', title: 'Debate Championship', blurb: 'UBI pro vs. con — tests reasoning, not code.', kind: 'WRITING' },
              ].map((b) => (
                <Link
                  key={b.slug}
                  href={`/competitions/new?briefSlug=${b.slug}`}
                  style={{ textDecoration: 'none' }}
                >
                  <div style={{
                    background: '#050f1e',
                    border: '1px solid #0a2235',
                    borderRadius: '8px',
                    padding: '1.1rem 1.2rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    height: '100%',
                    display: 'flex', flexDirection: 'column', gap: '0.5rem',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0e3050'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#0a2235'; }}
                  >
                    <div style={{
                      fontSize: '0.6rem', fontWeight: 800, letterSpacing: '2px',
                      color: '#3d7d94', textTransform: 'uppercase',
                    }}>{b.kind}</div>
                    <div style={{
                      fontSize: '0.95rem', fontWeight: 700, color: '#c8eef8',
                      letterSpacing: '0.3px',
                    }}>{b.title}</div>
                    <div style={{
                      fontFamily: BODY_FONT, fontSize: '0.72rem',
                      color: '#7cc6db', lineHeight: 1.5, flex: 1,
                    }}>{b.blurb}</div>
                    <div style={{
                      fontSize: '0.65rem', fontWeight: 700, color: '#00f0ff',
                      letterSpacing: '1px', marginTop: '0.25rem',
                    }}>▸ LAUNCH →</div>
                  </div>
                </Link>
              ))}
            </div>

            <div style={{ textAlign: 'center' }}>
              <Link
                href="/competitions/new"
                className="arena-btn arena-btn-primary new-comp-btn"
              >
                ⚔ Build a custom brief
              </Link>
            </div>
          </div>
        )}

        {/* Active Tournaments rail — only when there are running/pending tournaments */}
        {(() => {
          const active = tournaments.filter((t) => t.state === 'RUNNING' || t.state === 'PENDING');
          if (active.length === 0) return null;
          return (
            <div style={{
              marginBottom: '1.25rem',
              padding: '0.85rem 1rem',
              background: 'linear-gradient(90deg, rgba(0,240,255,0.04) 0%, #050f1e 100%)',
              border: '1px solid rgba(0,240,255,0.2)',
              borderRadius: '8px',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.55rem',
                marginBottom: '0.65rem',
              }}>
                <span style={{
                  fontSize: '0.62rem', fontWeight: 800, letterSpacing: '2px',
                  color: '#00f0ff', textTransform: 'uppercase',
                }}>◆ Active Tournaments</span>
                <span style={{ color: '#1e4a5a' }}>·</span>
                <span style={{ fontSize: '0.7rem', color: '#4a8fa8', fontFamily: BODY_FONT }}>
                  {active.length} running
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                {active.map((t) => (
                  <Link key={t.id} href={`/tournaments/${t.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.55rem',
                      padding: '0.45rem 0.75rem',
                      background: '#050f1e',
                      border: '1px solid rgba(0,240,255,0.3)',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      transition: 'all 0.15s ease',
                      cursor: 'pointer',
                    }}>
                      <span style={{
                        display: 'inline-block',
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: '#00f0ff',
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }} />
                      <span style={{ color: '#c8eef8', fontWeight: 700 }}>
                        {t.name || t.brief?.title || t.id}
                      </span>
                      <span style={{ color: '#1e4a5a' }}>·</span>
                      <span style={{ color: '#7cc6db' }}>
                        {t.teams.length} teams · {t.matchIds.length} matches
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Competition Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
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
                    padding: '1.35rem 1.5rem',
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.55rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#c8eef8', letterSpacing: '0.3px' }}>
                          {comp.brief?.title ?? comp.id}
                        </span>
                        {fmt && (
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '0.18rem 0.55rem',
                            borderRadius: '3px', letterSpacing: '1px',
                            background: fmt.bg, color: fmt.color,
                          }}>
                            {fmt.label}
                          </span>
                        )}
                        {comp.brief?.tags?.[0] && (
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '0.18rem 0.55rem',
                            borderRadius: '3px', letterSpacing: '1px',
                            background: 'rgba(0,128,255,0.15)', color: '#7cc6db',
                            border: '1px solid rgba(0,128,255,0.2)',
                          }}>
                            {comp.brief.tags[0]}
                          </span>
                        )}
                        {isRunning && (
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 800, padding: '0.18rem 0.55rem',
                            borderRadius: '3px', letterSpacing: '1.5px', textTransform: 'uppercase',
                            background: 'rgba(0,240,255,0.2)', color: '#00f0ff',
                            animation: 'pulse 1.5s ease-in-out infinite',
                            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
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
                      <div style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                        {teamA && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center',
                            padding: '0.2rem 0.55rem', borderRadius: '3px',
                            background: `${teamColor(teamA)}12`,
                            border: `1px solid ${teamColor(teamA)}33`,
                            color: teamColor(teamA), fontWeight: 600, fontSize: '0.7rem',
                          }}>
                            {resolveTeamLabel(comp.teams, teamA.id, teamA.model)}
                          </span>
                        )}
                        {teamA && teamB && (
                          <span style={{ color: '#3d7d94', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '1px' }}>VS</span>
                        )}
                        {teamB && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center',
                            padding: '0.2rem 0.55rem', borderRadius: '3px',
                            background: `${teamColor(teamB)}12`,
                            border: `1px solid ${teamColor(teamB)}33`,
                            color: teamColor(teamB), fontWeight: 600, fontSize: '0.7rem',
                          }}>
                            {resolveTeamLabel(comp.teams, teamB.id, teamB.model)}
                          </span>
                        )}
                        {winnerTeam && (
                          <>
                            <span style={{ color: '#1e4a5a' }}>·</span>
                            <span style={{
                              color: '#00f0ff', fontSize: '0.7rem', fontWeight: 700,
                            }}>
                              {resolveTeamLabel(comp.teams, winnerTeam.id, winnerTeam.model)} wins
                            </span>
                          </>
                        )}
                        {comp.brief?.timeLimitMs != null && (
                          <>
                            <span style={{ color: '#1e4a5a' }}>·</span>
                            <span style={{ color: '#4a8fa8', fontSize: '0.7rem' }}>
                              {formatTimeLimit(comp.brief.timeLimitMs)}
                            </span>
                          </>
                        )}
                        {briefRunCount > 1 && comp.brief?.id && (
                          <>
                            <span style={{ color: '#1e4a5a' }}>·</span>
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/briefs/${comp.brief!.id}/runs`; }}
                              style={{
                                fontSize: '0.7rem', color: '#7cc6db', background: 'none', border: 'none',
                                cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: 600,
                              }}
                            >
                              {briefRunCount} runs
                            </button>
                          </>
                        )}
                      </div>
                      {comp.notes && (
                        <div style={{ marginTop: '0.4rem' }}>
                          <span style={{ fontSize: '0.7rem', color: '#4a8fa8', fontStyle: 'italic', fontFamily: BODY_FONT }}>
                            {comp.notes}
                          </span>
                        </div>
                      )}

                      {/* Score bars for completed competitions */}
                      {(comp.state === 'COMPLETE' || comp.state === 'FORGE_COMPLETE') &&
                        Array.isArray(comp.scorecards) && comp.scorecards.length > 0 && (
                        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {[...comp.scorecards]
                            .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0))
                            .map((sc) => {
                              const team = comp.teams?.find((t) => t.id === sc.teamId);
                              if (!team) return null;
                              const score = sc.finalScore ?? 0;
                              const color = getModelColor(team.model);
                              const isWinner = team.id === comp.winnerId;
                              return (
                                <div key={sc.teamId} style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                                  <span style={{ fontSize: '0.65rem', color: color, fontWeight: 700, minWidth: '7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '0.3px' }}>
                                    {isWinner ? '◆ ' : ''}{resolveTeamLabel(comp.teams, team.id, team.model)}
                                  </span>
                                  <div style={{ flex: 1, height: '5px', background: '#0a2235', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${score * 100}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.3s ease' }} />
                                  </div>
                                  <span style={{ fontSize: '0.7rem', color: '#7cc6db', fontWeight: 700, minWidth: '2.75rem', textAlign: 'right', letterSpacing: '0.5px' }}>
                                    {Math.round(score * 100)}%
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>

                    {/* Right section */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexShrink: 0 }}>
                      {(comp.startedAt || comp.completedAt) && (
                        <span style={{ fontSize: '0.7rem', color: '#3d7d94', whiteSpace: 'nowrap', fontFamily: BODY_FONT }}>
                          {timeAgo(comp.completedAt ?? comp.startedAt)}
                        </span>
                      )}

                      {/* State badge */}
                      {(() => {
                        const s = getStateStyle(comp.state);
                        return (
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '0.22rem 0.6rem',
                            borderRadius: '3px', letterSpacing: '1px',
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
                            fontSize: '0.7rem', color: '#4a8fa8', background: 'none', border: 'none',
                            cursor: 'pointer', padding: 0, letterSpacing: '1px', whiteSpace: 'nowrap',
                            fontFamily: 'inherit', fontWeight: 700,
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
                            fontSize: '0.75rem', color: '#3d7d94', background: 'none', border: 'none',
                            cursor: 'pointer', padding: '0.2rem 0.35rem', borderRadius: '3px',
                            opacity: deleting === comp.id ? 0.4 : (isHovered ? 1 : 0),
                            transition: 'opacity 0.15s ease',
                            pointerEvents: isHovered || deleting === comp.id ? 'auto' : 'none',
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
              className="arena-btn arena-btn-primary new-comp-btn"
            >
              🏆 New Tournament
            </Link>
          </div>

          {tournamentsLoading && (
            <p style={{ fontSize: '0.72rem', color: '#4a8fa8', fontFamily: BODY_FONT }}>Loading tournaments…</p>
          )}

          {!tournamentsLoading && tournaments.length === 0 && (
            <div style={{
              padding: '2.5rem', textAlign: 'center',
              background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '8px',
            }}>
              <p style={{ fontSize: BODY_FONT_SIZE, fontFamily: BODY_FONT, color: '#4a8fa8', margin: 0 }}>
                No tournaments yet — start a round-robin to compare multiple agents head-to-head.
              </p>
            </div>
          )}

          {!tournamentsLoading && tournaments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
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
                        padding: '1.15rem 1.4rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
                        animation: `fadeIn 0.3s ease ${index * 0.04}s both`,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#c8eef8', marginBottom: '0.4rem', letterSpacing: '0.3px' }}>
                          {t.name || t.brief?.title || t.id}
                        </div>
                        <div style={{ fontSize: '0.7rem', fontFamily: BODY_FONT, color: '#4a8fa8', display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                          <span>{t.teams.length} teams</span>
                          <span style={{ color: '#1e4a5a' }}>·</span>
                          <span>{t.matchIds.length} match{t.matchIds.length !== 1 ? 'es' : ''}</span>
                          <span style={{ color: '#1e4a5a' }}>·</span>
                          <span>{t.teams.slice(0, 3).join(', ')}{t.teams.length > 3 ? ` +${t.teams.length - 3}` : ''}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexShrink: 0 }}>
                        <span style={{
                          fontSize: '0.65rem', fontWeight: 700, padding: '0.22rem 0.6rem',
                          borderRadius: '3px', letterSpacing: '1px',
                          background: s.bg, color: s.color,
                        }}>
                          {t.state}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#7cc6db', fontWeight: 700 }}>View →</span>
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
