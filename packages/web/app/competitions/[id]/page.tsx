'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { formatElapsed } from '../../../lib/format';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Team { id: string; model: string; persona?: string; }

interface ArenaEvent {
  eventId: string;
  competitionId: string;
  teamId: string;
  timestamp: string;
  type: string;
  payload: unknown;
  metadata: Record<string, unknown>;
}

interface CriterionScore { criterionId: string; score: number; maxScore: number; }
interface TeamResult { teamId: string; totalScore: number; criteriaScores: CriterionScore[]; }
interface CompetitionResult { winnerId: string | null; teams: TeamResult[]; summary?: string; synthesis?: string | null; }

type CompetitionState = 'PENDING' | 'RUNNING' | 'JUDGING' | 'COMPLETE' | 'ERROR';

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_ICON: Record<string, string> = {
  TOOL_CALL: '▸', FILE_CREATE: '+', FILE_MODIFY: '~', REASONING: '·',
  ERROR: '✗', TIME_WARNING: '⚠', TIME_UP: '▪', JUDGE_SCORE: '◆',
  COMPETITION_START: '▶', COMPETITION_END: '■',
};

const EVENT_COLOR: Record<string, string> = {
  TOOL_CALL:        '#3b82f6',
  FILE_CREATE:      '#22c55e',
  FILE_MODIFY:      '#10b981',
  REASONING:        '#8896ab',
  ERROR:            '#ef4444',
  TIME_WARNING:     '#eab308',
  TIME_UP:          '#f97316',
  JUDGE_SCORE:      '#a855f7',
  COMPETITION_START:'#e2e8f0',
  COMPETITION_END:  '#e2e8f0',
};

const EVENT_BORDER: Record<string, string> = {
  TOOL_CALL:        '#1d4ed8',
  FILE_CREATE:      '#15803d',
  FILE_MODIFY:      '#047857',
  REASONING:        '#1e2d45',
  ERROR:            '#991b1b',
  TIME_WARNING:     '#a16207',
  TIME_UP:          '#c2410c',
  JUDGE_SCORE:      '#6b21a8',
  COMPETITION_START:'#374151',
  COMPETITION_END:  '#374151',
};

const HIST_COLORS: Record<string, string> = {
  TOOL_CALL:   '#3b82f6',
  FILE_CREATE: '#22c55e',
  FILE_MODIFY: '#10b981',
  REASONING:   '#8896ab',
  ERROR:       '#ef4444',
};

const LANE_COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f97316', '#eab308'];

