import { orchestratorUrl, orchestratorHeaders } from '../../lib/orchestrator';
import { formatDuration } from '../../lib/format';

interface AgentStat {
  model: string; // may be "claude:speedrunner" or just "claude"
  wins: number;
  total: number;
  winRate: number;
}

interface AnalyticsSummary {
  totalCompetitions: number;
  completedCompetitions: number;
  completionRate: number;
  avgDurationMs: number | null;
  byModel: AgentStat[];
  synthesisCount: number;
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

export default async function AnalyticsPage() {
  const data = await getAnalytics();

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0e17',
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      color: '#e2e8f0',
    }}>
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2.5rem 1.5rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
          <a href="/" style={{ fontSize: '0.62rem', color: '#8896ab', textDecoration: 'none', letterSpacing: '0.5px', transition: 'color 0.15s' }}>
            ← Gallery
          </a>
          <span style={{ color: '#1e2d45' }}>│</span>
          <span style={{ fontSize: '0.62rem', color: '#f97316', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase' }}>
            ◆ Analytics
          </span>
        </div>

        {!data ? (
          <div style={{ color: '#8896ab', fontSize: '0.75rem' }}>
            Could not reach orchestrator. Is it running?
          </div>
        ) : (
          <>
            {/* Stat tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '2rem' }}>
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

            {/* Win rate table */}
            <div style={{ border: '1px solid #1e2d45', borderRadius: '6px', overflow: 'hidden' }}>
              <div style={{ background: '#0d1520', padding: '0.75rem 1rem', borderBottom: '1px solid #1e2d45', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#8896ab', textTransform: 'uppercase', letterSpacing: '2px' }}>
                  Win Rate by Agent
                </span>
                <span style={{ fontSize: '0.55rem', color: '#4a5568' }}>model:persona</span>
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
                        <tr
                          key={stat.model}
                          style={{ borderBottom: '1px solid rgba(30,45,69,0.6)' }}
                        >
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
          </>
        )}
      </div>
    </div>
  );
}
