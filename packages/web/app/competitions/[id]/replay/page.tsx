'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface ArenaEvent {
  id: string;
  competitionId: string;
  teamId: string;
  timestamp: string;
  type: string;
  payload: Record<string, unknown> | null;
  seq: number;
}

const EVENT_COLORS: Record<string, string> = {
  TOOL_CALL: 'text-blue-400',
  FILE_CREATE: 'text-green-400',
  FILE_MODIFY: 'text-yellow-400',
  ERROR: 'text-red-400',
  REASONING: 'text-slate-400',
  TIME_WARNING: 'text-orange-400',
  TIME_UP: 'text-red-500',
  JUDGE_SCORE: 'text-purple-400',
  COMPETITION_START: 'text-cyan-400',
  COMPETITION_COMPLETE: 'text-cyan-400',
};

const SPEEDS = [1, 2, 4, 10] as const;
type Speed = (typeof SPEEDS)[number];

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const [allEvents, setAllEvents] = useState<ArenaEvent[]>([]);
  const [visibleEvents, setVisibleEvents] = useState<ArenaEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const teamARef = useRef<HTMLDivElement>(null);
  const teamBRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/competitions/${id}/events`)
      .then((r) => r.json())
      .then((events: ArenaEvent[]) => {
        setAllEvents(events);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  const tick = useCallback(() => {
    setCursor((prev) => {
      const next = Math.min(prev + speed, allEvents.length);
      setVisibleEvents(allEvents.slice(0, next));
      if (next >= allEvents.length) {
        setPlaying(false);
      }
      return next;
    });
  }, [allEvents, speed]);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(tick, 200);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, tick]);

  useEffect(() => {
    teamARef.current?.scrollTo({ top: teamARef.current.scrollHeight, behavior: 'smooth' });
    teamBRef.current?.scrollTo({ top: teamBRef.current.scrollHeight, behavior: 'smooth' });
  }, [visibleEvents]);

  const handleScrub = (value: number) => {
    const idx = Math.round(value);
    setCursor(idx);
    setVisibleEvents(allEvents.slice(0, idx));
  };

  const teams = [...new Set(allEvents.map((e) => e.teamId))].sort();
  const teamA = teams[0] ?? 'team-a';
  const teamB = teams[1] ?? 'team-b';

  const eventsForTeam = (teamId: string) =>
    visibleEvents.filter((e) => e.teamId === teamId);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-mono text-sm">
        Loading replay...
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-red-400 font-mono text-sm">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-mono flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4 flex items-center gap-4">
        <a href={`/competitions/${id}`} className="text-slate-500 hover:text-slate-300 text-sm">
          ← Back to Live View
        </a>
        <span className="text-slate-600">|</span>
        <span className="text-orange-400 font-bold text-sm tracking-widest uppercase">
          ▶ Replay
        </span>
        <span className="text-slate-500 text-xs ml-auto">
          {allEvents.length} events total
        </span>
      </div>

      {/* Controls */}
      <div className="px-6 py-3 border-b border-slate-800 flex items-center gap-4 flex-wrap">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="px-4 py-1.5 rounded text-xs font-bold border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40"
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>

        <button
          onClick={() => { setCursor(0); setVisibleEvents([]); setPlaying(false); }}
          className="px-3 py-1.5 rounded text-xs border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-400"
        >
          ↩ Reset
        </button>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-1 rounded text-xs border transition-colors ${
                speed === s
                  ? 'border-orange-500 bg-orange-500/20 text-orange-400'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-slate-500 text-xs shrink-0">{cursor}</span>
          <input
            type="range"
            min={0}
            max={allEvents.length}
            value={cursor}
            onChange={(e) => handleScrub(Number(e.target.value))}
            className="flex-1 accent-orange-500 min-w-0"
          />
          <span className="text-slate-500 text-xs shrink-0">{allEvents.length}</span>
        </div>
      </div>

      {/* Lane view */}
      <div className="flex-1 grid grid-cols-2 min-h-0" style={{ minHeight: '0' }}>
        {[teamA, teamB].map((teamId, idx) => (
          <div
            key={teamId}
            className={`flex flex-col min-h-0 ${idx === 0 ? 'border-r border-slate-800' : ''}`}
          >
            <div className="px-4 py-2 border-b border-slate-800 bg-slate-900 flex items-center gap-2 shrink-0">
              <div
                className={`w-2 h-2 rounded-full ${idx === 0 ? 'bg-orange-400' : 'bg-blue-400'}`}
              />
              <span className="text-xs font-bold">{teamId}</span>
              <span className="text-slate-600 text-xs ml-auto">
                {eventsForTeam(teamId).length} events
              </span>
            </div>
            <div
              ref={idx === 0 ? teamARef : teamBRef}
              className="flex-1 overflow-y-auto p-3 space-y-0.5"
            >
              {eventsForTeam(teamId).map((event) => (
                <div key={event.id} className="flex gap-2 text-xs py-0.5">
                  <span className="text-slate-600 min-w-[40px] font-mono">
                    {event.seq}
                  </span>
                  <span
                    className={`font-bold min-w-[120px] ${
                      EVENT_COLORS[event.type] ?? 'text-slate-500'
                    }`}
                  >
                    {event.type}
                  </span>
                  <span className="text-slate-500 truncate">
                    {event.payload
                      ? JSON.stringify(event.payload).slice(0, 80)
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