const STATE_BADGE: Record<string, { bg: string; color: string }> = {
  PENDING:  { bg: 'rgba(136,150,171,0.1)', color: '#8896ab' },
  RUNNING:  { bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
  JUDGING:  { bg: 'rgba(234,179,8,0.12)',  color: '#eab308' },
  COMPLETE: { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
  ERROR:    { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
};

// ─── Event summarizer ─────────────────────────────────────────────────────────

function summarizeEvent(type: string, payload: unknown): string | null {
  const p = payload as Record<string, unknown> | null;
  if (!p) return null;
  switch (type) {
    case 'TOOL_CALL': {
      const tool = String(p.tool ?? 'unknown');
      const input = (p.input ?? {}) as Record<string, unknown>;
      const val = input.command ?? input.code ?? input.path ?? input.query ?? input.content;
      if (val) return `${tool}  ${String(val).replace(/\n/g, ' ').slice(0, 60)}`;
      const keys = Object.keys(input);
      return keys.length ? `${tool}(${keys[0]}=…)` : tool;
    }
    case 'FILE_CREATE':
    case 'FILE_MODIFY': {
      const text = String(p.text ?? '');
      const m = text.match(/(\/?(?:[\w.-]+\/)*[\w.-]+\.\w+)/);
      return m ? m[1] : text.slice(0, 80);
    }
    case 'REASONING': {
      if (p.text) return String(p.text).trim().slice(0, 100) || null;
      if (p.raw) {
        const raw = p.raw as Record<string, unknown>;
        if (raw.type === 'system') return null;
        if (raw.type === 'result') return raw.result ? String(raw.result).slice(0, 80) : null;
        const content = raw.content ?? raw.text ?? raw.message;
        if (content) return String(content).slice(0, 80);
      }
      return null;
    }
    case 'ERROR': {
      const err = p.error;
      if (typeof err === 'string') return err.slice(0, 100);
      if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>;
        return String(e.message ?? e.text ?? JSON.stringify(err)).slice(0, 100);
      }
      return typeof p.raw === 'string' ? p.raw.slice(0, 80) : null;
    }
    case 'TIME_WARNING':
    case 'TIME_UP': {
      const rem = p.remainingMs ?? p.remaining;
      return rem != null ? `${Math.round(Number(rem) / 1000)}s remaining` : null;
    }
    case 'JUDGE_SCORE': {
      const score = p.score ?? p.totalScore;
      const crit = p.criterionId ?? p.criterion;
      if (crit && score != null) return `${String(crit)} → ${score}`;
      return null;
    }
    default:
      return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveLabel(teams: Team[], teamId: string, fallback: string): string {
  const t = teams.find((x) => x.id === teamId);
  if (!t) return fallback;
  return t.persona ? `${t.model}:${t.persona}` : t.model;
}

function ctrlBtn(color: string, bg: string): React.CSSProperties {
  return {
    fontSize: '0.62rem', fontWeight: 600, padding: '0.3rem 0.7rem',
    background: bg, color, border: `1px solid ${color}`,
    borderRadius: '4px', cursor: 'pointer', letterSpacing: '0.5px', fontFamily: 'inherit',
  };
}

// ─── Lane histogram ───────────────────────────────────────────────────────────

function LaneHistogram({ events }: { events: ArenaEvent[] }) {
  const counts: Record<string, number> = {};
  for (const ev of events) {
    if (ev.type in HIST_COLORS) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  return (
    <div style={{ display: 'flex', width: '60px', height: '3px', borderRadius: '2px', overflow: 'hidden', gap: '1px' }}>
      {Object.entries(HIST_COLORS).map(([type, color]) => {
        const count = counts[type] ?? 0;
        if (count === 0) return null;
        const pct = (count / total) * 100;
        return (
          <div
            key={type}
            title={`${type}: ${count}`}
            style={{ width: `${pct}%`, background: color, minWidth: '2px' }}
          />
        );
      })}
    </div>
  );
}

// ─── Event row ────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: ArenaEvent }) {
  const summary = summarizeEvent(event.type, event.payload);
  if (summary === null) return null;

  const color = EVENT_COLOR[event.type] ?? '#8896ab';
  const border = EVENT_BORDER[event.type] ?? '#1e2d45';
  const icon = EVENT_ICON[event.type] ?? '·';

  return (
    <div style={{
      borderLeft: `2px solid ${border}`,
      paddingLeft: '0.5rem', paddingTop: '1px', paddingBottom: '1px',
      fontSize: '0.65rem', lineHeight: 1.5, display: 'flex', gap: '0.35rem', alignItems: 'baseline',
    }}>
      <span style={{ color, flexShrink: 0, width: '0.8rem', textAlign: 'center' }}>{icon}</span>
      <span style={{ color, fontWeight: 700, flexShrink: 0, fontSize: '0.57rem', letterSpacing: '0.3px' }}>{event.type}</span>
      <span style={{ color: '#8896ab', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {summary}
      </span>
    </div>
  );
}

// ─── Lane panel ───────────────────────────────────────────────────────────────

const LanePanel = forwardRef<
  HTMLDivElement,
  { label: string; color: string; events: ArenaEvent[]; borderLeft?: boolean }
>(({ label, color, events, borderLeft }, ref) => (
  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', borderLeft: borderLeft ? '1px solid #1e2d45' : 'none' }}>
    {/* Header */}
    <div style={{
      padding: '0.55rem 1rem', background: '#0d1520',
      borderBottom: '1px solid #1e2d45',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      gap: '0.5rem',
    }}>
      <span style={{ fontSize: '0.7rem', fontWeight: 700, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
        <LaneHistogram events={events} />
        <span style={{ fontSize: '0.58rem', color: '#4a5568' }}>{events.length}</span>
      </div>
    </div>
    {/* Scroll area */}
    <div
      ref={ref}
      style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '2px' }}
    >
      {events.length === 0 && (
        <p style={{ color: '#2d4060', fontSize: '0.65rem', fontStyle: 'italic', marginTop: '0.5rem' }}>
          Waiting for events…
        </p>
      )}
      {events.map((ev) => (
        <EventRow key={ev.eventId} event={ev} />
      ))}
    </div>
  </div>
));
LanePanel.displayName = 'LanePanel';

// ─── Score drawer ─────────────────────────────────────────────────────────────

function ScoreDrawer({
  result,
  teams,
}: {
  result: CompetitionResult;
  teams: Team[];
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [synthOpen, setSynthOpen] = useState(true);

  // Auto-open once on mount (result just arrived)
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (!didAutoOpen.current) {
      didAutoOpen.current = true;
      // Keep collapsed by default; user opens manually
    }
  }, []);

  const winnerLabel = result.winnerId
    ? resolveLabel(teams, result.winnerId, result.winnerId)
    : null;

  // Build per-team display data
  const teamDisplays = result.teams.map((tr, i) => ({
    result: tr,
    label: resolveLabel(teams, tr.teamId, `Team ${i + 1}`),
    color: LANE_COLORS[i] ?? '#8896ab',
    isWinner: tr.teamId === result.winnerId,
  }));

  // Score summary string for collapsed strip
  const scoreSummary = teamDisplays
    .map((d) => `${d.label} ${d.result.totalScore.toFixed(1)}`)
    .join(' vs ');

  return (
    <div style={{
      borderTop: '1px solid #1e2d45',
      background: 'rgba(10,14,23,0.97)',
      flexShrink: 0,
    }}>
      {/* Collapsed strip */}
      <button
        onClick={() => setDrawerOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '0.6rem',
          padding: '0 1.25rem', height: '44px', background: 'none', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit', color: '#e2e8f0', textAlign: 'left',
          borderBottom: drawerOpen ? '1px solid #1e2d45' : 'none',
        }}
      >
        <span style={{ color: '#eab308', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '1px', flexShrink: 0 }}>
          ★ {winnerLabel ?? 'DRAW'}
        </span>
        <span style={{ color: '#4a5568', fontSize: '0.65rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          · {scoreSummary}
        </span>
        <span style={{ color: '#8896ab', fontSize: '0.65rem', flexShrink: 0 }}>
          {drawerOpen ? '▲ details' : '▼ details'}
        </span>
      </button>

      {/* Expanded body */}
      {drawerOpen && (
        <div style={{ padding: '1rem 1.5rem 1.25rem' }}>
          {/* Score grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(teamDisplays.length, 4)}, 1fr)`,
            gap: '0.75rem', maxWidth: '600px', margin: '0 auto',
          }}>
            {teamDisplays.map(({ result: tr, label, color, isWinner }) => (
              <div key={tr.teamId} style={{
                background: isWinner ? 'rgba(234,179,8,0.05)' : '#111827',
                border: `1px solid ${isWinner ? 'rgba(234,179,8,0.35)' : '#1e2d45'}`,
                borderRadius: '6px', padding: '0.85rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                  <span style={{ fontSize: '1rem', fontWeight: 800, color: isWinner ? '#eab308' : '#e2e8f0', flexShrink: 0, marginLeft: '0.4rem' }}>
                    {tr.totalScore.toFixed(1)}
                  </span>
                </div>
                {tr.criteriaScores.map((cs) => (
                  <div key={cs.criterionId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', marginBottom: '0.2rem' }}>
                    <span style={{ color: '#8896ab', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                      {cs.criterionId}
                    </span>
                    <span style={{ color: '#e2e8f0', marginLeft: '0.5rem', flexShrink: 0 }}>{cs.score}/{cs.maxScore}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Summary */}
          {result.summary && (
            <p style={{
              fontSize: '0.68rem', color: '#8896ab', marginTop: '0.75rem', textAlign: 'center',
              fontFamily: "-apple-system, 'Segoe UI', sans-serif",
            }}>
              {result.summary}
            </p>
          )}

          {/* Synthesis */}
          {result.synthesis && (
            <div style={{ marginTop: '1rem', border: '1px solid rgba(168,85,247,0.25)', borderRadius: '6px', overflow: 'hidden' }}>
              {/* Synthesis header / toggle */}
              <button
                onClick={() => setSynthOpen((o) => !o)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                  background: 'rgba(168,85,247,0.07)', padding: '0.6rem 1rem',
                  borderBottom: synthOpen ? '1px solid rgba(168,85,247,0.18)' : 'none',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#a855f7', letterSpacing: '2px', textTransform: 'uppercase' }}>
                  ✦ Synthesis
                </span>
                <span style={{ fontSize: '0.62rem', color: '#8896ab', fontFamily: "-apple-system, 'Segoe UI', sans-serif", flex: 1 }}>
                  Best elements from both teams, merged by synthesis agent
                </span>
                <span style={{ fontSize: '0.62rem', color: '#8896ab', flexShrink: 0 }}>
                  {synthOpen ? '▲' : '▼'}
                </span>
              </button>
              {synthOpen && (
                <div style={{ padding: '1rem', background: '#0d1520', maxHeight: '220px', overflowY: 'auto' }}>
                  <pre style={{
                    fontSize: '0.7rem', color: '#c4d4e8', whiteSpace: 'pre-wrap',
                    fontFamily: 'inherit', lineHeight: 1.7, margin: 0,
                  }}>
                    {result.synthesis}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CompetitionPage() {
  const params = useParams();
  const id = params.id as string;

  const [state, setState] = useState<CompetitionState>('PENDING');
  const [teams, setTeams] = useState<Team[]>([]);
  const [briefTitle, setBriefTitle] = useState('');
  const [teamEvents, setTeamEvents] = useState<Map<string, ArenaEvent[]>>(new Map());
  const [broadcastEvents, setBroadcastEvents] = useState<ArenaEvent[]>([]);
  const [result, setResult] = useState<CompetitionResult | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sseError, setSseError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // One ref per lane; we store them in an array indexed by team order
  const laneRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Fetch competition metadata
  useEffect(() => {
    if (!id) return;
    fetch(`/api/competitions/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { teams?: Team[]; brief?: { title?: string } } | null) => {
        if (!data) return;
        if (Array.isArray(data.teams)) setTeams(data.teams);
        if (data.brief?.title) setBriefTitle(data.brief.title);
      })
      .catch(() => { /* non-critical */ });
  }, [id]);

  // Elapsed timer
  useEffect(() => {
    const iv = setInterval(() => setElapsed(Date.now() - startTime), 1000);
    return () => clearInterval(iv);
  }, [startTime]);

  // Auto-scroll lanes
  useEffect(() => {
    for (const el of laneRefs.current) {
      if (!el) continue;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
        el.scrollTop = el.scrollHeight;
      }
    }
  // Re-run when any team's events change; teamEvents reference changes on each update
  }, [teamEvents, broadcastEvents]);

  // WebSocket
  useEffect(() => {
    if (!id) return;
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000';
    let ws: WebSocket;
    let lastSeq = 0;
    let retries = 0;
    let intentionalClose = false;
    const MAX_RETRIES = 5;

    function pushEvent(teamId: string, ev: ArenaEvent) {
      if (!teamId || teamId === '') {
        setBroadcastEvents((prev) => {
          const n = [...prev, ev];
          return n.length > 500 ? n.slice(-500) : n;
        });
        return;
      }
      setTeamEvents((prev) => {
        const next = new Map(prev);
        const existing = next.get(teamId) ?? [];
        const updated = [...existing, ev];
        next.set(teamId, updated.length > 500 ? updated.slice(-500) : updated);
        return next;
      });
    }

    function connect() {
      ws = new WebSocket(`${wsUrl}/competitions/${id}/stream`);
      ws.onopen = () => {
        setConnected(true);
        setSseError(null);
        retries = 0;
        ws.send(JSON.stringify({ lastSeq }));
      };
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data as string) as ArenaEvent & {
            result?: CompetitionResult;
            _seq?: number;
            state?: string;
          };
          if (typeof ev._seq === 'number') lastSeq = ev._seq;

          if (ev.type === 'STATE_CHANGE') {
            if (ev.state === 'RUNNING') setState('RUNNING');
            else if (ev.state === 'JUDGING') setState('JUDGING');
            return;
          }
          if (ev.type === 'COMPETITION_START') { setState('RUNNING'); return; }
          if (ev.type === 'JUDGE_SCORE') setState('JUDGING');
          if (ev.type === 'COMPETITION_COMPLETE' || ev.type === 'COMPLETE') {
            setState('COMPLETE');
            if (ev.result) setResult(ev.result);
            intentionalClose = true;
            ws.close();
            return;
          }

          pushEvent(ev.teamId ?? '', ev);
        } catch { /* ignore parse errors */ }
      };
      ws.onerror = () => { setSseError('WebSocket error'); setConnected(false); };
      ws.onclose = () => {
        setConnected(false);
        if (!intentionalClose && retries < MAX_RETRIES) {
          retries++;
          setTimeout(connect, Math.min(1000 * retries, 5000));
        }
      };
    }

    connect();
    return () => { intentionalClose = true; ws?.close(); };
  }, [id]);

  const sendControl = async (action: 'cancel' | 'pause' | 'resume') => {
    const res = await fetch(`/api/competitions/${id}?action=${action}`, { method: 'POST' });
    if (!res.ok) return;
    if (action === 'pause') setIsPaused(true);
    if (action === 'resume') setIsPaused(false);
    if (action === 'cancel') setState('COMPLETE');
  };

  // Determine ordered team list: prefer fetched teams; fall back to teams seen in events
  const orderedTeams: Team[] = teams.length > 0
    ? teams
    : Array.from(teamEvents.keys()).map((tid) => ({ id: tid, model: tid }));

  const numTeams = Math.max(orderedTeams.length, 1);
  const stateBadge = STATE_BADGE[state] ?? STATE_BADGE.PENDING;

  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: 'auto 1fr auto',
      height: '100vh',
      overflow: 'hidden',
      background: '#0a0e17',
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      color: '#e2e8f0',
    }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.55rem 1.25rem', borderBottom: '1px solid #1e2d45',
        background: 'rgba(10,14,23,0.95)',
      }}>
        <a href="/" style={{
          fontSize: '0.6rem', color: '#f97316', fontWeight: 700,
          letterSpacing: '2px', textDecoration: 'none', flexShrink: 0,
        }}>
          ◆ ARENA
        </a>
        <span style={{ color: '#1e2d45' }}>│</span>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {briefTitle && (
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#e2e8f0' }}>{briefTitle}</span>
          )}
          <span style={{
            fontSize: '0.52rem', fontWeight: 700, padding: '0.1rem 0.45rem',
            borderRadius: '3px', letterSpacing: '1.5px',
            background: stateBadge.bg, color: stateBadge.color,
          }}>
            {state}
          </span>
          {!connected && !result && (
            <span style={{ fontSize: '0.6rem', color: '#eab308' }}>connecting…</span>
          )}
          {sseError && (
            <span style={{ fontSize: '0.6rem', color: '#ef4444' }}>{sseError}</span>
          )}
        </div>

        {state === 'RUNNING' && (
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {!isPaused
              ? <button onClick={() => sendControl('pause')} style={ctrlBtn('#eab308', 'rgba(234,179,8,0.1)')}>Pause</button>
              : <button onClick={() => sendControl('resume')} style={ctrlBtn('#22c55e', 'rgba(34,197,94,0.1)')}>Resume</button>
            }
            <button onClick={() => sendControl('cancel')} style={ctrlBtn('#ef4444', 'rgba(239,68,68,0.1)')}>Cancel</button>
          </div>
        )}

        <a href={`/competitions/${id}/replay`} style={{
          fontSize: '0.6rem', color: '#8896ab', textDecoration: 'none',
          border: '1px solid #1e2d45', borderRadius: '4px', padding: '0.28rem 0.6rem',
          flexShrink: 0, letterSpacing: '0.5px',
        }}>
          ▶ REPLAY
        </a>

        <div style={{
          fontFamily: 'monospace', color: '#8896ab', fontSize: '0.75rem',
          flexShrink: 0, minWidth: '3.5rem', textAlign: 'right',
        }}>
          {formatElapsed(elapsed)}
        </div>
      </header>

      {/* ── Lanes ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${numTeams}, 1fr)`,
        overflow: 'hidden',
        minHeight: 0,
      }}>
        {orderedTeams.map((team, i) => {
          const events = [
            ...(teamEvents.get(team.id) ?? []),
            ...broadcastEvents,
          ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

          const color = LANE_COLORS[i] ?? '#8896ab';
          const label = team.persona ? `${team.model}:${team.persona}` : team.model;

          return (
            <LanePanel
              key={team.id}
              ref={(el) => { laneRefs.current[i] = el; }}
              label={label}
              color={color}
              events={events}
              borderLeft={i > 0}
            />
          );
        })}

        {/* Fallback: no teams loaded yet */}
        {orderedTeams.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2d4060', fontSize: '0.7rem' }}>
            Waiting for competition data…
          </div>
        )}
      </div>

      {/* ── Score drawer ───────────────────────────────────────────────────── */}
      {result && <ScoreDrawer result={result} teams={orderedTeams} />}
    </div>
  );
}
