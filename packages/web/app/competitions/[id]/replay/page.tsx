'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Constants ───────────────────────────────────────────────────────────────

const FONT = "'SF Mono', 'Fira Code', 'Cascadia Code', monospace";

const EVENT_COLOR: Record<string, string> = {
  TOOL_CALL:            '#3b82f6',
  FILE_CREATE:          '#22c55e',
  FILE_MODIFY:          '#10b981',
  REASONING:            '#06b6d4',
  ERROR:                '#ef4444',
  TIME_WARNING:         '#eab308',
  TIME_UP:              '#f97316',
  JUDGE_SCORE:          '#a855f7',
  COMPETITION_START:    '#06b6d4',
  COMPETITION_COMPLETE: '#06b6d4',
};

const HIST_COLORS: Record<string, string> = {
  TOOL_CALL:   '#3b82f6',
  FILE_CREATE: '#22c55e',
  FILE_MODIFY: '#10b981',
  REASONING:   '#06b6d4',
  ERROR:       '#ef4444',
};

// ─── Event classification (same as arena page) ────────────────────────────────

interface EventInfo {
  label: string;
  icon: string;
  color: string;
  bg: string;
  text: string;
}

function getToolIcon(toolName: string): string {
  const n = toolName.toLowerCase();
  if (/bash|shell|run|exec|command/.test(n)) return '⚡';
  if (/write|create|save/.test(n)) return '✍️';
  if (/read|cat|view|open/.test(n)) return '👁️';
  if (/search|grep|find|glob/.test(n)) return '🔍';
  if (/python|py|node|js/.test(n)) return '🐍';
  if (/edit|replace|patch|str/.test(n)) return '✏️';
  if (/web|http|fetch|curl|url/.test(n)) return '🌐';
  if (/list|ls|dir/.test(n)) return '📂';
  if (/git/.test(n)) return '🔀';
  return '🔧';
}

function toolCommentary(toolName: string, valStr: string): string {
  const n = toolName.toLowerCase();
  if (/bash|shell|run|exec/.test(n)) return `$ ${valStr}`;
  if (/write|create/.test(n)) return `Writing to ${valStr}`;
  if (/read|cat|view/.test(n)) return `Reading ${valStr}`;
  if (/search|grep|find/.test(n)) return `Searching: ${valStr}`;
  if (/edit|replace|patch|str/.test(n)) return `Patching ${valStr}`;
  if (/glob/.test(n)) return `Glob: ${valStr}`;
  return valStr ? `${toolName}: ${valStr}` : toolName;
}

