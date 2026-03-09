'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

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
  reasoning?: string;
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
}

type CompetitionState = 'PENDING' | 'RUNNING' | 'JUDGING' | 'COMPLETE' | 'ERROR';

const EVENT_COLORS: Record<string, string> = {
  TOOL_CALL: 'text-blue-400 border-l-blue-500',
  FILE_CREATE: 'text-green-400 border-l-green-500',
  FILE_MODIFY: 'text-emerald-400 border-l-emerald-500',
  REASONING: 'text-gray-400 border-l-gray-600',
  ERROR: 'text-red-400 border-l-red-500',
  TIME_WARNING: 'text-yellow-400 border-l-yellow-500',
  TIME_UP: 'text-orange-400 border-l-orange-500',
  JUDGE_SCORE: 'text-purple-400 border-l-purple-500',
  COMPETITION_START: 'text-white border-l-white',
  COMPETITION_END: 'text-white border-l-white',
};

const STATE_BADGE: Record<string, string> = {
  PENDING: 'bg-gray-700 text-gray-300',
  RUNNING: 'bg-green-900 text-green-300',
  JUDGING: 'bg-yellow-900 text-yellow-300',
  COMPLETE: 'bg-blue-900 text-blue-300',
  ERROR: 'bg-red-900 text-red-300',
};

function getEventStyle(type: string): string {
  return EVENT_COLORS[type] ?? 'text-gray-300 border-l-gray-700';
}

