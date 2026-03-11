'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getModelColor, getStateStyle } from '../../../lib/design-tokens';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RankingEntry {
  model: string;
  wins: number;
  losses: number;
  draws: number;
  totalScore: number;
  matchesPlayed: number;
  buchholz?: number;
}

interface SwissMeta {
  currentRound: number;
  totalRounds: number;
  roundPairings: Array<{ round: number; pairs: Array<[string, string]> }>;
}

interface TournamentEntry {
  id: string;
  name: string;
  type: 'ROUND_ROBIN' | 'SWISS';
  state: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  teams: string[];
  matchIds: string[];
  brief: {
    title: string;
    format: string;
    problem: string;
    constraints: string[];
    deliverables: string[];
    timeLimitMs: number;
    rubric: { criteria: Array<{ id: string; description: string; maxScore: number; weight: number }> };
    expectedOutput?: string;
  };
  rankings: RankingEntry[] | null;
  swissMeta: SwissMeta | null;
  currentMatch: { teamA: string; teamB: string; competitionId?: string } | null;
  error: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function medalFor(rank: number): string {
  if (rank === 0) return '🥇';
  if (rank === 1) return '🥈';
  if (rank === 2) return '🥉';
  return `${rank + 1}.`;
}

function formatTeamLabel(team: string): string {
  return team;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TournamentPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const router = useRouter();
  const [tournament, setTournament] = useState<TournamentEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchTournament = useCallback(async () => {
    try {
      const res = await fetch(`/api/tournaments/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TournamentEntry = await res.json();
      setTournament(data);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load tournament');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTournament();
  }, [fetchTournament]);

  // Poll every 3 seconds while RUNNING or PENDING
  useEffect(() => {
    if (!tournament) return;
    if (tournament.state !== 'RUNNING' && tournament.state !== 'PENDING') return;
    const interval = setInterval(fetchTournament, 3000);
    return () => clearInterval(interval);
  }, [tournament, fetchTournament]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#000408', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'SF Mono', monospace", color: '#4a8fa8' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏆</div>
          <p style={{ fontSize: '0.75rem' }}>Loading tournament…</p>
        </div>
      </div>
    );
  }

  if (fetchError || !tournament) {
    return (
      <div style={{ minHeight: '100vh', background: '#000408', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'SF Mono', monospace", color: '#ef4444' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚠️</div>
          <p style={{ fontSize: '0.75rem' }}>{fetchError ?? 'Tournament not found'}</p>
          <Link href="/" style={{ display: 'inline-block', marginTop: '1rem', fontSize: '0.65rem', color: '#4a8fa8', textDecoration: 'none' }}>
            ← Back to Gallery
          </Link>
        </div>
      </div>
    );
  }

  const stateStyle = getStateStyle(tournament.state);
  const isRunning = tournament.state === 'RUNNING' || tournament.state === 'PENDING';
  const isComplete = tournament.state === 'COMPLETE';
  const isFailed = tournament.state === 'FAILED';

  const winner = isComplete && tournament.rankings && tournament.rankings.length > 0
    ? tournament.rankings[0]
    : null;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#000408',
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      color: '#c8eef8',
    }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .match-link { transition: color 0.15s ease; }
        .match-link:hover { color: #00f0ff !important; }
        .nav-link { transition: color 0.15s ease, border-color 0.15s ease; }
        .nav-link:hover { color: #c8eef8 !important; border-color: #0e3050 !important; }
      `}</style>

      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid #0a2235' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.58rem', color: '#00f0ff', letterSpacing: '4px', textTransform: 'uppercase', marginBottom: '0.4rem', fontWeight: 700 }}>
                ◆ Tournament
              </div>
              <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: '0 0 0.5rem', color: '#c8eef8', lineHeight: 1.1 }}>
                {tournament.name || tournament.brief?.title || tournament.id}
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                {/* State badge */}
                <span style={{
                  fontSize: '0.55rem', fontWeight: 800, padding: '0.2rem 0.65rem',
                  borderRadius: '4px', letterSpacing: '2px', textTransform: 'uppercase',
                  background: stateStyle.bg, color: stateStyle.color,
                  ...(isRunning ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                }}>
                  {isRunning && (
                    <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: stateStyle.color }} />
                  )}
                  {tournament.state}
                </span>
                <span style={{ fontSize: '0.65rem', color: '#4a8fa8' }}>
                  {tournament.teams.length} teams ·{' '}
                  {tournament.type === 'SWISS' && tournament.swissMeta
                    ? `Round ${tournament.swissMeta.currentRound}/${tournament.swissMeta.totalRounds} · `
                    : ''}
                  {tournament.matchIds.length} match{tournament.matchIds.length !== 1 ? 'es' : ''} played
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
              {isRunning && (
                <button
                  disabled={actionLoading}
                  onClick={async () => {
                    if (!confirm('Cancel this tournament? Running matches will be stopped.')) return;
                    setActionLoading(true);
                    try {
                      await fetch(`/api/tournaments/${id}?action=cancel`, { method: 'POST' });
                      fetchTournament();
                    } finally { setActionLoading(false); }
                  }}
                  style={{
                    fontSize: '0.6rem', fontWeight: 700, color: '#ef4444', padding: '0.4rem 0.8rem',
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '1px',
                  }}
                >
                  CANCEL
                </button>
              )}
              {(isComplete || isFailed) && (
                <button
                  disabled={actionLoading}
                  onClick={async () => {
                    if (!confirm('Delete this tournament permanently?')) return;
                    setActionLoading(true);
                    try {
                      const res = await fetch(`/api/tournaments/${id}`, { method: 'DELETE' });
                      if (res.ok) router.push('/');
                      else { const d = await res.json().catch(() => ({})); alert(d.error ?? 'Delete failed'); }
                    } finally { setActionLoading(false); }
                  }}
                  style={{
                    fontSize: '0.6rem', fontWeight: 700, color: '#ef4444', padding: '0.4rem 0.8rem',
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '1px',
                  }}
                >
                  DELETE
                </button>
              )}
              <Link
                href="/"
                className="nav-link"
                style={{
                  fontSize: '0.6rem', color: '#4a8fa8', padding: '0.4rem 0.8rem',
                  border: '1px solid #0a2235', borderRadius: '4px', textDecoration: 'none',
                  letterSpacing: '1px', fontWeight: 600,
                }}
              >
                ← GALLERY
              </Link>
            </div>
          </div>
        </div>

        {/* Winner Banner */}
        {isComplete && winner && (
          <div style={{
            marginBottom: '1.5rem',
            padding: '1.25rem 1.5rem',
            background: `${getModelColor(winner.model.split(':')[0])}12`,
            border: `1px solid ${getModelColor(winner.model.split(':')[0])}44`,
            borderRadius: '10px',
            textAlign: 'center',
            animation: 'fadeIn 0.4s ease',
          }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>🏆</div>
            <div style={{ fontSize: '0.6rem', color: '#4a8fa8', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
              Tournament Complete — Winner
            </div>
            <div style={{
              fontSize: '1.3rem', fontWeight: 800,
              color: getModelColor(winner.model.split(':')[0]),
            }}>
              {winner.model}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#4a8fa8', marginTop: '0.3rem' }}>
              {winner.wins}W · {winner.losses}L · {winner.draws}D · {Math.round(winner.totalScore * 100)}%
            </div>
          </div>
        )}

        {/* Failed Banner */}
        {isFailed && (
          <div style={{
            marginBottom: '1.5rem',
            padding: '1rem 1.25rem',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: '8px',
          }}>
            <div style={{ fontSize: '0.6rem', color: '#ef4444', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '0.35rem', fontWeight: 700 }}>
              Tournament Failed
            </div>
            <p style={{ fontSize: '0.72rem', color: '#ef4444', margin: 0 }}>
              {tournament.error ?? 'An unexpected error occurred.'}
            </p>
          </div>
        )}

        {/* Current Match */}
        {isRunning && tournament.currentMatch && (
          <div style={{
            marginBottom: '1.5rem',
            padding: '1rem 1.25rem',
            background: 'linear-gradient(135deg, rgba(0,240,255,0.06) 0%, #050f1e 100%)',
            border: '1px solid rgba(0,240,255,0.35)',
            borderRadius: '8px',
            display: 'flex', alignItems: 'center', gap: '0.75rem',
          }}>
            <span style={{
              fontSize: '0.5rem', fontWeight: 800, padding: '0.12rem 0.5rem',
              borderRadius: '3px', letterSpacing: '2px',
              background: 'rgba(0,240,255,0.2)', color: '#00f0ff',
              animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0,
            }}>
              LIVE
            </span>
            <span style={{ fontSize: '0.72rem', color: '#4a8fa8' }}>Current match:</span>
            <span style={{ color: getModelColor(tournament.currentMatch.teamA.split(':')[0]), fontWeight: 700, fontSize: '0.75rem' }}>
              {formatTeamLabel(tournament.currentMatch.teamA)}
            </span>
            <span style={{ color: '#1e4a5a', fontSize: '0.65rem', fontWeight: 700 }}>VS</span>
            <span style={{ color: getModelColor(tournament.currentMatch.teamB.split(':')[0]), fontWeight: 700, fontSize: '0.75rem' }}>
              {formatTeamLabel(tournament.currentMatch.teamB)}
            </span>
            {tournament.currentMatch.competitionId && (
              <Link
                href={`/competitions/${tournament.currentMatch.competitionId}`}
                className="match-link"
                style={{
                  marginLeft: 'auto', fontSize: '0.62rem', color: '#00f0ff', textDecoration: 'none', flexShrink: 0,
                  fontWeight: 700, letterSpacing: '1px',
                }}
              >
                WATCH LIVE →
              </Link>
            )}
          </div>
        )}

        {/* Swiss round indicator */}
        {tournament.type === 'SWISS' && tournament.swissMeta && (
          <div style={{
            marginBottom: '1rem',
            padding: '0.65rem 1rem',
            background: 'rgba(0,240,255,0.04)',
            border: '1px solid rgba(0,240,255,0.15)',
            borderRadius: '8px',
            display: 'flex', alignItems: 'center', gap: '0.75rem',
          }}>
            <span style={{
              fontSize: '0.5rem', fontWeight: 800, padding: '0.15rem 0.5rem',
              borderRadius: '3px', letterSpacing: '2px',
              background: 'rgba(0,240,255,0.12)', color: '#00f0ff',
            }}>
              SWISS
            </span>
            <span style={{ fontSize: '0.68rem', color: '#4a8fa8' }}>
              Round{' '}
              <strong style={{ color: '#c8eef8' }}>
                {tournament.swissMeta.currentRound}
              </strong>
              {' '}of{' '}
              <strong style={{ color: '#c8eef8' }}>
                {tournament.swissMeta.totalRounds}
              </strong>
            </span>
            <span style={{ fontSize: '0.6rem', color: '#1e4a5a' }}>
              · {tournament.matchIds.length} matches played
            </span>
          </div>
        )}

        {/* Standings Table */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.6rem', color: '#4a8fa8', letterSpacing: '2px', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.75rem' }}>
            Standings
          </div>
          {tournament.rankings && tournament.rankings.length > 0 ? (
            <div style={{ background: '#050f1e', border: '1px solid #0a2235', borderRadius: '8px', overflow: 'hidden' }}>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: tournament.type === 'SWISS'
                  ? '2.5rem 1fr 3rem 3rem 3rem 4rem 5rem 4.5rem'
                  : '2.5rem 1fr 3rem 3rem 3rem 5rem 4.5rem',
                padding: '0.5rem 1rem',
                borderBottom: '1px solid #0a2235',
                fontSize: '0.52rem', color: '#1e4a5a', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
              }}>
                <span>Rank</span>
                <span>Team</span>
                <span style={{ textAlign: 'center' }}>W</span>
                <span style={{ textAlign: 'center' }}>L</span>
                <span style={{ textAlign: 'center' }}>D</span>
                {tournament.type === 'SWISS' && (
                  <span style={{ textAlign: 'right' }}>Buch.</span>
                )}
                <span style={{ textAlign: 'right' }}>Score</span>
                <span style={{ textAlign: 'right' }}>Matches</span>
              </div>
              {tournament.rankings.map((entry, i) => {
                const color = getModelColor(entry.model.split(':')[0]);
                return (
                  <div
                    key={entry.model}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: tournament.type === 'SWISS'
                        ? '2.5rem 1fr 3rem 3rem 3rem 4rem 5rem 4.5rem'
                        : '2.5rem 1fr 3rem 3rem 3rem 5rem 4.5rem',
                      padding: '0.65rem 1rem',
                      borderBottom: i < tournament.rankings!.length - 1 ? '1px solid #081520' : 'none',
                      alignItems: 'center',
                      animation: `fadeIn 0.3s ease ${i * 0.05}s both`,
                    }}
                  >
                    <span style={{ fontSize: '0.85rem' }}>
                      {isComplete ? medalFor(i) : <span style={{ fontSize: '0.65rem', color: '#1e4a5a' }}>{i + 1}</span>}
                    </span>
                    <span style={{ color, fontWeight: 700, fontSize: '0.75rem' }}>
                      {entry.model}
                    </span>
                    <span style={{ textAlign: 'center', fontSize: '0.72rem', color: '#0066ff', fontWeight: 700 }}>{entry.wins}</span>
                    <span style={{ textAlign: 'center', fontSize: '0.72rem', color: '#ef4444', fontWeight: 700 }}>{entry.losses}</span>
                    <span style={{ textAlign: 'center', fontSize: '0.72rem', color: '#4a8fa8' }}>{entry.draws}</span>
                    {tournament.type === 'SWISS' && (
                      <span style={{ textAlign: 'right', fontSize: '0.68rem', color: '#7cc6db' }}>{entry.buchholz ?? 0}</span>
                    )}
                    <span style={{ textAlign: 'right', fontSize: '0.72rem', color: '#c8eef8', fontWeight: 700 }}>{Math.round(entry.totalScore * 100)}%</span>
                    <span style={{ textAlign: 'right', fontSize: '0.65rem', color: '#1e4a5a' }}>{entry.matchesPlayed}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{
              padding: '2rem', textAlign: 'center',
              background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '8px',
              color: '#1e4a5a', fontSize: '0.72rem',
            }}>
              {isRunning ? 'Standings will appear after the first match completes.' : 'No standings available.'}
            </div>
          )}
        </div>

        {/* Swiss Round History */}
        {tournament.type === 'SWISS' && tournament.swissMeta && tournament.swissMeta.roundPairings.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.6rem', color: '#4a8fa8', letterSpacing: '2px', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.75rem' }}>
              Swiss Rounds
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {tournament.swissMeta.roundPairings.map(({ round, pairs }) => (
                <div key={round} style={{
                  background: '#050f1e',
                  border: '1px solid #0a2235',
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    padding: '0.5rem 1rem',
                    borderBottom: '1px solid #0a2235',
                    fontSize: '0.55rem', color: '#00f0ff', fontWeight: 700, letterSpacing: '2px',
                    textTransform: 'uppercase',
                  }}>
                    Round {round}
                  </div>
                  <div style={{ padding: '0.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {pairs.map(([a, b], pi) => (
                      <div key={pi} style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        fontSize: '0.68rem',
                      }}>
                        <span style={{ color: getModelColor(a.split(':')[0]), fontWeight: 700 }}>{a}</span>
                        <span style={{ color: '#1e4a5a', fontSize: '0.58rem' }}>vs</span>
                        <span style={{ color: getModelColor(b.split(':')[0]), fontWeight: 700 }}>{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Match History */}
        {tournament.matchIds.length > 0 && (
          <div>
            <div style={{ fontSize: '0.6rem', color: '#4a8fa8', letterSpacing: '2px', textTransform: 'uppercase', fontWeight: 700, marginBottom: '0.75rem' }}>
              Match History
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {tournament.matchIds.map((matchId, i) => (
                <div
                  key={matchId}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.6rem 1rem',
                    background: '#050f1e', border: '1px solid #0a2235', borderRadius: '6px',
                    animation: `fadeIn 0.3s ease ${i * 0.04}s both`,
                  }}
                >
                  <span style={{ fontSize: '0.65rem', color: '#4a8fa8' }}>
                    Match {i + 1}
                  </span>
                  <span style={{ fontSize: '0.58rem', color: '#1e4a5a', fontFamily: 'monospace' }}>
                    {matchId.slice(0, 8)}…
                  </span>
                  <Link
                    href={`/competitions/${matchId}`}
                    className="match-link"
                    style={{ fontSize: '0.62rem', color: '#4a8fa8', textDecoration: 'none', fontWeight: 600 }}
                  >
                    View →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No matches yet */}
        {tournament.matchIds.length === 0 && isRunning && (
          <div style={{
            padding: '1.5rem', textAlign: 'center',
            background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '8px',
            color: '#1e4a5a', fontSize: '0.72rem', marginTop: '0.5rem',
          }}>
            First match starting soon…
          </div>
        )}
      </div>
    </div>
  );
}
