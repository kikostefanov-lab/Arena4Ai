import { orchestratorUrl } from '../../lib/orchestrator';

interface ModelStat {
  model: string;
  wins: number;
  total: number;
  winRate: number;
}

interface AnalyticsSummary {
  totalCompetitions: number;
  completedCompetitions: number;
  completionRate: number;
  avgDurationMs: number | null;
  byModel: ModelStat[];
  synthesisCount: number;
}

async function getAnalytics(): Promise<AnalyticsSummary | null> {
  try {
    const res = await fetch(orchestratorUrl('/analytics/summary'), {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export default async function AnalyticsPage() {
  const data = await getAnalytics();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-mono p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 flex items-center gap-4">
          <a href="/" className="text-slate-500 hover:text-slate-300 text-sm">← Gallery</a>
          <h1 className="text-orange-400 font-bold tracking-widest uppercase text-sm">
            ◆ Analytics
          </h1>
        </div>

        {!data ? (
          <div className="text-slate-500 text-sm">
            Could not reach orchestrator. Is it running?
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
              {[
                { label: 'Total', value: data.totalCompetitions },
                { label: 'Completed', value: data.completedCompetitions },
                { label: 'Avg Duration', value: formatDuration(data.avgDurationMs) },
                { label: 'Syntheses', value: data.synthesisCount },
              ].map(({ label, value }) => (
                <div key={label} className="border border-slate-800 rounded-lg p-4 bg-slate-900">
                  <div className="text-slate-500 text-xs uppercase tracking-widest mb-1">{label}</div>
                  <div className="text-2xl font-bold text-slate-100">{value}</div>
                </div>
              ))}
            </div>

            <div className="border border-slate-800 rounded-lg overflow-hidden">
              <div className="bg-slate-900 px-4 py-3 border-b border-slate-800">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  Win Rate by Model
                </span>
              </div>
              {data.byModel.length === 0 ? (
                <div className="p-6 text-slate-500 text-sm text-center">
                  No completed competitions yet.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left px-4 py-2 text-slate-500 text-xs uppercase">Model</th>
                      <th className="text-right px-4 py-2 text-slate-500 text-xs uppercase">Wins</th>
                      <th className="text-right px-4 py-2 text-slate-500 text-xs uppercase">Total</th>
                      <th className="text-right px-4 py-2 text-slate-500 text-xs uppercase">Win Rate</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModel.map((stat) => (
                      <tr key={stat.model} className="border-b border-slate-800/50 hover:bg-slate-900/50">
                        <td className="px-4 py-3 text-orange-400 font-bold">{stat.model}</td>
                        <td className="px-4 py-3 text-right text-slate-300">{stat.wins}</td>
                        <td className="px-4 py-3 text-right text-slate-400">{stat.total}</td>
                        <td className="px-4 py-3 text-right text-slate-200 font-bold">
                          {(stat.winRate * 100).toFixed(0)}%
                        </td>
                        <td className="px-4 py-3">
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden w-24">
                            <div
                              className="h-full bg-orange-500 rounded-full"
                              style={{ width: `${stat.winRate * 100}%` }}
                            />
                          </div>
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
