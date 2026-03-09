'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface CompetitionSummary {
  id: string;
  state: string;
  startedAt: string | null;
  brief: { title: string };
  teams: Array<{ model: string }>;
}

export default function GalleryPage() {
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/competitions')
      .then((r) => r.json())
      .then((data: CompetitionSummary[]) => { setCompetitions(data); setLoading(false); })
      .catch(() => { setError('Failed to load competitions — is the API server running?'); setLoading(false); });
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Agent Arena</h1>
          <p className="text-gray-400 text-sm mt-1">AI agent head-to-head competitions</p>
        </div>
        <Link
          href="/competitions/new"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded transition-colors"
        >
          New Competition
        </Link>
      </div>

      {loading && <p className="text-gray-600 text-sm">Loading...</p>}

      {!loading && error && (
        <p className="text-red-400 text-sm text-center py-8">{error}</p>
      )}

      {!loading && competitions.length === 0 && (
        <div className="text-center py-20 text-gray-600">
          <p className="text-lg mb-2">No competitions yet</p>
          <Link href="/competitions/new" className="text-blue-400 hover:text-blue-300 text-sm">
            Run your first competition →
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {competitions.map((comp) => (
          <Link
            key={comp.id}
            href={`/competitions/${comp.id}`}
            className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-white font-medium">{comp.brief?.title ?? comp.id}</h2>
                <p className="text-gray-500 text-xs mt-1 font-mono">
                  {comp.teams?.map((t) => t.model).join(' vs ')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {comp.startedAt && (
                  <span className="text-gray-600 text-xs">
                    {new Date(comp.startedAt).toLocaleDateString()}
                  </span>
                )}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  comp.state === 'COMPLETE' ? 'bg-blue-900 text-blue-300' :
                  comp.state === 'RUNNING' ? 'bg-green-900 text-green-300' :
                  'bg-gray-700 text-gray-300'
                }`}>
                  {comp.state}
                </span>
                {comp.state === 'COMPLETE' && (
                  <a
                    href={`/competitions/${comp.id}/replay`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-slate-500 hover:text-orange-400 font-mono ml-auto"
                  >
                    ▶ Replay
                  </a>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