function classifyEvent(type: string, payload: Record<string, unknown> | null): EventInfo | null {
  const p = payload;
  if (!p) return null;

  switch (type) {
    case 'TOOL_CALL': {
      const tool = String(p.tool ?? 'unknown');
      const input = (p.input ?? {}) as Record<string, unknown>;
      const val = input.command ?? input.code ?? input.path ?? input.query ?? input.content;
      const valStr = val ? String(val).replace(/\n/g, ' ').trim().slice(0, 80) : '';
      const keys = Object.keys(input);
      const text = toolCommentary(tool, valStr || (keys.length ? `${keys[0]}=…` : ''));
      return { label: tool.toUpperCase().slice(0, 8), icon: getToolIcon(tool), color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', text };
    }
    case 'FILE_CREATE': {
      const text = String(p.text ?? p.path ?? '');
      const m = text.match(/(\/?(?:[\w.-]+\/)*[\w.-]+\.\w+)/);
      return { label: 'CREATE', icon: '📄', color: '#22c55e', bg: 'rgba(34,197,94,0.08)', text: `New file: ${m ? m[1] : text.slice(0, 80)}` };
    }
    case 'FILE_MODIFY': {
      const text = String(p.text ?? p.path ?? '');
      const m = text.match(/(\/?(?:[\w.-]+\/)*[\w.-]+\.\w+)/);
      return { label: 'MODIFY', icon: '✏️', color: '#10b981', bg: 'rgba(16,185,129,0.08)', text: `Modified: ${m ? m[1] : text.slice(0, 80)}` };
    }
    case 'REASONING': {
      if (p.text && typeof p.text === 'string') {
        return { label: 'THINK', icon: '🧠', color: '#06b6d4', bg: 'rgba(6,182,212,0.06)', text: p.text.trim().slice(0, 160) };
      }
      if (p.raw) {
        const raw = p.raw as Record<string, unknown>;
        if (raw.type === 'system' || raw.type === 'rate_limit_event') return null;
        if (raw.type === 'user') {
          const msg = raw.message as Record<string, unknown> | null;
          const content = msg?.content;
          if (Array.isArray(content)) {
            const toolResult = (content as Record<string, unknown>[]).find((b) => b.type === 'tool_result');
            if (toolResult?.content && typeof toolResult.content === 'string') {
              const resultText = toolResult.content.replace(/\n/g, ' ').trim();
              const isErr = /error|failed|exception|traceback|command not found/i.test(resultText);
              return { label: isErr ? 'FAIL' : 'RESULT', icon: isErr ? '❌' : '✅', color: isErr ? '#ef4444' : '#22c55e', bg: isErr ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.06)', text: resultText.slice(0, 160) };
            }
          }
          return null;
        }
        if (raw.type === 'result') {
          const res = raw.result;
          const resText = res && typeof res === 'string' ? res.trim() : null;
          if (!resText) return null;
          return { label: 'DONE', icon: '🏁', color: '#f97316', bg: 'rgba(249,115,22,0.08)', text: resText.slice(0, 160) };
        }
        if (raw.type === 'assistant') {
          const msg = raw.message as Record<string, unknown> | null;
          const content = msg?.content;
          if (Array.isArray(content)) {
            const blocks = content as Record<string, unknown>[];
            const tb = blocks.find((b) => b.type === 'text');
            if (tb?.text && typeof tb.text === 'string') {
              return { label: 'OUTPUT', icon: '💬', color: '#a78bfa', bg: 'rgba(167,139,250,0.07)', text: (tb.text as string).slice(0, 160) };
            }
            const thinkBlock = blocks.find((b) => b.type === 'thinking');
            if (thinkBlock?.thinking && typeof thinkBlock.thinking === 'string') {
              const rawThink = thinkBlock.thinking.replace(/\n/g, ' ').trim();
              const sentence = rawThink.match(/[^.!?]{10,}[.!?]/)?.[0]?.trim() ?? rawThink;
              return { label: 'THINK', icon: '🧠', color: '#06b6d4', bg: 'rgba(6,182,212,0.06)', text: sentence.slice(0, 160) };
            }
            const toolBlock = blocks.find((b) => b.type === 'tool_use');
            if (toolBlock) {
              const toolName = String(toolBlock.name ?? 'tool');
              const input = toolBlock.input as Record<string, unknown> | undefined;
              const val = input?.command ?? input?.code ?? input?.path ?? input?.content ?? input?.query ?? input?.pattern;
              const valStr = val && typeof val === 'string' ? val.replace(/\n/g, ' ').slice(0, 80) : '';
              return { label: toolName.toUpperCase().slice(0, 8), icon: getToolIcon(toolName), color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', text: toolCommentary(toolName, valStr) };
            }
          }
          return null;
        }
      }
      return null;
    }
    case 'ERROR': {
      const err = p.error;
      let text = '';
      if (typeof err === 'string') text = err.slice(0, 160);
      else if (err && typeof err === 'object') { const e = err as Record<string, unknown>; text = String(e.message ?? e.text ?? JSON.stringify(err)).slice(0, 160); }
      else text = typeof p.raw === 'string' ? (p.raw as string).slice(0, 120) : '';
      if (!text) return null;
      return { label: 'ERROR', icon: '⚠️', color: '#ef4444', bg: 'rgba(239,68,68,0.10)', text };
    }
    case 'TIME_WARNING':
    case 'TIME_UP': {
      const rem = p.remainingMs ?? p.remaining;
      const text = rem != null ? `${Math.round(Number(rem) / 1000)}s remaining on the clock` : null;
      if (!text) return null;
      const isUp = type === 'TIME_UP';
      return { label: isUp ? 'TIME UP' : 'TIME', icon: '⏰', color: isUp ? '#f97316' : '#eab308', bg: isUp ? 'rgba(249,115,22,0.12)' : 'rgba(234,179,8,0.10)', text };
    }
    case 'JUDGE_SCORE': {
      const score = p.score ?? p.totalScore;
      const crit = p.criterionId ?? p.criterion;
      if (crit && score != null) return { label: 'SCORE', icon: '⚖️', color: '#a855f7', bg: 'rgba(168,85,247,0.10)', text: `${String(crit)} → ${score}` };
      return null;
    }
    default: return null;
  }
}

const LANE_COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f97316', '#eab308'];

const SPEEDS = [1, 2, 4, 10] as const;
type Speed = (typeof SPEEDS)[number];

const MARKER_EVENT_TYPES = new Set([
  'FILE_CREATE', 'FILE_MODIFY', 'ERROR', 'COMPETITION_START',
  'COMPETITION_COMPLETE', 'JUDGE_SCORE', 'TIME_UP',
]);


// ─── Helpers ─────────────────────────────────────────────────────────────────

function teamLabel(teams: Team[], teamId: string): string {
  const t = teams.find((x) => x.id === teamId);
  if (!t) return teamId;
  return t.persona ? `${t.model}:${t.persona}` : t.model;
}

function formatRelativeTime(eventTs: string, startTs: string): string {
  const diff = new Date(eventTs).getTime() - new Date(startTs).getTime();
  if (diff < 0) return '0:00';
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ─── LaneHistogram ───────────────────────────────────────────────────────────

function LaneHistogram({ events }: { events: ArenaEvent[] }) {
  const counts: Record<string, number> = {};
  for (const ev of events) {
    if (ev.type in HIST_COLORS) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  return (
    <div style={{ display: 'flex', width: '80px', height: '4px', borderRadius: '2px', overflow: 'hidden', gap: '1px' }}>
      {Object.entries(HIST_COLORS).map(([type, color]) => {
        const count = counts[type] ?? 0;
        if (count === 0) return null;
        const pct = (count / total) * 100;
        return (
          <div
            key={type}
            title={`${type}: ${count}`}
            style={{ width: `${pct}%`, background: color, minWidth: '2px', borderRadius: '1px' }}
          />
        );
      })}
    </div>
  );
}

// ─── Pre-battle screen ───────────────────────────────────────────────────────

const INIT_MESSAGES = [
  'Spinning up environment...',
  'Reading the brief...',
  'Loading toolkit...',
  'Allocating compute...',
  'Preparing workspace...',
  'Calibrating strategy...',
  'Reviewing objectives...',
  'Sharpening the approach...',
  'Loading battle systems...',
  'Standing by for launch...',
];

function PreBattleScreen({ color, label }: { color: string; label: string }) {
  const [msgIdx, setMsgIdx] = useState(0);
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    const t = setInterval(() => setMsgIdx((i) => (i + 1) % INIT_MESSAGES.length), 1400);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setProgress((p) => Math.min(88, p + Math.random() * 3.5 + 0.5)), 900);
    return () => clearInterval(t);
  }, []);

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  const rgb = result ? `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}` : '255,255,255';

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2rem', gap: '1.4rem', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse 70% 50% at 50% 55%, rgba(${rgb},0.07) 0%, transparent 70%)`,
      }} />
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(${rgb},0.018) 3px, rgba(${rgb},0.018) 4px)`,
        animation: 'scanline 5s linear infinite',
      }} />

      <div style={{ fontSize: '2.2rem', filter: `drop-shadow(0 0 14px ${color})`, animation: 'pulse 2s ease-in-out infinite' }}>
        ⚔️
      </div>

      <div style={{ textAlign: 'center', zIndex: 1 }}>
        <div style={{ fontSize: '0.70rem', fontWeight: 800, color, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
          {label}
        </div>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#8896ab', letterSpacing: '2.5px', animation: 'pulse 2s ease-in-out infinite' }}>
          BATTLE STATION INITIALIZING
        </div>
      </div>

      <div style={{ width: '75%', maxWidth: '260px', zIndex: 1 }}>
        <div style={{ height: '4px', background: 'rgba(30,45,69,0.8)', borderRadius: '2px', overflow: 'hidden', marginBottom: '0.5rem' }}>
          <div style={{
            height: '100%', width: `${progress}%`, borderRadius: '2px',
            background: `linear-gradient(90deg, ${color}66, ${color})`,
            boxShadow: `0 0 8px ${color}80`,
            transition: 'width 0.9s ease-out',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.68rem', color: '#8896ab', animation: 'msgFade 1.4s ease-in-out infinite' }}>
            {INIT_MESSAGES[msgIdx]}
          </span>
          <span style={{ fontSize: '0.65rem', color, fontFamily: FONT, fontWeight: 700, flexShrink: 0 }}>
            {Math.round(progress)}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── EventRow ────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}` : '255,255,255';
}

