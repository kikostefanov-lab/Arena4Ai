'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getModelColor } from '../../lib/design-tokens';

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

const MODEL_ICONS: Record<string, string> = {
  claude: '◆',
  codex:  '■',
  gemini: '●',
};

function WinRateBar({ winRate, color }: { winRate: number; color: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      minWidth: '120px',
    }}>
      <div style={{
        flex: 1,
        height: '6px',
        background: '#1e2d45',
        borderRadius: '3px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${Math.round(winRate * 100)}%`,
          background: `linear-gradient(90deg, ${color}99, ${color})`,
          borderRadius: '3px',
          transition: 'width 0.6s ease',
        }} />
      </div>
      <span style={{
        fontSize: '0.7rem',
        fontWeight: 700,
        color,
        minWidth: '3rem',
        textAlign: 'right',
      }}>
        {Math.round(winRate * 100)}%
      </span>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const gold   = rank === 1 ? { bg: 'rgba(234,179,8,0.15)',  color: '#eab308', border: 'rgba(234,179,8,0.4)' }   : null;
  const silver = rank === 2 ? { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8', border: 'rgba(148,163,184,0.4)' } : null;
  const bronze = rank === 3 ? { bg: 'rgba(180,120,60,0.15)', color: '#b47c3c', border: 'rgba(180,120,60,0.4)' }  : null;
  const style  = gold ?? silver ?? bronze ?? { bg: 'rgba(30,45,69,0.5)', color: '#4a5568', border: '#1e2d45' };
  const medal  = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '2.2rem',
      height: '2.2rem',
      borderRadius: '6px',
      background: style.bg,
      border: `1px solid ${style.border}`,
      fontSize: medal ? '1.1rem' : '0.85rem',
      fontWeight: 800,
      color: style.color,
      flexShrink: 0,
    }}>
      {medal ?? `#${rank}`}
    </div>
  );
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then((data: LeaderboardEntry[]) => { setEntries(data); setLoading(false); })
      .catch(() => { setError('Failed to load leaderboard — is the API server running?'); setLoading(false); });
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0e17',
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      color: '#e2e8f0',
    }}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.5; }
        }
        .lb-row {
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .lb-row:hover {
          background: rgba(30,45,69,0.6) !important;
          border-color: #2d4060 !important;
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
                ◆ Model Rankings
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
                Leaderboard
              </h1>
              {!loading && !error && (
                <p style={{
                  fontSize: '0.72rem',
                  color: '#8896ab',
                  marginTop: '0.6rem',
                }}>
                  {entries.length > 0
                    ? `${entries.length} model${entries.length !== 1 ? 's' : ''} ranked by win rate across all completed competitions`
                    : 'No completed competitions yet'}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.5rem' }}>
              <Link
                href="/"
                className="nav-link"
                style={{
                  fontSize: '0.62rem', color: '#8896ab', padding: '0.45rem 0.85rem',
                  border: '1px solid #1e2d45', borderRadius: '4px', textDecoration: 'none',
                  letterSpacing: '1px', fontWeight: 600,
                }}
              >
                ← GALLERY
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

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '4rem 0' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem', animation: 'pulse 1.5s ease-in-out infinite' }}>🏆</div>
            <p style={{ color: '#8896ab', fontSize: '0.75rem' }}>Loading leaderboard…</p>
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
        {!loading && !error && entries.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '5rem 2rem',
            background: '#111827',
            border: '1px dashed #1e2d45',
            borderRadius: '12px',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏆</div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.5rem' }}>
              No rankings yet
            </h2>
            <p style={{ fontSize: '0.75rem', color: '#8896ab', marginBottom: '1.5rem', maxWidth: '360px', margin: '0 auto 1.5rem' }}>
              Rankings appear after competitions complete. Run a battle to get the first result on the board.
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

        {/* Leaderboard Table */}
        {!loading && !error && entries.length > 0 && (
          <div style={{
            background: '#111827',
            border: '1px solid #1e2d45',
            borderRadius: '10px',
            overflow: 'hidden',
            animation: 'fadeIn 0.3s ease both',
          }}>
            {/* Table Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '3.5rem 1fr 4rem 4rem 4rem 6rem 6rem 10rem',
              gap: '0',
              padding: '0.65rem 1.25rem',
              background: '#0f1724',
              borderBottom: '1px solid #1e2d45',
              fontSize: '0.5rem',
              fontWeight: 700,
              letterSpacing: '1.5px',
              color: '#4a5568',
              textTransform: 'uppercase',
              alignItems: 'center',
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
              const icon  = MODEL_ICONS[entry.model] ?? '◇';

              return (
                <div
                  key={entry.model}
                  className="lb-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '3.5rem 1fr 4rem 4rem 4rem 6rem 6rem 10rem',
                    gap: '0',
                    padding: '0.9rem 1.25rem',
                    borderBottom: i < entries.length - 1 ? '1px solid #1a2440' : 'none',
                    background: 'transparent',
                    alignItems: 'center',
                    animation: `fadeIn 0.3s ease ${i * 0.06}s both`,
                  }}
                >
                  {/* Rank */}
                  <div>
                    <RankBadge rank={entry.rank} />
                  </div>

                  {/* Model */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{
                      fontSize: '0.85rem',
                      color,
                      fontWeight: 800,
                    }}>
                      {icon}
                    </span>
                    <div>
                      <div style={{
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        color,
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                      }}>
                        {entry.model}
                      </div>
                      <div style={{
                        fontSize: '0.55rem',
                        color: '#4a5568',
                        marginTop: '0.1rem',
                        letterSpacing: '0.5px',
                      }}>
                        {entry.totalCompetitions} competition{entry.totalCompetitions !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>

                  {/* W */}
                  <div style={{
                    textAlign: 'center',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    color: entry.wins > 0 ? '#22c55e' : '#2d4060',
                  }}>
                    {entry.wins}
                  </div>

                  {/* L */}
                  <div style={{
                    textAlign: 'center',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    color: entry.losses > 0 ? '#ef4444' : '#2d4060',
                  }}>
                    {entry.losses}
                  </div>

                  {/* T */}
                  <div style={{
                    textAlign: 'center',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    color: entry.ties > 0 ? '#eab308' : '#2d4060',
                  }}>
                    {entry.ties}
                  </div>

                  {/* Competitions */}
                  <div style={{
                    textAlign: 'center',
                    fontSize: '0.78rem',
                    color: '#8896ab',
                    fontWeight: 600,
                  }}>
                    {entry.totalCompetitions}
                  </div>

                  {/* Avg Score */}
                  <div style={{
                    textAlign: 'right',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: '#e2e8f0',
                  }}>
                    {entry.avgScore.toFixed(1)}
                  </div>

                  {/* Win Rate Bar */}
                  <div style={{ paddingLeft: '0.5rem' }}>
                    <WinRateBar winRate={entry.winRate} color={color} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        {!loading && !error && entries.length > 0 && (
          <p style={{
            marginTop: '1rem',
            fontSize: '0.58rem',
            color: '#2d4060',
            textAlign: 'center',
            letterSpacing: '0.5px',
          }}>
            Rankings based on completed competitions only · Sorted by win rate, then avg score, then total wins
          </p>
        )}
      </div>
    </div>
  );
}
