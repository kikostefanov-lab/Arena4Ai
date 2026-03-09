import { orchestratorUrl, orchestratorHeaders } from '../../lib/orchestrator';
import { formatDuration } from '../../lib/format';

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

const FORMAT_BADGE_COLORS: Record<string, string> = {
  SPRINT: '#06b6d4',
  HACKATHON: '#a855f7',
  RELAY_RACE: '#22c55e',
  RED_VS_BLUE: '#ef4444',
};

function FormatBadge({ format }: { format: string | null }) {
  if (!format) return <span style={{ color: '#2d4060' }}>—</span>;
  const color = FORMAT_BADGE_COLORS[format] ?? '#8896ab';
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.15rem 0.45rem',
      borderRadius: '3px',
      background: `${color}1a`,
      border: `1px solid ${color}55`,
      color,
      fontSize: '0.58rem',
      fontWeight: 700,
      letterSpacing: '1px',
      textTransform: 'uppercase',
    }}>
      {format}
    </span>
  );
}

export default async function AnalyticsPage() {
  const data = await getAnalytics();

  const sectionHeaderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    marginBottom: '0.75rem',
  };

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: '0.58rem',
    fontWeight: 700,
    color: '#8896ab',
    textTransform: 'uppercase',
    letterSpacing: '2px',
  };

  const cardStyle: React.CSSProperties = {
    border: '1px solid #1e2d45',
    borderRadius: '6px',
    overflow: 'hidden',
    marginBottom: '1.75rem',
  };

  const cardHeaderStyle: React.CSSProperties = {
    background: '#0d1520',
    padding: '0.75rem 1rem',
    borderBottom: '1px solid #1e2d45',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
          <a href="/" style={{ fontSize: '0.62rem', color: '#8896ab', textDecoration: 'none', letterSpacing: '0.5px' }}>
            ← Gallery
          </a>
          <span style={{ color: '#1e2d45' }}>│</span>
          <span style={{ fontSize: '0.62rem', color: '#f97316', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase' }}>
            ◆ ANALYTICS
          </span>
        </div>

        {!data ? (
          <div style={{ color: '#8896ab', fontSize: '0.75rem' }}>
            Could not reach orchestrator. Is it running?
          </div>
        ) : (
          <>
            {/* Section 1: Overview tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.75rem' }}>
              {[
                { label: 'Total', value: data.totalCompetitions },
                { label: 'Completed', value: data.completedCompetitions },
                { label: 'Avg Duration', value: formatDuration(data.avgDurationMs) },
                { label: 'Syntheses', value: data.synthesisCount },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  background: '#111827',
                  border: '1px solid #1e2d45',
                  borderRadius: '6px',
                  padding: '1rem',
                }}>
                  <div style={{ fontSize: '0.55rem', color: '#8896ab', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '0.4rem', fontWeight: 700 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#e2e8f0' }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Section 2: Win Rate by Agent */}
            <div style={cardStyle}>
              <div style={cardHeaderStyle}>
                <div style={sectionHeaderStyle}>
                  <span style={sectionLabelStyle}>▸ Win Rate by Agent</span>
                  <span style={{ fontSize: '0.55rem', color: '#4a5568' }}>model:persona</span>
                </div>
              </div>

              {data.byModel.length === 0 ? (
                <div style={{ padding: '2.5rem', color: '#8896ab', fontSize: '0.75rem', textAlign: 'center' }}>
                  No completed competitions yet.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e2d45' }}>
                      <th style={{ textAlign: 'left', padding: '0.55rem 1rem', fontSize: '0.58rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Model</th>
                      <th style={{ textAlign: 'left', padding: '0.55rem 1rem', fontSize: '0.58rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Persona</th>
                      <th style={{ textAlign: 'right', padding: '0.55rem 1rem', fontSize: '0.58rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>W</th>
                      <th style={{ textAlign: 'right', padding: '0.55rem 1rem', fontSize: '0.58rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Total</th>
                      <th style={{ textAlign: 'right', padding: '0.55rem 1rem', fontSize: '0.58rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Win %</th>
                      <th style={{ padding: '0.55rem 1rem', width: '7rem' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModel.map((stat) => {
                      const { model, persona } = parseAgentKey(stat.model);
                      return (
                        <tr key={stat.model} style={{ borderBottom: '1px solid rgba(30,45,69,0.6)' }}>
                          <td style={{ padding: '0.6rem 1rem', color: '#f97316', fontWeight: 700 }}>{model}</td>
                          <td style={{ padding: '0.6rem 1rem', color: '#8896ab' }}>
                            {persona ?? <span style={{ color: '#2d4060' }}>—</span>}
                          </td>
                          <td style={{ padding: '0.6rem 1rem', textAlign: 'right', color: '#e2e8f0' }}>{stat.wins}</td>
                          <td style={{ padding: '0.6rem 1rem', textAlign: 'right', color: '#8896ab' }}>{stat.total}</td>
                          <td style={{ padding: '0.6rem 1rem', textAlign: 'right', color: '#e2e8f0', fontWeight: 700 }}>
                            {(stat.winRate * 100).toFixed(0)}%
                          </td>
                          <td style={{ padding: '0.6rem 1rem' }}>
                            <div style={{ height: '4px', background: '#1e2d45', borderRadius: '2px', overflow: 'hidden', width: '100%' }}>
                              <div style={{ height: '100%', background: '#f97316', borderRadius: '2px', width: `${stat.winRate * 100}%` }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Section 3: Head-to-Head Matrix */}
            <div style={cardStyle}>
              <div style={cardHeaderStyle}>
                <span style={sectionLabelStyle}>▸ HEAD-TO-HEAD</span>
              </div>

              {(!data.headToHead || Object.keys(data.headToHead).length === 0) ? (
                <div style={{ padding: '2.5rem', color: '#8896ab', fontSize: '0.75rem', textAlign: 'center' }}>
                  Not enough data
                </div>
              ) : (() => {
                const personas = Object.keys(data.headToHead);
                return (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.68rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #1e2d45' }}>
                          <th style={{ padding: '0.55rem 0.75rem', textAlign: 'left', fontSize: '0.55rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600, minWidth: '130px' }}>
                            vs →
                          </th>
                          {personas.map((p) => (
                            <th key={p} style={{ padding: '0.55rem 0.75rem', textAlign: 'center', fontSize: '0.58rem', color: '#8896ab', fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {p}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {personas.map((rowPersona) => (
                          <tr key={rowPersona} style={{ borderBottom: '1px solid rgba(30,45,69,0.6)' }}>
                            <td style={{ padding: '0.6rem 0.75rem', color: '#f97316', fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {rowPersona}
                            </td>
                            {personas.map((colPersona) => {
                              if (rowPersona === colPersona) {
                                return (
                                  <td key={colPersona} style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: '#2d4060' }}>
                                    —
                                  </td>
                                );
                              }
                              const cell = data.headToHead[rowPersona]?.[colPersona];
                              if (!cell) {
                                return (
                                  <td key={colPersona} style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: '#2d4060' }}>
                                    —
                                  </td>
                                );
                              }
                              return (
                                <td key={colPersona} style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                                  {cell.wins > 0 && (
                                    <span style={{ color: '#22c55e', fontWeight: 700 }}>{cell.wins}W</span>
                                  )}
                                  {cell.wins > 0 && cell.losses > 0 && (
                                    <span style={{ color: '#8896ab', margin: '0 0.2rem' }}> </span>
                                  )}
                                  {cell.losses > 0 && (
                                    <span style={{ color: '#ef4444', fontWeight: 700 }}>{cell.losses}L</span>
                                  )}
                                  {cell.draws > 0 && (
                                    <span style={{ color: '#8896ab', fontWeight: 700, marginLeft: cell.wins > 0 || cell.losses > 0 ? '0.2rem' : '0' }}>
                                      {cell.draws}D
                                    </span>
                                  )}
                                  {cell.wins === 0 && cell.losses === 0 && cell.draws === 0 && (
                                    <span style={{ color: '#2d4060' }}>—</span>
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
            <div style={{ marginBottom: '1.75rem' }}>
              <div style={{ ...sectionHeaderStyle, marginBottom: '0.75rem' }}>
                <span style={sectionLabelStyle}>▸ BY FORMAT</span>
              </div>

              {(!data.byFormat || data.byFormat.length === 0) ? (
                <div style={{ color: '#8896ab', fontSize: '0.75rem' }}>No format data available.</div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '0.75rem',
                }}>
                  {(data.byFormat ?? []).map((f) => {
                    const color = FORMAT_BADGE_COLORS[f.format] ?? '#8896ab';
                    return (
                      <div key={f.format} style={{
                        background: '#111827',
                        border: `1px solid ${color}33`,
                        borderRadius: '6px',
                        padding: '1rem',
                      }}>
                        <div style={{ marginBottom: '0.6rem' }}>
                          <FormatBadge format={f.format} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                            <span style={{ color: '#8896ab' }}>Total</span>
                            <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{f.total}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                            <span style={{ color: '#8896ab' }}>Completed</span>
                            <span style={{ color: '#22c55e', fontWeight: 700 }}>{f.completed}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem' }}>
                            <span style={{ color: '#8896ab' }}>Avg Duration</span>
                            <span style={{ color: '#e2e8f0' }}>{formatDuration(f.avgDurationMs)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section 5: Recent Competitions */}
            <div style={cardStyle}>
              <div style={cardHeaderStyle}>
                <span style={sectionLabelStyle}>▸ RECENT COMPETITIONS</span>
              </div>

              {(!data.recentCompetitions || data.recentCompetitions.length === 0) ? (
                <div style={{ padding: '2.5rem', color: '#8896ab', fontSize: '0.75rem', textAlign: 'center' }}>
                  No completed competitions yet.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e2d45' }}>
                      <th style={{ textAlign: 'left', padding: '0.55rem 1rem', fontSize: '0.58rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Title</th>
                      <th style={{ textAlign: 'left', padding: '0.55rem 1rem', fontSize: '0.58rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Format</th>
                      <th style={{ textAlign: 'left', padding: '0.55rem 1rem', fontSize: '0.58rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Agents</th>
                      <th style={{ textAlign: 'left', padding: '0.55rem 1rem', fontSize: '0.58rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Winner</th>
                      <th style={{ textAlign: 'right', padding: '0.55rem 1rem', fontSize: '0.58rem', color: '#4a5568', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.recentCompetitions ?? []).map((comp) => (
                      <tr key={comp.id} style={{ borderBottom: '1px solid rgba(30,45,69,0.6)' }}>
                        <td style={{ padding: '0.6rem 1rem' }}>
                          <a
                            href={`/competitions/${comp.id}`}
                            style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 600 }}
                          >
                            {comp.title}
                          </a>
                        </td>
                        <td style={{ padding: '0.6rem 1rem' }}>
                          <FormatBadge format={comp.format} />
                        </td>
                        <td style={{ padding: '0.6rem 1rem', color: '#8896ab' }}>
                          {comp.agents.length >= 2
                            ? <>{comp.agents[0]} <span style={{ color: '#2d4060' }}>vs</span> {comp.agents[1]}</>
                            : comp.agents.join(', ')}
                        </td>
                        <td style={{ padding: '0.6rem 1rem' }}>
                          {comp.winner ? (
                            <span style={{ color: '#f97316', fontWeight: 700 }}>★ {comp.winner}</span>
                          ) : (
                            <span style={{ color: '#2d4060' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '0.6rem 1rem', textAlign: 'right', color: '#8896ab' }}>
                          {formatDuration(comp.durationMs)}
                        </td>
                      </tr>
                    ))}
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