function EventRow({ event, startTs, isNew }: {
  event: ArenaEvent; startTs: string; isNew: boolean;
}) {
  const info = classifyEvent(event.type, event.payload);
  if (!info) return null;
  const relTime = formatRelativeTime(event.timestamp, startTs);

  return (
    <div
      className={isNew ? 'event-row event-appear' : 'event-row'}
      style={{
        background: info.bg, borderRadius: '6px',
        padding: '0.45rem 0.65rem', fontSize: '0.78rem', lineHeight: 1.5,
        display: 'flex', gap: '0.45rem', alignItems: 'flex-start',
      }}
    >
      <span style={{
        color: '#4a5568', fontSize: '0.68rem', minWidth: '2.5rem',
        textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums', marginTop: '1px',
      }}>
        {relTime}
      </span>
      <span style={{ flexShrink: 0, fontSize: '0.88rem', lineHeight: 1.3 }}>{info.icon}</span>
      <span style={{
        color: info.color, fontWeight: 800, flexShrink: 0, fontSize: '0.62rem',
        letterSpacing: '0.5px',
        background: `rgba(${hexToRgb(info.color)},0.12)`,
        padding: '0.06rem 0.38rem', borderRadius: '4px', marginTop: '2px',
        whiteSpace: 'nowrap',
      }}>
        {info.label}
      </span>
      <span style={{
        color: '#c4d4e8', overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', flex: 1, minWidth: 0,
      }}>
        {info.text}
      </span>
    </div>
  );
}

