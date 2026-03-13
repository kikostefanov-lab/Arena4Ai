import { orchestratorUrl, orchestratorHeaders } from '../../lib/orchestrator';
import { formatDuration } from '../../lib/format';
import { MONOSPACE_FONT, KICKER_STYLE, getModelColor, BODY_FONT, BODY_FONT_SIZE, BODY_FONT_SIZE_SM } from '../../lib/design-tokens';

interface AgentStat { model: string; wins: number; total: number; winRate: number; }
interface FormatStat { format: string; total: number; completed: number; avgDurationMs: number | null; }
interface RecentComp { id: string; title: string; format: string | null; agents: string[]; winner: string | null; durationMs: number | null; }
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

async function getAnalytics(): Promise<AnalyticsSummary | null> {
  try {
    const res = await fetch(orchestratorUrl('/analytics/summary'), {
      headers: orchestratorHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function parseAgentKey(key: string): { model: string; persona: string | null } {
  const colon = key.indexOf(':');
  if (colon === -1) return { model: key, persona: null };
  return { model: key.slice(0, colon), persona: key.slice(colon + 1) };
}

const MODEL_ICONS: Record<string, string> = {
  claude: '🟠',
  codex: '🟢',
  gemini: '🟣',
};

const FORMAT_BADGE_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  SPRINT:      { color: '#06b6d4', icon: '⚡',       label: 'SPRINT' },
  HACKATHON:   { color: '#00f0ff', icon: '🔨', label: 'HACKATHON' },
  RELAY_RACE:  { color: '#0066ff', icon: '🔄', label: 'RELAY' },
  RED_VS_BLUE: { color: '#ef4444', icon: '⚔', label: 'RED×BLUE' },
};

function FormatBadge({ format }: { format: string | null }) {
  if (!format) return <span style={{ color: '#0e3050' }}>—</span>;
  const cfg = FORMAT_BADGE_CONFIG[format];
  const color = cfg?.color ?? '#4a8fa8';
  const icon = cfg?.icon ?? '';
  const label = cfg?.label ?? format;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.25rem',
      padding: '0.15rem 0.5rem',
      borderRadius: '3px',
      background: `${color}1a`,
      border: `1px solid ${color}44`,
      color,
      fontSize: '0.58rem',
      fontWeight: 700,
      letterSpacing: '1px',
      textTransform: 'uppercase',
    }}>
      <span style={{ fontSize: '0.65rem' }}>{icon}</span> {label}
    </span>
  );
}

