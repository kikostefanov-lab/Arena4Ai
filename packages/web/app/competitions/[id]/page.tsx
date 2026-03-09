'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { formatElapsed } from '../../../lib/format';

interface Team {
  id: string;
  model: string;
  persona?: string;
}

interface ArenaEvent {
  eventId: string;
  competitionId: string;
  teamId: string;
  timestamp: string;
  type: string;
  payload: unknown;
  metadata: Record<string, unknown>;
}

interface CriterionScore {
  criterionId: string;
  score: number;
  maxScore: number;
}

interface TeamResult {
  teamId: string;
  totalScore: number;
  criteriaScores: CriterionScore[];
}

interface CompetitionResult {
  winnerId: string | null;
  teams: TeamResult[];
  summary?: string;
  synthesis?: string | null;
}

type CompetitionState = 'PENDING' | 'RUNNING' | 'JUDGING' | 'COMPLETE' | 'ERROR';

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

const STATE_BADGE: Record<string, { bg: string; color: string }> = {
  PENDING:  { bg: 'rgba(136,150,171,0.1)', color: '#8896ab' },
  RUNNING:  { bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
  JUDGING:  { bg: 'rgba(234,179,8,0.12)',  color: '#eab308' },
  COMPLETE: { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' },
  ERROR:    { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
};

function resolveLabel(teams: Team[], teamId: string, fallback: string): string {
  const t = teams.find((x) => x.id === teamId);
  if (!t) return fallback;
  return t.persona ? `${t.model}:${t.persona}` : t.model;
}

function payloadSummary(payload: unknown): string {
  if (!payload) return '';
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return str.length > 120 ? str.slice(0, 120) + '…' : str;
}

function ctrlBtn(color: string, bg: string): React.CSSProperties {
  return {
    fontSize: '0.62rem', fontWeight: 600, padding: '0.3rem 0.7rem',
    background: bg, color, border: `1px solid ${color}`,
    borderRadius: '4px', cursor: 'pointer', letterSpacing: '0.5px', fontFamily: 'inherit',
  };
}

// ─── Lane panel ─────────────────────────────────────────────────────────────

const LanePanel = forwardRef<HTMLDivElement, { label: string; color: string; events: ArenaEvent[] }>(
  ({ label, color, events }, ref) => (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '0.55rem 1rem', background: '#0d1520',
        borderBottom: '1px solid #1e2d45',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color }}>{label}</span>
        <span style={{ fontSize: '0.58rem', color: '#4a5568' }}>{events.length} events</span>
      </div>
      <div ref={ref} style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
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
  ),
);
LanePanel.displayName = 'LanePanel';

function EventRow({ event }: { event: ArenaEvent }) {
  const color = EVENT_COLOR[event.type] ?? '#8896ab';
  const border = EVENT_BORDER[event.type] ?? '#1e2d45';
  const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return (
    <div style={{ borderLeft: `2px solid ${border}`, paddingLeft: '0.5rem', paddingTop: '1px', paddingBottom: '1px', fontSize: '0.65rem', lineHeight: 1.5, color }}>
      <span style={{ color: '#4a5568', marginRight: '0.4rem' }}>{time}</span>
      <span style={{ fontWeight: 700, marginRight: '0.4rem' }}>{event.type}</span>
      <span style={{ opacity: 0.65 }}>{payloadSummary(event.payload)}</span>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function CompetitionPage() {
  const params = useParams();
  const id = params.id as string;

  const [state, setState] = useState<CompetitionState>('PENDING');
  const [teams, setTeams] = useState<Team[]>([]);
  const [briefTitle, setBriefTitle] = useState('');
  const [teamAEvents, setTeamAEvents] = useState<ArenaEvent[]>([]);
  const [teamBEvents, setTeamBEvents] = useState<ArenaEvent[]>([]);
  const [result, setResult] = useState<CompetitionResult | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sseError, setSseError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  const laneARef = useRef<HTMLDivElement>(null);
  const laneBRef = useRef<HTMLDivElement>(null);

  // Fetch competition metadata (teams + brief)
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

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    const el = laneARef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) el.scrollTop = el.scrollHeight;
  }, [teamAEvents]);

  useEffect(() => {
    const el = laneBRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) el.scrollTop = el.scrollHeight;
  }, [teamBEvents]);

  // WebSocket
  useEffect(() => {
    if (!id) return;
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000';
    let ws: WebSocket;
    let lastSeq = 0;
    let retries = 0;
    let intentionalClose = false;
    const MAX_RETRIES = 5;

    function connect() {
      ws = new WebSocket(`${wsUrl}/competitions/${id}/stream`);
      ws.onopen = () => { setConnected(true); setSseError(null); retries = 0; ws.send(JSON.stringify({ lastSeq })); };
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data as string) as ArenaEvent & { result?: CompetitionResult; _seq?: number; state?: string };
          if (typeof ev._seq === 'number') lastSeq = ev._seq;
          if (ev.type === 'STATE_CHANGE') {
            if (ev.state === 'RUNNING') setState('RUNNING');
            else if (ev.state === 'JUDGING') setState('JUDGING');
            return;
          }
          if (ev.type === 'COMPETITION_START') setState('RUNNING');
          if (ev.type === 'JUDGE_SCORE') setState('JUDGING');
          if (ev.type === 'COMPETITION_COMPLETE' || ev.type === 'COMPLETE') {
            setState('COMPLETE');
            if (ev.result) setResult(ev.result);
            intentionalClose = true; ws.close(); return;
          }
          const push = (setter: React.Dispatch<React.SetStateAction<ArenaEvent[]>>) =>
            setter((prev) => { const n = [...prev, ev]; return n.length > 500 ? n.slice(-500) : n; });
          if (ev.teamId === 'team-a') push(setTeamAEvents);
          else if (ev.teamId === 'team-b') push(setTeamBEvents);
          else { push(setTeamAEvents); push(setTeamBEvents); }
        } catch { /* ignore */ }
      };
      ws.onerror = () => { setSseError('WebSocket error'); setConnected(false); };
      ws.onclose = () => {
        setConnected(false);
        if (!intentionalClose && retries < MAX_RETRIES) { retries++; setTimeout(connect, Math.min(1000 * retries, 5000)); }
      };
    }
    connect();
    return () => { ws?.close(); };
  }, [id]);

  const sendControl = async (action: 'cancel' | 'pause' | 'resume') => {
    const res = await fetch(`/api/competitions/${id}?action=${action}`, { method: 'POST' });
    if (!res.ok) return;
    if (action === 'pause') setIsPaused(true);
    if (action === 'resume') setIsPaused(false);
    if (action === 'cancel') setState('COMPLETE');
  };

  const labelA = resolveLabel(teams, 'team-a', 'Team A');
  const labelB = resolveLabel(teams, 'team-b', 'Team B');
  const winnerLabel = result?.winnerId ? resolveLabel(teams, result.winnerId, result.winnerId) : null;
  const stateBadge = STATE_BADGE[state] ?? STATE_BADGE.PENDING;
  const teamAScore = result?.teams.find((t) => t.teamId === 'team-a');
  const teamBScore = result?.teams.find((t) => t.teamId === 'team-b');

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden',
      background: '#0a0e17', fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace", color: '#e2e8f0',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.55rem 1.25rem', borderBottom: '1px solid #1e2d45',
        background: 'rgba(10,14,23,0.95)', flexShrink: 0,
      }}>
        <a href="/" style={{ fontSize: '0.6rem', color: '#f97316', fontWeight: 700, letterSpacing: '2px', textDecoration: 'none', flexShrink: 0 }}>
          ◆ ARENA
        </a>
        <span style={{ color: '#1e2d45' }}>│</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {briefTitle && (
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#e2e8f0' }}>{briefTitle}</span>
          )}
          <span style={{
            fontSize: '0.52rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '3px', letterSpacing: '1.5px',
            background: stateBadge.bg, color: stateBadge.color,
          }}>
            {state}
          </span>
          {!connected && !result && <span style={{ fontSize: '0.6rem', color: '#eab308' }}>connecting…</span>}
          {sseError && <span style={{ fontSize: '0.6rem', color: '#ef4444' }}>{sseError}</span>}
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

        <div style={{ fontFamily: 'monospace', color: '#8896ab', fontSize: '0.75rem', flexShrink: 0, minWidth: '3.5rem', textAlign: 'right' }}>
          {formatElapsed(elapsed)}
        </div>
      </header>

      {/* Two-lane view */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <LanePanel ref={laneARef} label={labelA} color="#3b82f6" events={teamAEvents} />
        <div style={{ width: '1px', background: '#1e2d45', flexShrink: 0 }} />
        <LanePanel ref={laneBRef} label={labelB} color="#a855f7" events={teamBEvents} />
      </div>

      {/* Scoreboard */}
      {result && (
        <div style={{ flexShrink: 0, borderTop: '1px solid #1e2d45', background: 'rgba(10,14,23,0.97)', padding: '1.25rem 1.5rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            {winnerLabel ? (
              <>
                <div style={{ fontSize: '0.58rem', color: '#eab308', letterSpacing: '3px', fontWeight: 700, marginBottom: '0.2rem' }}>★ WINNER</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#eab308' }}>{winnerLabel}</div>
              </>
            ) : (
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#8896ab' }}>Draw</div>
            )}
            {result.summary && (
              <p style={{ fontSize: '0.68rem', color: '#8896ab', marginTop: '0.4rem', fontFamily: "-apple-system, 'Segoe UI', sans-serif" }}>
                {result.summary}
              </p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', maxWidth: '600px', margin: '0 auto' }}>
            {[{ score: teamAScore, laneColor: '#3b82f6', label: labelA }, { score: teamBScore, laneColor: '#a855f7', label: labelB }].map(({ score, laneColor, label }) => {
              if (!score) return null;
              const isWinner = score.teamId === result.winnerId;
              return (
                <div key={score.teamId} style={{
                  background: isWinner ? 'rgba(234,179,8,0.05)' : '#111827',
                  border: `1px solid ${isWinner ? 'rgba(234,179,8,0.35)' : '#1e2d45'}`,
                  borderRadius: '6px', padding: '0.85rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: laneColor }}>{label}</span>
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: isWinner ? '#eab308' : '#e2e8f0' }}>
                      {score.totalScore.toFixed(1)}
                    </span>
                  </div>
                  {score.criteriaScores.map((cs) => (
                    <div key={cs.criterionId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', marginBottom: '0.2rem' }}>
                      <span style={{ color: '#8896ab', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{cs.criterionId}</span>
                      <span style={{ color: '#e2e8f0', marginLeft: '0.5rem' }}>{cs.score}/{cs.maxScore}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {result.synthesis && (
            <div style={{ marginTop: '1.25rem', border: '1px solid rgba(168,85,247,0.25)', borderRadius: '6px', overflow: 'hidden' }}>
              <div style={{ background: 'rgba(168,85,247,0.07)', padding: '0.6rem 1rem', borderBottom: '1px solid rgba(168,85,247,0.18)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#a855f7', letterSpacing: '2px', textTransform: 'uppercase' }}>✦ Synthesis</span>
                <span style={{ fontSize: '0.62rem', color: '#8896ab', fontFamily: "-apple-system, 'Segoe UI', sans-serif" }}>
                  Best elements from both teams, merged by synthesis agent
                </span>
              </div>
              <div style={{ padding: '1rem', background: '#0d1520' }}>
                <pre style={{ fontSize: '0.7rem', color: '#c4d4e8', whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.7, margin: 0 }}>
                  {result.synthesis}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
