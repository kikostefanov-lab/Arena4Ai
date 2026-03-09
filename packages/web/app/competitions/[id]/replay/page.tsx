'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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

interface Team {
  id: string;
  model: string;
  persona?: string;
}

const EVENT_COLOR: Record<string, string> = {
  TOOL_CALL:           '#3b82f6',
  FILE_CREATE:         '#22c55e',
  FILE_MODIFY:         '#10b981',
  ERROR:               '#ef4444',
  REASONING:           '#8896ab',
  TIME_WARNING:        '#eab308',
  TIME_UP:             '#f97316',
  JUDGE_SCORE:         '#a855f7',
  COMPETITION_START:   '#06b6d4',
  COMPETITION_COMPLETE:'#06b6d4',
};

const SPEEDS = [1, 2, 4, 10] as const;
type Speed = (typeof SPEEDS)[number];

function teamLabel(teams: Team[], teamId: string): string {
  const t = teams.find((x) => x.id === teamId);
  if (!t) return teamId;
  return t.persona ? `${t.model}:${t.persona}` : t.model;
}

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const [allEvents, setAllEvents] = useState<ArenaEvent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [briefTitle, setBriefTitle] = useState('');
  const [cursor, setCursor] = useState(0);
  const visibleEvents = useMemo(() => allEvents.slice(0, cursor), [allEvents, cursor]);
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
      .then((data: unknown) => {
        if (!Array.isArray(data)) {
          setError((data as Record<string, unknown>)?.error as string ?? 'Unexpected response');
        } else {
          setAllEvents(data as ArenaEvent[]);
        }
        setLoading(false);
      })
      .catch((err: Error) => { setError(err.message); setLoading(false); });
  }, [id]);

  useEffect(() => {
    fetch(`/api/competitions/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { teams?: Team[]; brief?: { title?: string } } | null) => {
        if (!data) return;
        if (Array.isArray(data.teams)) setTeams(data.teams);
        if (data.brief?.title) setBriefTitle(data.brief.title);
      })
      .catch(() => { /* non-critical */ });
  }, [id]);

  const tick = useCallback(() => {
    setCursor((prev) => {
      const next = Math.min(prev + speed, allEvents.length);
      if (next >= allEvents.length) setPlaying(false);
      return next;
    });
  }, [allEvents.length, speed]);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(tick, 200);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, tick]);

  useEffect(() => {
    teamARef.current?.scrollTo({ top: teamARef.current.scrollHeight, behavior: 'smooth' });
    teamBRef.current?.scrollTo({ top: teamBRef.current.scrollHeight, behavior: 'smooth' });
  }, [visibleEvents]);

  const eventTeams = [...new Set(allEvents.map((e) => e.teamId))].sort();
  const teamAId = eventTeams[0] ?? 'team-a';
  const teamBId = eventTeams[1] ?? 'team-b';
  const eventsFor = (tid: string) => visibleEvents.filter((e) => e.teamId === tid);

  const font = "'SF Mono', 'Fira Code', 'Cascadia Code', monospace";

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0e17', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: font, color: '#8896ab', fontSize: '0.75rem' }}>
      Loading replay…
    </div>
  );

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0a0e17', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: font, color: '#ef4444', fontSize: '0.75rem' }}>
      {error}
    </div>
  );

  if (allEvents.length === 0) return (
    <div style={{ minHeight: '100vh', background: '#0a0e17', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: font, color: '#8896ab', fontSize: '0.75rem' }}>
      No events to replay for this competition.
    </div>
  );

  const pct = allEvents.length > 0 ? (cursor / allEvents.length) * 100 : 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden',
      background: '#0a0e17', fontFamily: font, color: '#e2e8f0',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.55rem 1.25rem', borderBottom: '1px solid #1e2d45',
        background: 'rgba(10,14,23,0.95)', flexShrink: 0,
      }}>
        <a href="/" style={{ fontSize: '0.6rem', color: '#f97316', fontWeight: 700, letterSpacing: '2px', textDecoration: 'none', flexShrink: 0 }}>
          ◆ ARENA
        </a>
        <span style={{ color: '#1e2d45' }}>│</span>
        <a
          href={`/competitions/${id}`}
          style={{ fontSize: '0.62rem', color: '#8896ab', textDecoration: 'none', letterSpacing: '0.5px' }}
        >
          ← Live
        </a>
        <span style={{ color: '#1e2d45' }}>│</span>
        {briefTitle && (
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#e2e8f0' }}>{briefTitle}</span>
        )}
        <span style={{ fontSize: '0.6rem', color: '#f97316', fontWeight: 700, letterSpacing: '1.5px' }}>▶ REPLAY</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.58rem', color: '#4a5568' }}>
          {allEvents.length} events
        </span>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
        padding: '0.6rem 1.25rem', borderBottom: '1px solid #1e2d45',
        background: '#0d1520', flexShrink: 0,
      }}>
        {/* Play/Pause */}
        <button
          onClick={() => setPlaying((p) => !p)}
          style={{
            fontSize: '0.65rem', fontWeight: 700, padding: '0.35rem 0.85rem',
            background: playing ? 'rgba(249,115,22,0.12)' : 'rgba(34,197,94,0.12)',
            color: playing ? '#f97316' : '#22c55e',
            border: `1px solid ${playing ? '#f97316' : '#22c55e'}`,
            borderRadius: '4px', cursor: 'pointer', fontFamily: font, letterSpacing: '0.5px',
          }}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>

        {/* Reset */}
        <button
          onClick={() => { setCursor(0); setPlaying(false); }}
          style={{
            fontSize: '0.65rem', padding: '0.35rem 0.75rem',
            background: 'transparent', color: '#8896ab',
            border: '1px solid #1e2d45', borderRadius: '4px',
            cursor: 'pointer', fontFamily: font,
          }}
        >
          ↩ Reset
        </button>

        {/* Speed */}
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              style={{
                fontSize: '0.62rem', fontWeight: 700, padding: '0.3rem 0.55rem',
                background: speed === s ? 'rgba(249,115,22,0.12)' : 'transparent',
                color: speed === s ? '#f97316' : '#8896ab',
                border: `1px solid ${speed === s ? '#f97316' : '#1e2d45'}`,
                borderRadius: '3px', cursor: 'pointer', fontFamily: font,
              }}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* Scrubber */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
          <span style={{ fontSize: '0.6rem', color: '#4a5568', minWidth: '2.5rem', textAlign: 'right', flexShrink: 0 }}>
            {cursor}
          </span>
          <div style={{ flex: 1, position: 'relative', height: '4px', background: '#1e2d45', borderRadius: '2px', minWidth: 0 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: '#f97316', borderRadius: '2px' }} />
            <input
              type="range" min={0} max={allEvents.length} value={cursor}
              onChange={(e) => { setPlaying(false); setCursor(Math.round(Number(e.target.value))); }}
              style={{
                position: 'absolute', top: '-6px', left: 0, width: '100%', height: '16px',
                opacity: 0, cursor: 'pointer', margin: 0,
              }}
            />
          </div>
          <span style={{ fontSize: '0.6rem', color: '#4a5568', minWidth: '2.5rem', flexShrink: 0 }}>
            {allEvents.length}
          </span>
        </div>
      </div>

      {/* Lane view */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {[{ tid: teamAId, ref: teamARef, color: '#3b82f6' }, { tid: teamBId, ref: teamBRef, color: '#a855f7' }].map(({ tid, ref, color }, idx) => (
          <div key={tid} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: idx === 0 ? '1px solid #1e2d45' : 'none' }}>
            <div style={{
              padding: '0.55rem 1rem', background: '#0d1520', borderBottom: '1px solid #1e2d45',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
            }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color }}>
                {teams.length > 0 ? teamLabel(teams, tid) : tid}
              </span>
              <span style={{ fontSize: '0.58rem', color: '#4a5568' }}>{eventsFor(tid).length} events</span>
            </div>
            <div ref={ref} style={{ flex: 1, overflowY: 'auto', padding: '0.4rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '1px' }}>
              {eventsFor(tid).map((ev) => (
                <div key={ev.id} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.63rem', padding: '1px 0', lineHeight: 1.5 }}>
                  <span style={{ color: '#2d4060', minWidth: '2.5rem', textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {ev.seq}
                  </span>
                  <span style={{ fontWeight: 700, color: EVENT_COLOR[ev.type] ?? '#8896ab', minWidth: '9rem', flexShrink: 0 }}>
                    {ev.type}
                  </span>
                  <span style={{ color: '#4a5568', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.payload ? JSON.stringify(ev.payload).slice(0, 80) : ''}
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