function payloadSummary(payload: unknown): string {
  if (!payload) return '';
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return str.length > 120 ? str.slice(0, 120) + '…' : str;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function CompetitionPage() {
  const params = useParams();
  const id = params.id as string;

  const [state, setState] = useState<CompetitionState>('PENDING');
  const [teamAEvents, setTeamAEvents] = useState<ArenaEvent[]>([]);
  const [teamBEvents, setTeamBEvents] = useState<ArenaEvent[]>([]);
  const [result, setResult] = useState<CompetitionResult | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sseError, setSseError] = useState<string | null>(null);

  const laneARef = useRef<HTMLDivElement>(null);
  const laneBRef = useRef<HTMLDivElement>(null);

  // Elapsed timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Auto-scroll lanes only when the user is already at (or near) the bottom.
  useEffect(() => {
    const el = laneARef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom) el.scrollTop = el.scrollHeight;
  }, [teamAEvents]);

  useEffect(() => {
    const el = laneBRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom) el.scrollTop = el.scrollHeight;
  }, [teamBEvents]);

  // WebSocket connection
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

      ws.onopen = () => {
        setConnected(true);
        setSseError(null);
        retries = 0;
        // Send resume cursor
        ws.send(JSON.stringify({ lastSeq }));
      };

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data as string) as ArenaEvent & { type: string; result?: CompetitionResult; _seq?: number; state?: string };

          if (typeof event._seq === 'number') lastSeq = event._seq;

          if (event.type === 'STATE_CHANGE') {
            const s = event.state ?? '';
            if (s === 'RUNNING') setState('RUNNING');
            else if (s === 'JUDGING') setState('JUDGING');
            return;
          }

          if (event.type === 'COMPETITION_START') setState('RUNNING');
          if (event.type === 'JUDGE_SCORE') setState('JUDGING');
          if (event.type === 'COMPETITION_COMPLETE' || event.type === 'COMPLETE') {
            setState('COMPLETE');
            if (event.result) setResult(event.result);
            intentionalClose = true;
            ws.close();
            return;
          }

          const teamId = event.teamId ?? '';
          if (teamId === 'team-a') {
            setTeamAEvents(prev => [...prev, event]);
          } else if (teamId === 'team-b') {
            setTeamBEvents(prev => [...prev, event]);
          } else {
            setTeamAEvents(prev => [...prev, event]);
            setTeamBEvents(prev => [...prev, event]);
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onerror = () => {
        setSseError('WebSocket error');
        setConnected(false);
      };

      ws.onclose = () => {
        setConnected(false);
        // Reconnect with backoff if competition not complete
        if (!intentionalClose && retries < MAX_RETRIES) {
          retries++;
          setTimeout(connect, Math.min(1000 * retries, 5000));
        }
      };
    }

    connect();
    return () => { ws?.close(); };
  }, [id]);

  const teamAScore = result?.teams.find(t => t.teamId === 'team-a');
  const teamBScore = result?.teams.find(t => t.teamId === 'team-b');

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-3 border-b border-gray-800 bg-gray-950 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-gray-500 truncate">{id}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATE_BADGE[state] ?? STATE_BADGE.PENDING}`}>
              {state}
            </span>
            {!connected && !result && (
              <span className="text-xs text-yellow-500 animate-pulse">connecting…</span>
            )}
            {sseError && (
              <span className="text-xs text-red-400">{sseError}</span>
            )}
          </div>
        </div>
        <div className="font-mono text-gray-400 text-sm tabular-nums">
          {formatElapsed(elapsed)}
        </div>
      </header>

      {/* Two-column lane view */}
      <div className="flex flex-1 min-h-0 gap-0 divide-x divide-gray-800">
        {/* Team A Lane */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0 flex items-center justify-between">
            <span className="text-sm font-semibold text-blue-400">Team A</span>
            <span className="text-xs text-gray-600">{teamAEvents.length} events</span>
          </div>
          <div ref={laneARef} className="flex-1 overflow-y-auto p-3 space-y-1 font-mono">
            {teamAEvents.length === 0 && (
              <p className="text-gray-700 text-xs italic">Waiting for events…</p>
            )}
            {teamAEvents.map((event) => (
              <EventRow key={event.eventId} event={event} />
            ))}
          </div>
        </div>

        {/* Team B Lane */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0 flex items-center justify-between">
            <span className="text-sm font-semibold text-purple-400">Team B</span>
            <span className="text-xs text-gray-600">{teamBEvents.length} events</span>
          </div>
          <div ref={laneBRef} className="flex-1 overflow-y-auto p-3 space-y-1 font-mono">
            {teamBEvents.length === 0 && (
              <p className="text-gray-700 text-xs italic">Waiting for events…</p>
            )}
            {teamBEvents.map((event) => (
              <EventRow key={event.eventId} event={event} />
            ))}
          </div>
        </div>
      </div>

      {/* Scoreboard — shown when complete */}
      {result && (
        <div className="shrink-0 border-t border-gray-800 bg-gray-950 px-6 py-5">
          {/* Winner Banner */}
          <div className="text-center mb-4">
            {result.winnerId ? (
              <h2 className="text-2xl font-bold text-yellow-400 tracking-wide">
                Winner: {result.winnerId.toUpperCase()}
              </h2>
            ) : (
              <h2 className="text-2xl font-bold text-gray-400">Draw</h2>
            )}
            {result.summary && (
              <p className="text-sm text-gray-500 mt-1">{result.summary}</p>
            )}
          </div>

          {/* Scores grid */}
          <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
            {[teamAScore, teamBScore].map((team, i) => {
              if (!team) return null;
              const isWinner = team.teamId === result.winnerId;
              return (
                <div
                  key={team.teamId}
                  className={`rounded border p-4 ${isWinner ? 'border-yellow-600 bg-yellow-950/30' : 'border-gray-800 bg-gray-900'}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className={`font-semibold text-sm ${i === 0 ? 'text-blue-400' : 'text-purple-400'}`}>
                      {team.teamId.toUpperCase()}
                    </span>
                    <span className={`text-lg font-bold tabular-nums ${isWinner ? 'text-yellow-400' : 'text-white'}`}>
                      {team.totalScore.toFixed(1)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {team.criteriaScores.map(cs => (
                      <div key={cs.criterionId} className="flex justify-between text-xs">
                        <span className="text-gray-500 truncate">{cs.criterionId}</span>
                        <span className="text-gray-300 tabular-nums ml-2">{cs.score}/{cs.maxScore}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: ArenaEvent }) {
  const style = getEventStyle(event.type);
  const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className={`border-l-2 pl-2 py-0.5 text-xs leading-relaxed ${style}`}>
      <span className="text-gray-600 mr-2">{time}</span>
      <span className="font-semibold mr-2">{event.type}</span>
      <span className="opacity-70">{payloadSummary(event.payload)}</span>
    </div>
  );
}
