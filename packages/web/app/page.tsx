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

const FORMAT_BADGES: Record<string, { bg: string; color: string; label: string }> = {
  SPRINT:      { bg: 'rgba(6,182,212,0.12)',   color: '#06b6d4', label: 'SPRINT' },
  HACKATHON:   { bg: 'rgba(168,85,247,0.12)',  color: '#a855f7', label: 'HACKATHON' },
  RED_VS_BLUE: { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', label: 'RED×BLUE' },
  RELAY_RACE:  { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e', label: 'RELAY' },
};

const STATE_STYLES: Record<string, { bg: string; color: string }> = {
  COMPLETE:    { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6' },
  RUNNING:     { bg: 'rgba(249,115,22,0.15)',  color: '#f97316' },
  JUDGING:     { bg: 'rgba(234,179,8,0.12)',   color: '#eab308' },
  SCORED:      { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e' },
  DRAFT:       { bg: 'rgba(136,150,171,0.08)', color: '#8896ab' },
};

function teamLabel(t: Team) {
  return t.persona ? `${t.model}:${t.persona}` : t.model;
}

function StateBadge({ state }: { state: string }) {
  const s = STATE_STYLES[state] ?? { bg: 'rgba(136,150,171,0.08)', color: '#8896ab' };
  return (
    <span style={{
      fontSize: '0.55rem', fontWeight: 700, padding: '0.12rem 0.5rem',
      borderRadius: '3px', letterSpacing: '1.5px',
      background: s.bg, color: s.color,
    }}>
      {state}
    </span>
  );
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

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0e17',
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      color: '#e2e8f0',
    }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '2.5rem' }}>
          <div>
            <div style={{ fontSize: '0.6rem', color: '#f97316', letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '0.4rem', fontWeight: 700 }}>
              ◆ Mission Control
            </div>
            <h1 style={{
              fontSize: '1.9rem', fontWeight: 800, lineHeight: 1.1,
              background: 'linear-gradient(135deg, #e2e8f0 0%, #f97316 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              Agent Arena
            </h1>
            <p style={{ fontSize: '0.7rem', color: '#8896ab', marginTop: '0.4rem' }}>
              AI agent head-to-head competitions
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <a
              href="/analytics"
              style={{
                fontSize: '0.62rem', color: '#8896ab', padding: '0.4rem 0.8rem',
                border: '1px solid #1e2d45', borderRadius: '4px', textDecoration: 'none',
                letterSpacing: '1px', transition: 'color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={(e) => { const a = e.currentTarget as HTMLAnchorElement; a.style.color = '#e2e8f0'; a.style.borderColor = '#2d4060'; }}
              onMouseLeave={(e) => { const a = e.currentTarget as HTMLAnchorElement; a.style.color = '#8896ab'; a.style.borderColor = '#1e2d45'; }}
            >
              ◆ ANALYTICS
            </a>
            <Link
              href="/competitions/new"
              style={{
                fontSize: '0.62rem', fontWeight: 700, padding: '0.45rem 1rem',
                background: '#f97316', color: '#0a0e17', borderRadius: '4px',
                textDecoration: 'none', letterSpacing: '1px', textTransform: 'uppercase',
              }}
            >
              + New Competition
            </Link>
          </div>
        </div>

        {loading && <p style={{ color: '#8896ab', fontSize: '0.75rem' }}>Loading…</p>}
        {!loading && error && <p style={{ color: '#ef4444', fontSize: '0.75rem' }}>{error}</p>}

        {!loading && competitions.length === 0 && (
          <div style={{ textAlign: 'center', padding: '5rem 0', color: '#8896ab' }}>
            <p style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>No competitions yet</p>
            <Link href="/competitions/new" style={{ color: '#f97316', fontSize: '0.75rem', textDecoration: 'none' }}>
              Run your first competition →
            </Link>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {competitions.map((comp) => {
            const teamA = comp.teams?.[0];
            const teamB = comp.teams?.[1];
            const winnerTeam = comp.teams?.find((t) => t.id === comp.winnerId);
            const fmt = comp.brief?.format ? FORMAT_BADGES[comp.brief.format] : null;
            const isRunning = comp.state === 'RUNNING';
            const isHovered = hoveredId === comp.id;

            return (
              <Link key={comp.id} href={`/competitions/${comp.id}`} style={{ textDecoration: 'none' }}>
                <div
                  onMouseEnter={() => setHoveredId(comp.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    background: '#111827',
                    border: `1px solid ${isRunning ? '#f97316' : isHovered ? '#2d4060' : '#1e2d45'}`,
                    borderRadius: '6px',
                    padding: '0.9rem 1.25rem',
                    transition: 'border-color 0.15s',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    {/* Left: title + matchup */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e2e8f0' }}>
                          {comp.brief?.title ?? comp.id}
                        </span>
                        {fmt && (
                          <span style={{
                            fontSize: '0.52rem', fontWeight: 700, padding: '0.1rem 0.45rem',
                            borderRadius: '3px', letterSpacing: '1.5px',
                            background: fmt.bg, color: fmt.color,
                          }}>
                            {fmt.label}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: '#8896ab', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {teamA && <span style={{ color: '#3b82f6' }}>{teamLabel(teamA)}</span>}
                        {teamA && teamB && <span style={{ color: '#2d3748' }}>vs</span>}
                        {teamB && <span style={{ color: '#a855f7' }}>{teamLabel(teamB)}</span>}
                        {winnerTeam && (
                          <>
                            <span style={{ color: '#2d3748', margin: '0 0.15rem' }}>·</span>
                            <span style={{ color: '#eab308', fontSize: '0.6rem', fontWeight: 700 }}>
                              ★ {teamLabel(winnerTeam)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right: date + state + actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexShrink: 0 }}>
                      {comp.startedAt && (
                        <span style={{ fontSize: '0.58rem', color: '#4a5568' }}>
                          {new Date(comp.startedAt).toLocaleDateString()}
                        </span>
                      )}
                      <StateBadge state={comp.state} />
                      {comp.state === 'COMPLETE' && (
                        <a
                          href={`/competitions/${comp.id}/replay`}
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: '0.58rem', color: '#8896ab', textDecoration: 'none', letterSpacing: '0.5px', transition: 'color 0.15s' }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#f97316'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = '#8896ab'; }}
                        >
                          ▶ REPLAY
                        </a>
                      )}
                      {comp.state !== 'RUNNING' && (
                        <button
                          onClick={(e) => handleDelete(e, comp.id)}
                          disabled={deleting === comp.id}
                          style={{
                            fontSize: '0.65rem', color: '#2d4060', background: 'none', border: 'none',
                            cursor: 'pointer', padding: '0 0.15rem', transition: 'color 0.15s',
                            opacity: deleting === comp.id ? 0.4 : 1,
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#2d4060'; }}
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