function getModelIcon(key: string): string {
  const base = key.split(':')[0]?.toLowerCase() ?? '';
  return MODEL_ICONS[base] ?? '⬤';
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

export default async function AnalyticsPage() {
  const data = await getAnalytics();

  const font = MONOSPACE_FONT;

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '0.6rem 1rem',
    fontSize: '0.55rem',
    color: '#1e4a5a',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    fontWeight: 700,
    fontFamily: font,
  };

  const thRightStyle: React.CSSProperties = { ...thStyle, textAlign: 'right' };

  return (
    <div style={{
      minHeight: '100vh',
      fontFamily: font,
      color: '#c8eef8',
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '2.5rem 2rem' }}>

        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '2.25rem',
          paddingBottom: '1.25rem',
          borderBottom: '1px solid #0a2235',
        }}>
          <div>
            <div style={{ ...KICKER_STYLE, color: '#00f0ff', marginBottom: '0.4rem' }}>
              ◆ ARENA4AI | ANALYTICS
            </div>
            <h1 style={{
              fontSize: '2rem', fontWeight: 800, lineHeight: 1.05, margin: 0,
              background: 'linear-gradient(135deg, #c8eef8 0%, #00f0ff 50%, #0080ff 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              fontFamily: 'var(--font-orbitron), monospace',
            }}>
              Analytics
            </h1>
            <p style={{ fontSize: BODY_FONT_SIZE, fontFamily: BODY_FONT, color: '#4a8fa8', marginTop: '0.4rem', margin: '0.4rem 0 0' }}>
              Performance dashboard across all completed competitions
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <a href="/analytics/criteria" className="arena-btn" style={{ textDecoration: 'none' }}>
              📊 Criteria →
            </a>
            <a href="/compare" className="arena-btn" style={{ textDecoration: 'none' }}>
              ⚔ Compare →
            </a>
          </div>
        </div>

        {!data ? (
          <div style={{
            textAlign: 'center', padding: '4rem 2rem',
            background: '#050f1e', border: '1px solid #0a2235', borderRadius: '8px',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚠️</div>
            <p style={{ color: '#4a8fa8', fontSize: BODY_FONT_SIZE, fontFamily: BODY_FONT }}>
              Could not reach orchestrator. Is it running?
            </p>
          </div>
        ) : (
          <>
            {/* Section 1: Overview tiles */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '0.75rem',
              marginBottom: '2rem',
            }}>
              {[
                { icon: '📊', label: 'Total Battles', value: data.totalCompetitions, accent: '#3b82f6' },
                { icon: '✅', label: 'Completed', value: data.completedCompetitions, accent: '#0066ff' },
                { icon: '⏱️', label: 'Avg Duration', value: formatDuration(data.avgDurationMs), accent: '#00f0ff' },
                { icon: '🔬', label: 'Syntheses', value: data.synthesisCount, accent: '#00f0ff' },
              ].map(({ icon, label, value, accent }) => (
                <div key={label} style={{
                  background: '#050f1e',
                  border: '1px solid #0a2235',
                  borderLeft: `3px solid ${accent}`,
                  borderRadius: '6px',
                  padding: '1rem 1.1rem',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    position: 'absolute', top: '0.8rem', right: '0.9rem',
                    fontSize: '1.4rem', opacity: 0.7,
                  }}>
                    {icon}
                  </div>
                  <div style={{
                    fontSize: '0.52rem', color: '#4a8fa8', textTransform: 'uppercase',
                    letterSpacing: '2px', marginBottom: '0.5rem', fontWeight: 700,
                  }}>
                    {label}
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#c8eef8' }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* Section 2: Win Rate by Agent */}
            <div style={{
              border: '1px solid #0a2235',
              borderRadius: '8px',
              overflow: 'hidden',
              marginBottom: '2rem',
            }}>
              <div style={{
                background: '#010810',
                padding: '0.75rem 1rem',
                borderBottom: '1px solid #0a2235',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{
                  fontSize: '0.58rem', fontWeight: 700, color: '#4a8fa8',
                  textTransform: 'uppercase', letterSpacing: '2px',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                }}>
                  🏆 Win Rate by Agent
                </span>
                <span style={{ fontSize: '0.5rem', color: '#1e4a5a', letterSpacing: '1px' }}>
                  model:persona
                </span>
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
                        const modelIcon = getModelIcon(stat.model);
                        const isTop = stat.winRate === topWinRate && stat.winRate > 0;
                        return (
                          <tr key={stat.model} style={{
                            borderBottom: '1px solid rgba(10,34,53,0.5)',
                            background: isTop ? 'rgba(234,179,8,0.04)' : 'transparent',
                          }}>
                            <td style={{ padding: '0.65rem 1rem', color: '#1e4a5a', fontSize: '0.6rem', fontWeight: 700 }}>
                              {isTop ? '🥇' : `${idx + 1}`}
                            </td>
                            <td style={{ padding: '0.65rem 1rem' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ fontSize: '0.7rem' }}>{modelIcon}</span>
                                <span style={{ color: modelColor, fontWeight: 700 }}>{model}</span>
                                {persona && (
                                  <span style={{ color: '#4a8fa8', fontSize: '0.62rem' }}>:{persona}</span>
                                )}
                              </span>
                            </td>
                            <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: '#c8eef8', fontWeight: 600 }}>
                              {stat.wins}
                            </td>
                            <td style={{ padding: '0.65rem 1rem', textAlign: 'right', color: '#4a8fa8' }}>
                              {stat.total}
                            </td>
                            <td style={{
                              padding: '0.65rem 1rem', textAlign: 'right',
                              color: isTop ? '#eab308' : '#c8eef8',
                              fontWeight: 700,
                            }}>
                              {(stat.winRate * 100).toFixed(0)}%
                            </td>
                            <td style={{ padding: '0.65rem 1rem' }}>
                              <div style={{
                                height: '6px', background: '#081520', borderRadius: '3px',
                                overflow: 'hidden', width: '100%',
                              }}>
                                <div style={{
                                  height: '100%',
                                  background: isTop
                                    ? 'linear-gradient(90deg, #eab308, #00f0ff)'
                                    : modelColor,
                                  borderRadius: '3px',
                                  width: `${stat.winRate * 100}%`,
                                  transition: 'width 0.5s ease',
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

            {/* Section 3: Head-to-Head Matrix */}
            <div style={{
              border: '1px solid #0a2235',
              borderRadius: '8px',
              overflow: 'hidden',
              marginBottom: '2rem',
            }}>
              <div style={{
                background: '#010810',
                padding: '0.75rem 1rem',
                borderBottom: '1px solid #0a2235',
              }}>
                <span style={{
                  fontSize: '0.58rem', fontWeight: 700, color: '#4a8fa8',
                  textTransform: 'uppercase', letterSpacing: '2px',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                }}>
                  ⚔ Head-to-Head
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
                            padding: '0.6rem 0.75rem', textAlign: 'left',
                            fontSize: '0.52rem', color: '#1e4a5a', textTransform: 'uppercase',
                            letterSpacing: '1.5px', fontWeight: 700, minWidth: '130px',
                          }}>
                            vs →
                          </th>
                          {personas.map((p) => {
                            const icon = getModelIcon(p);
                            return (
                              <th key={p} style={{
                                padding: '0.6rem 0.75rem', textAlign: 'center',
                                fontSize: '0.56rem', color: getModelColor(p),
                                fontWeight: 700, whiteSpace: 'nowrap',
                              }}>
                                <span style={{ marginRight: '0.2rem' }}>{icon}</span> {p}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {personas.map((rowPersona) => (
                          <tr key={rowPersona} style={{ borderBottom: '1px solid rgba(10,34,53,0.5)' }}>
                            <td style={{
                              padding: '0.65rem 0.75rem',
                              color: getModelColor(rowPersona),
                              fontWeight: 700, whiteSpace: 'nowrap',
                            }}>
                              <span style={{ marginRight: '0.3rem' }}>{getModelIcon(rowPersona)}</span>
                              {rowPersona}
                            </td>
                            {personas.map((colPersona) => {
                              if (rowPersona === colPersona) {
                                return (
                                  <td key={colPersona} style={{
                                    padding: '0.65rem 0.75rem', textAlign: 'center',
                                    background: 'rgba(10,34,53,0.15)',
                                  }}>
                                    <span style={{
                                      display: 'inline-block', width: '18px', height: '2px',
                                      background: '#0e3050', borderRadius: '1px',
                                    }} />
                                  </td>
                                );
                              }
                              const cell = data.headToHead[rowPersona]?.[colPersona];
                              if (!cell) {
                                return (
                                  <td key={colPersona} style={{
                                    padding: '0.65rem 0.75rem', textAlign: 'center', color: '#0e3050',
                                  }}>
                                    —
                                  </td>
                                );
                              }
                              return (
                                <td key={colPersona} style={{
                                  padding: '0.65rem 0.75rem', textAlign: 'center',
                                  background: h2hCellBg(cell.wins, cell.losses),
                                }}>
                                  {cell.wins > 0 && (
                                    <span style={{ color: '#0066ff', fontWeight: 700 }}>{cell.wins}W</span>
                                  )}
                                  {cell.wins > 0 && cell.losses > 0 && (
                                    <span style={{ color: '#1e4a5a', margin: '0 0.2rem' }}>/</span>
                                  )}
                                  {cell.losses > 0 && (
                                    <span style={{ color: '#ef4444', fontWeight: 700 }}>{cell.losses}L</span>
                                  )}
                                  {cell.draws > 0 && (
                                    <span style={{
                                      color: '#4a8fa8', fontWeight: 700,
                                      marginLeft: cell.wins > 0 || cell.losses > 0 ? '0.25rem' : '0',
                                    }}>
                                      {cell.draws}D
                                    </span>
                                  )}
                                  {cell.wins === 0 && cell.losses === 0 && cell.draws === 0 && (
                                    <span style={{ color: '#0e3050' }}>—</span>
                                  )}
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

            {/* Section 4: By Format */}
            <div style={{ marginBottom: '2rem' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                marginBottom: '0.85rem',
              }}>
                <span style={{
                  fontSize: '0.58rem', fontWeight: 700, color: '#4a8fa8',
                  textTransform: 'uppercase', letterSpacing: '2px',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                }}>
                  🎯 By Format
                </span>
              </div>

              {(!data.byFormat || data.byFormat.length === 0) ? (
                <div style={{
                  color: '#4a8fa8', fontSize: '0.75rem',
                  padding: '2rem', textAlign: 'center',
                  background: '#050f1e', border: '1px solid #0a2235', borderRadius: '8px',
                }}>
                  No format data available.
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '0.75rem',
                }}>
                  {(data.byFormat ?? []).map((f) => {
                    const cfg = FORMAT_BADGE_CONFIG[f.format];
                    const color = cfg?.color ?? '#4a8fa8';
                    const icon = cfg?.icon ?? '📋';
                    const completionPct = f.total > 0 ? (f.completed / f.total) * 100 : 0;
                    return (
                      <div key={f.format} style={{
                        background: '#050f1e',
                        border: `1px solid ${color}33`,
                        borderTop: `3px solid ${color}`,
                        borderRadius: '8px',
                        padding: '1.1rem',
                        position: 'relative',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          position: 'absolute', top: '0.8rem', right: '0.8rem',
                          fontSize: '1.8rem', opacity: 0.08,
                        }}>
                          {icon}
                        </div>
                        <div style={{ marginBottom: '0.8rem' }}>
                          <FormatBadge format={f.format} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT }}>
                            <span style={{ color: '#4a8fa8' }}>Total</span>
                            <span style={{ color: '#c8eef8', fontWeight: 700 }}>{f.total}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: BODY_FONT_SIZE_SM, fontFamily: BODY_FONT }}>
                            <span style={{ color: '#4a8fa8' }}>Completed</span>
                            <span style={{ color: '#0066ff', fontWeight: 700 }}>{f.completed}</span>
                          </div>
                          {/* Completion progress bar */}
                          <div style={{
                            height: '3px', background: '#081520', borderRadius: '2px',
                            overflow: 'hidden', margin: '0.1rem 0',
                          }}>
                            <div style={{
                              height: '100%', background: color, borderRadius: '2px',
                              width: `${completionPct}%`,
                            }} />
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

            {/* Section 5: Recent Competitions */}
            <div style={{
              border: '1px solid #0a2235',
              borderRadius: '8px',
              overflow: 'hidden',
              marginBottom: '2rem',
            }}>
              <div style={{
                background: '#010810',
                padding: '0.75rem 1rem',
                borderBottom: '1px solid #0a2235',
              }}>
                <span style={{
                  fontSize: '0.58rem', fontWeight: 700, color: '#4a8fa8',
                  textTransform: 'uppercase', letterSpacing: '2px',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                }}>
                  📜 Recent Competitions
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
                            <a
                              href={`/competitions/${comp.id}`}
                              style={{
                                color: '#3b82f6', textDecoration: 'none', fontWeight: 600,
                                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                              }}
                            >
                              <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>🏆</span>
                              {comp.title}
                            </a>
                          </td>
                          <td style={{ padding: '0.65rem 1rem' }}>
                            <FormatBadge format={comp.format} />
                          </td>
                          <td style={{ padding: '0.65rem 1rem', color: '#4a8fa8' }}>
                            {comp.agents.length >= 2 ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                <span style={{ color: getModelColor(comp.agents[0]), fontWeight: 600 }}>
                                  {comp.agents[0]}
                                </span>
                                <span style={{ color: '#1e4a5a', fontSize: '0.58rem', fontWeight: 700 }}>VS</span>
                                <span style={{ color: getModelColor(comp.agents[1]), fontWeight: 600 }}>
                                  {comp.agents[1]}
                                </span>
                              </span>
                            ) : (
                              comp.agents.join(', ')
                            )}
                          </td>
                          <td style={{ padding: '0.65rem 1rem' }}>
                            {comp.winner ? (
                              <span style={{
                                color: winnerColor, fontWeight: 700,
                                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                              }}>
                                <span style={{ color: '#eab308' }}>★</span> {comp.winner}
                              </span>
                            ) : (
                              <span style={{ color: '#0e3050' }}>—</span>
                            )}
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
        )}
      </div>
    </div>
  );
}
