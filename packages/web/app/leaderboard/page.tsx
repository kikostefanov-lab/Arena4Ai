'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getModelColor, MONOSPACE_FONT, ACCENT_GOLD, ACCENT_SILVER, ACCENT_BRONZE, KICKER_STYLE, TEXT_MUTED, BODY_FONT, BODY_FONT_SIZE, BODY_FONT_SIZE_SM } from '../../lib/design-tokens';

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
        background: '#0a2235',
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
  const color =
    rank === 1 ? ACCENT_GOLD :
    rank === 2 ? ACCENT_SILVER :
    rank === 3 ? ACCENT_BRONZE :
    TEXT_MUTED;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
  const bg = medal ? `${color}26` : 'rgba(10,34,53,0.5)';
  const border = medal ? `${color}66` : '#0a2235';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '2.2rem',
      height: '2.2rem',
      borderRadius: '6px',
      background: bg,
      border: `1px solid ${border}`,
      fontSize: medal ? '1.1rem' : '0.85rem',
      fontWeight: 800,
      color,
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
      fontFamily: MONOSPACE_FONT,
      color: '#c8eef8',
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '2.5rem 2rem' }}>

        {/* Hero Header */}
        <div style={{
          marginBottom: '2.5rem',
          padding: '2rem 0',
          borderBottom: '1px solid #0a2235',
        }}>
          <div>
            <div style={{ ...KICKER_STYLE, color: '#00f0ff', marginBottom: '0.6rem' }}>
              ◆ ARENA4AI | LEADERBOARD
            </div>
            <h1 style={{
              fontSize: '2.4rem',
              fontWeight: 800,
              lineHeight: 1.05,
              margin: 0,
              fontFamily: MONOSPACE_FONT,
              background: 'linear-gradient(135deg, #c8eef8 0%, #00f0ff 50%, #00f0ff 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              Leaderboard
            </h1>
            {!loading && !error && (
              <p style={{
                fontSize: BODY_FONT_SIZE,
                fontFamily: BODY_FONT,
                color: '#4a8fa8',
                marginTop: '0.6rem',
              }}>
                {entries.length > 0
                  ? `${entries.length} model${entries.length !== 1 ? 's' : ''} ranked by win rate across all completed competitions`
                  : 'No completed competitions yet'}
              </p>
            )}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '4rem 0' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem', animation: 'pulse 1.5s ease-in-out infinite' }}>🏆</div>
            <p style={{ color: '#4a8fa8', fontSize: '0.75rem' }}>Loading leaderboard…</p>
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
            background: '#050f1e',
            border: '1px dashed #0a2235',
            borderRadius: '12px',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏆</div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#c8eef8', marginBottom: '0.5rem' }}>
              No rankings yet
            </h2>
            <p style={{ fontSize: BODY_FONT_SIZE, fontFamily: BODY_FONT, color: '#4a8fa8', marginBottom: '1.5rem', maxWidth: '360px', margin: '0 auto 1.5rem' }}>
              Rankings appear after competitions complete. Run a battle to get the first result on the board.
            </p>
            <Link
              href="/competitions/new"
              className="arena-btn arena-btn-primary new-comp-btn"
            >
              ⚔️ Launch First Battle
            </Link>
          </div>
        )}

        {/* Leaderboard Table */}
        {!loading && !error && entries.length > 0 && (
          <div style={{
            background: '#050f1e',
            border: '1px solid #0a2235',
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
              background: '#020b14',
              borderBottom: '1px solid #0a2235',
              fontSize: '0.5rem',
              fontWeight: 700,
              letterSpacing: '1.5px',
              color: '#1e4a5a',
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
                    borderBottom: i < entries.length - 1 ? '1px solid #081520' : 'none',
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
                        fontSize: BODY_FONT_SIZE_SM,
                        fontFamily: BODY_FONT,
                        color: '#1e4a5a',
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
                    color: entry.wins > 0 ? '#0066ff' : '#0e3050',
                  }}>
                    {entry.wins}
                  </div>

                  {/* L */}
                  <div style={{
                    textAlign: 'center',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    color: entry.losses > 0 ? '#ef4444' : '#0e3050',
                  }}>
                    {entry.losses}
                  </div>

                  {/* T */}
                  <div style={{
                    textAlign: 'center',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    color: entry.ties > 0 ? '#eab308' : '#0e3050',
                  }}>
                    {entry.ties}
                  </div>

                  {/* Competitions */}
                  <div style={{
                    textAlign: 'center',
                    fontSize: '0.78rem',
                    color: '#4a8fa8',
                    fontWeight: 600,
                  }}>
                    {entry.totalCompetitions}
                  </div>

                  {/* Avg Score */}
                  <div style={{
                    textAlign: 'right',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: '#c8eef8',
                  }}>
                    {Math.round(entry.avgScore * 100)}%
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
            fontSize: BODY_FONT_SIZE_SM,
            fontFamily: BODY_FONT,
            color: '#0e3050',
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
