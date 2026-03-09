'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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
  brief: { title: string; format?: string };
  teams: Team[];
  winnerId: string | null;
}

const MODEL_COLORS: Record<string, string> = {
  claude: '#3b82f6',
  codex: '#22c55e',
  gemini: '#a855f7',
};

const FORMAT_BADGES: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  SPRINT:      { bg: 'rgba(6,182,212,0.12)',   color: '#06b6d4', label: 'SPRINT',    icon: '⚡' },
  HACKATHON:   { bg: 'rgba(168,85,247,0.12)',  color: '#a855f7', label: 'HACKATHON', icon: '🔨' },
  RED_VS_BLUE: { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', label: 'RED×BLUE', icon: '⚔️' },
  RELAY_RACE:  { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e', label: 'RELAY',     icon: '🔄' },
};

const STATE_STYLES: Record<string, { bg: string; color: string }> = {
  COMPLETE:    { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6' },
  RUNNING:     { bg: 'rgba(249,115,22,0.15)',  color: '#f97316' },
  JUDGING:     { bg: 'rgba(234,179,8,0.12)',   color: '#eab308' },
  SCORED:      { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e' },
  DRAFT:       { bg: 'rgba(136,150,171,0.08)', color: '#8896ab' },
  LAUNCHING:   { bg: 'rgba(6,182,212,0.12)',   color: '#06b6d4' },
  TIME_UP:     { bg: 'rgba(234,179,8,0.12)',   color: '#eab308' },
  COLLECTING:  { bg: 'rgba(168,85,247,0.12)',  color: '#a855f7' },
  CONFIGURED:  { bg: 'rgba(136,150,171,0.08)', color: '#8896ab' },
};

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

function getModelBase(t: Team): string {
  return t.model.toLowerCase().split(':')[0];
}

function getModelColor(t: Team): string {
  const base = getModelBase(t);
  return MODEL_COLORS[base] ?? '#8896ab';
}

export default function GalleryPage() {
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/competitions')
      .then((r) => r.json())
      .then((data: CompetitionSummary[]) => { setCompetitions(data); setLoading(false); })
      .catch(() => { setError('Failed to load competitions — is the API server running?'); setLoading(false); });
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
          {competitions.map((comp, index) => {
            const teamA = comp.teams?.[0];
            const teamB = comp.teams?.[1];
            const winnerTeam = comp.teams?.find((t) => t.id === comp.winnerId);
            const fmt = comp.brief?.format ? FORMAT_BADGES[comp.brief.format] : null;
            const isRunning = comp.state === 'RUNNING';
            const isComplete = comp.state === 'COMPLETE' || comp.state === 'SCORED';
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
                          {isRunning ? '⚔️' : isComplete ? '🏆' : '📋'}
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
                            background: `${getModelColor(teamA)}12`,
                            border: `1px solid ${getModelColor(teamA)}33`,
                            color: getModelColor(teamA), fontWeight: 600, fontSize: '0.62rem',
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
                            background: `${getModelColor(teamB)}12`,
                            border: `1px solid ${getModelColor(teamB)}33`,
                            color: getModelColor(teamB), fontWeight: 600, fontSize: '0.62rem',
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
                        const s = STATE_STYLES[comp.state] ?? { bg: 'rgba(136,150,171,0.08)', color: '#8896ab' };
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
      </div>
    </div>
  );
}