// ─── Timeline Scrubber ───────────────────────────────────────────────────────

function TimelineScrubber({
  cursor,
  total,
  events,
  onSeek,
}: {
  cursor: number;
  total: number;
  events: ArenaEvent[];
  onSeek: (pos: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hoverPos, setHoverPos] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const markers = useMemo(() => {
    if (total === 0) return [];
    return events
      .map((ev, idx) => ({ idx, type: ev.type, pct: ((idx + 1) / total) * 100 }))
      .filter((m) => MARKER_EVENT_TYPES.has(m.type));
  }, [events, total]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!barRef.current || total === 0) return;
    const rect = barRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = x / rect.width;
    const idx = Math.round(pct * total);
    setHoverPos(pct * 100);
    setHoverIdx(Math.min(idx, total));
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!barRef.current || total === 0) return;
    const rect = barRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = x / rect.width;
    const idx = Math.round(pct * total);
    onSeek(Math.min(idx, total));
  };

  const hoveredEvent = hoverIdx !== null && hoverIdx > 0 && hoverIdx <= events.length
    ? events[hoverIdx - 1]
    : null;

  const pct = total > 0 ? (cursor / total) * 100 : 0;

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div
        ref={barRef}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { setHoverPos(null); setHoverIdx(null); }}
        style={{
          position: 'relative',
          height: '18px',
          background: '#111827',
          borderRadius: '4px',
          cursor: 'pointer',
          overflow: 'visible',
          border: '1px solid #1e2d45',
        }}
      >
        {/* Progress fill */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: 'linear-gradient(90deg, rgba(249,115,22,0.25), rgba(249,115,22,0.15))',
          borderRadius: '3px 0 0 3px',
          transition: 'width 0.1s linear',
        }} />

        {/* Event markers */}
        {markers.map((m, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${m.pct}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: '4px',
              height: '4px',
              borderRadius: '50%',
              background: EVENT_COLOR[m.type] ?? '#8896ab',
              opacity: m.idx < cursor ? 0.9 : 0.4,
              pointerEvents: 'none',
            }}
          />
        ))}

        {/* Cursor indicator */}
        <div style={{
          position: 'absolute',
          left: `${pct}%`,
          top: '-2px',
          transform: 'translateX(-50%)',
          width: '3px',
          height: '22px',
          background: '#f97316',
          borderRadius: '2px',
          boxShadow: '0 0 6px rgba(249,115,22,0.6)',
          transition: 'left 0.1s linear',
          pointerEvents: 'none',
        }} />

        {/* Hover indicator */}
        {hoverPos !== null && (
          <div style={{
            position: 'absolute',
            left: `${hoverPos}%`,
            top: '-2px',
            transform: 'translateX(-50%)',
            width: '1px',
            height: '22px',
            background: 'rgba(226,232,240,0.3)',
            pointerEvents: 'none',
          }} />
        )}
      </div>

      {/* Hover tooltip */}
      {hoverPos !== null && hoveredEvent && (
        <div style={{
          position: 'absolute',
          left: `${Math.min(Math.max(hoverPos, 10), 90)}%`,
          transform: 'translateX(-50%)',
          top: '24px',
          background: '#1a2234',
          border: '1px solid #2d4060',
          borderRadius: '6px',
          padding: '0.4rem 0.6rem',
          fontSize: '0.58rem',
          color: '#e2e8f0',
          whiteSpace: 'nowrap',
          zIndex: 10,
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        }}>
          <span style={{ marginRight: '0.3rem' }}>
            {classifyEvent(hoveredEvent.type, hoveredEvent.payload)?.icon ?? '·'}
          </span>
          <span style={{ color: EVENT_COLOR[hoveredEvent.type] ?? '#8896ab', fontWeight: 700, marginRight: '0.4rem' }}>
            {classifyEvent(hoveredEvent.type, hoveredEvent.payload)?.label ?? hoveredEvent.type}
          </span>
          <span style={{ color: '#4a5568' }}>#{hoverIdx}</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const [allEvents, setAllEvents] = useState<ArenaEvent[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [briefTitle, setBriefTitle] = useState('');
  const [cursor, setCursor] = useState(0);
  const [prevCursor, setPrevCursor] = useState(0);
  const visibleEvents = useMemo(() => allEvents.slice(0, cursor), [allEvents, cursor]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const laneRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Fetch events
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

  // Fetch team metadata
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

  // Playback tick
  const tick = useCallback(() => {
    setCursor((prev) => {
      setPrevCursor(prev);
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

  // Auto-scroll lanes
  useEffect(() => {
    for (const el of laneRefs.current) {
      if (!el) continue;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [visibleEvents]);

  // Detect teams from events
  const eventTeams = useMemo(() => {
    const seen = new Set<string>();
    for (const e of allEvents) {
      if (e.teamId) seen.add(e.teamId);
    }
    return Array.from(seen).sort();
  }, [allEvents]);

  const orderedTeams: Team[] = teams.length > 0
    ? teams
    : eventTeams.map((tid) => ({ id: tid, model: tid }));

  const startTs = allEvents.length > 0 ? allEvents[0].timestamp : new Date().toISOString();

  const handleSeek = (pos: number) => {
    setPlaying(false);
    setPrevCursor(0);
    setCursor(pos);
  };

  // ─── Render states ───

  if (loading) return (
    <div style={{
      minHeight: '100vh', background: '#0a0e17',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT, color: '#8896ab', fontSize: '0.75rem',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '24px', height: '24px', margin: '0 auto 1rem',
          border: '2px solid #1e2d45', borderTopColor: '#f97316',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
        }} />
        Loading replay...
      </div>
    </div>
  );

  if (error) return (
    <div style={{
      minHeight: '100vh', background: '#0a0e17',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT, color: '#ef4444', fontSize: '0.75rem',
    }}>
      {'❌'} {error}
    </div>
  );

  if (allEvents.length === 0) return (
    <div style={{
      minHeight: '100vh', background: '#0a0e17',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT, color: '#8896ab', fontSize: '0.75rem',
    }}>
      No events to replay for this competition.
    </div>
  );

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden',
      background: '#0a0e17', fontFamily: FONT, color: '#e2e8f0',
    }}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes playPulse {
          0%, 100% { box-shadow: 0 0 12px rgba(34,197,94,0.3); }
          50% { box-shadow: 0 0 20px rgba(34,197,94,0.5); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes scanline {
          0% { background-position: 0 0; }
          100% { background-position: 0 40px; }
        }
        @keyframes msgFade {
          0%, 85% { opacity: 1; }
          95%, 100% { opacity: 0; }
        }
        .event-appear {
          animation: fadeIn 0.25s ease-out;
        }
        .event-row {
          transition: background 0.15s;
        }
        .event-row:hover {
          background: rgba(30,45,69,0.3);
        }
        .speed-btn {
          font-size: 0.62rem;
          font-weight: 700;
          padding: 0.3rem 0.6rem;
          border-radius: 4px;
          cursor: pointer;
          font-family: ${FONT};
          transition: all 0.2s;
          border: none;
        }
        .speed-btn:hover {
          transform: translateY(-1px);
        }
        .control-btn {
          font-size: 0.72rem;
          font-weight: 700;
          padding: 0.45rem 1.2rem;
          border-radius: 6px;
          cursor: pointer;
          font-family: ${FONT};
          transition: all 0.2s;
          border: none;
          letter-spacing: 0.5px;
        }
        .control-btn:hover {
          transform: translateY(-1px);
        }
        .lane-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .lane-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .lane-scroll::-webkit-scrollbar-thumb {
          background: #1e2d45;
          border-radius: 2px;
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.55rem 1.25rem', borderBottom: '1px solid #1e2d45',
        background: 'rgba(10,14,23,0.97)', flexShrink: 0,
      }}>
        <a href="/" style={{
          fontSize: '0.6rem', color: '#f97316', fontWeight: 700,
          letterSpacing: '2px', textDecoration: 'none', flexShrink: 0,
        }}>
          {'◆'} ARENA
        </a>
        <span style={{ color: '#1e2d45' }}>{'│'}</span>
        <a
          href={`/competitions/${id}`}
          style={{ fontSize: '0.62rem', color: '#8896ab', textDecoration: 'none', letterSpacing: '0.5px' }}
        >
          {'←'} Live
        </a>
        <span style={{ color: '#1e2d45' }}>{'│'}</span>
        {briefTitle && (
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {briefTitle}
          </span>
        )}
        <span style={{
          fontSize: '0.55rem', fontWeight: 700, padding: '0.15rem 0.55rem',
          background: 'rgba(249,115,22,0.12)', color: '#f97316',
          borderRadius: '4px', letterSpacing: '1.5px',
        }}>
          {'▶'} REPLAY
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.6rem', color: '#4a5568', fontVariantNumeric: 'tabular-nums' }}>
          {cursor} / {allEvents.length} events
        </span>
      </header>

      {/* ── Controls + Timeline ────────────────────────────────────────────── */}
      <div style={{
        padding: '0.75rem 1.25rem',
        borderBottom: '1px solid #1e2d45',
        background: '#0d1520',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.7rem',
      }}>
        {/* Control bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {/* Reset */}
          <button
            className="control-btn"
            onClick={() => { handleSeek(0); }}
            style={{
              background: 'rgba(136,150,171,0.08)',
              color: '#8896ab',
              fontSize: '0.8rem',
              padding: '0.4rem 0.6rem',
            }}
            title="Reset to beginning"
          >
            {'⏮'}
          </button>

          {/* Play / Pause */}
          <button
            className="control-btn"
            onClick={() => {
              if (cursor >= allEvents.length) {
                setCursor(0);
                setPrevCursor(0);
              }
              setPlaying((p) => !p);
            }}
            style={{
              background: playing ? 'rgba(249,115,22,0.15)' : 'rgba(34,197,94,0.15)',
              color: playing ? '#f97316' : '#22c55e',
              minWidth: '5.5rem',
              textAlign: 'center',
              ...((!playing && cursor < allEvents.length) ? { animation: 'playPulse 2s ease-in-out infinite' } : {}),
            }}
          >
            {playing ? '⏸ Pause' : '▶️ Play'}
          </button>

          {/* Divider */}
          <div style={{ width: '1px', height: '20px', background: '#1e2d45' }} />

          {/* Speed segmented control */}
          <div style={{
            display: 'flex',
            background: '#111827',
            borderRadius: '6px',
            border: '1px solid #1e2d45',
            overflow: 'hidden',
          }}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                className="speed-btn"
                onClick={() => setSpeed(s)}
                style={{
                  background: speed === s ? 'rgba(249,115,22,0.2)' : 'transparent',
                  color: speed === s ? '#f97316' : '#4a5568',
                  borderRight: '1px solid #1e2d45',
                }}
              >
                {s}{'×'}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{ width: '1px', height: '20px', background: '#1e2d45' }} />

          {/* Event counter */}
          <div style={{ fontSize: '0.62rem', color: '#8896ab', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: '#f97316', fontWeight: 700 }}>{cursor}</span>
            <span style={{ color: '#4a5568' }}> / </span>
            <span>{allEvents.length}</span>
          </div>

          <div style={{ flex: 1 }} />

          {/* Event type legend */}
          <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { icon: '🧠', label: 'THINK', color: '#06b6d4' },
              { icon: '⚡', label: 'EXEC', color: '#3b82f6' },
              { icon: '✅', label: 'RESULT', color: '#22c55e' },
              { icon: '📄', label: 'CREATE', color: '#22c55e' },
              { icon: '❌', label: 'FAIL', color: '#ef4444' },
            ].map(({ icon, label, color }) => (
              <span key={label} style={{ fontSize: '0.65rem', color, display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: 700 }}>
                <span style={{ fontSize: '0.75rem' }}>{icon}</span>
                <span style={{ fontSize: '0.60rem', color: '#4a5568' }}>{label}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Timeline scrubber */}
        <TimelineScrubber
          cursor={cursor}
          total={allEvents.length}
          events={allEvents}
          onSeek={handleSeek}
        />
      </div>

      {/* ── Lane View ──────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.max(orderedTeams.length, 1)}, 1fr)`,
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}>
        {orderedTeams.map((team, i) => {
          const teamEvents = visibleEvents.filter((e) => e.teamId === team.id);
          const allTeamEvents = allEvents.filter((e) => e.teamId === team.id);
          const color = LANE_COLORS[i] ?? '#8896ab';
          const label = teamLabel(teams.length > 0 ? teams : orderedTeams, team.id);

          return (
            <div
              key={team.id}
              style={{
                display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden',
                borderLeft: i > 0 ? '1px solid #1e2d45' : 'none',
              }}
            >
              {/* Lane header */}
              <div style={{
                padding: '0.6rem 1rem',
                background: '#0d1520',
                borderBottom: '1px solid #1e2d45',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexShrink: 0, gap: '0.5rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                  <span style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: color, flexShrink: 0,
                    boxShadow: `0 0 6px ${color}80`,
                  }} />
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, color,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
                  <LaneHistogram events={allTeamEvents} />
                  <span style={{ fontSize: '0.58rem', color: '#4a5568', fontVariantNumeric: 'tabular-nums' }}>
                    {teamEvents.length}
                  </span>
                </div>
              </div>

              {/* Lane events */}
              <div
                ref={(el) => { laneRefs.current[i] = el; }}
                className="lane-scroll"
                style={{
                  flex: 1, overflowY: 'auto',
                  padding: teamEvents.length === 0 ? '0' : '0.5rem 0.75rem',
                  display: 'flex', flexDirection: 'column', gap: teamEvents.length === 0 ? '0' : '3px',
                }}
              >
                {teamEvents.length === 0 && allTeamEvents.length > 0 && (
                  <PreBattleScreen color={color} label={label} />
                )}
                {teamEvents.length === 0 && allTeamEvents.length === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                    <p style={{ color: '#2d4060', fontSize: '0.72rem', fontStyle: 'italic' }}>
                      No events recorded.
                    </p>
                  </div>
                )}
                {teamEvents.map((ev, evIdx) => {
                  // Determine if this event is "new" (appeared in the last tick)
                  const globalIdx = allEvents.indexOf(ev);
                  const isNew = playing && globalIdx >= prevCursor && globalIdx < cursor;
                  return (
                    <EventRow
                      key={ev.id}
                      event={ev}
                      startTs={startTs}
                      isNew={isNew}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Fallback: no teams */}
        {orderedTeams.length === 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#2d4060', fontSize: '0.7rem',
          }}>
            No team data available.
          </div>
        )}
      </div>
    </div>
  );
}
