import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { repo } from './repo.js';
import { runnerRegistry } from './runner-registry.js';
import { isAllowedWsOrigin } from './network.js';
import { isStreamAuthorized } from './stream-ticket.js';
import { isHeuristicScore } from '@arena/shared';

type RawScorecard = {
  teamId: string;
  finalScore: number;
  rank: number;
  agentFailure?: { message: string; exitCode: number };
  judgeResults?: Array<{ judgeId?: string; heuristic?: boolean; scores?: Array<{ criterionId: string; score: number; maxScore?: number; commentary?: string }> }>;
};

type TeamDeliverable = {
  teamId: string;
  files: { path: string; content: string }[];
};

type RawSynthesis = {
  synthesis: string;
  perCriterion: Array<{ criterionId: string; teamId: string; rationale: string }>;
} | null;

function normalizeResult(
  scorecards: RawScorecard[],
  winnerId: string | null,
  opts?: {
    summary?: string | null;
    synthesis?: RawSynthesis;
    presentations?: unknown[] | null;
    forge?: unknown | null;
    deliverables?: TeamDeliverable[] | null;
  },
) {
  return {
    winnerId,
    teams: scorecards.map((sc) => ({
      teamId: sc.teamId,
      totalScore: sc.finalScore,
      criteriaScores: sc.judgeResults?.[0]?.scores?.map(s => ({
        criterionId: s.criterionId,
        score: s.score,
        maxScore: s.maxScore ?? 10,
        commentary: s.commentary ?? '',
      })) ?? [],
      rank: sc.rank,
      // The AI judge failed and the completeness heuristic scored this team.
      ...(isHeuristicScore(sc.judgeResults) ? { heuristic: true } : {}),
      // A team whose agent CLI crashed was not judged; the UI says so.
      ...(sc.agentFailure ? { agentFailure: sc.agentFailure } : {}),
    })),
    ...(opts?.summary ? { summary: opts.summary } : {}),
    ...(opts?.synthesis ? { synthesis: opts.synthesis } : {}),
    ...(opts?.presentations ? { presentations: opts.presentations } : {}),
    ...(opts?.forge ? { forge: opts.forge } : {}),
    ...(opts?.deliverables ? { deliverables: opts.deliverables } : {}),
  };
}

export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (!isAllowedWsOrigin(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const url = req.url ?? '';
    const match = url.match(/^\/competitions\/([^/?]+)\/stream(?:\?(.*))?$/);
    if (!match) {
      socket.destroy();
      return;
    }
    // The origin check above only stops other websites in a browser. When a key
    // is set, reading the stream also needs the key or a ticket for this id.
    if (!isStreamAuthorized(req, match[1], match[2] ?? '')) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, match[1]);
    });
  });

  wss.on('connection', async (ws: WebSocket, _req: IncomingMessage, competitionId: string) => {
    let lastSeq = 0;

    // Client may send { lastSeq: number } to resume from a point
    const onHandshake = (data: Buffer | string) => {
      try {
        const msg = JSON.parse(String(data)) as { lastSeq?: number };
        if (typeof msg.lastSeq === 'number') lastSeq = msg.lastSeq;
      } catch { /* ignore */ }
    };
    ws.once('message', onHandshake);

    // Small delay to allow lastSeq message to arrive before replay
    await new Promise((r) => setTimeout(r, 50));
    ws.off('message', onHandshake); // remove if handshake never arrived

    const send = (payload: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    // Subscribe BEFORE reading history. Events emitted while the history query is
    // in flight are buffered and flushed afterwards, so a (re)connecting viewer
    // cannot miss one (a missed SUB_AGENT_DONE would leave a ghost robot).
    // Events reach the DB fire-and-forget, so the same event can be in both the
    // history and the buffer; eventId dedups them.
    const runner = runnerRegistry.get(competitionId);
    const sentIds = new Set<string>();
    let seq = lastSeq;
    let live = false;
    let closed = false;
    const buffer: Array<() => void> = [];

    const sendLiveEvent = (event: unknown) => {
      const id = (event as { eventId?: string }).eventId;
      if (id !== undefined) {
        if (sentIds.has(id)) return;
        sentIds.add(id);
      }
      seq++;
      send({ ...(event as object), _seq: seq });
    };
    const deliver = (fn: () => void) => { if (live) fn(); else buffer.push(fn); };

    const onArenaEvent = (event: unknown) => deliver(() => sendLiveEvent(event));
    const onStateChange = (state: unknown) => deliver(() => send({ type: 'STATE_CHANGE', state }));
    const onResult = (r: unknown) => deliver(() => {
      const runnerResult = r as { scorecards?: RawScorecard[]; winner?: string | null; presentations?: unknown[]; synthesis?: RawSynthesis; deliverables?: TeamDeliverable[] };
      const normalized = normalizeResult(runnerResult.scorecards ?? [], runnerResult.winner ?? null, {
        synthesis: runnerResult.synthesis,
        presentations: runnerResult.presentations,
        deliverables: runnerResult.deliverables,
      });
      send({ type: 'COMPLETE', result: normalized });
      closed = true;
      ws.close();
    });
    const onError = (err: Error) => deliver(() => { send({ type: 'ERROR', message: err.message }); closed = true; ws.close(); });

    if (runner) {
      runner.on('arenaEvent', onArenaEvent);
      runner.on('stateChange', onStateChange);
      runner.on('result', onResult);
      runner.on('error', onError);
      ws.on('close', () => {
        runner.off('arenaEvent', onArenaEvent);
        runner.off('stateChange', onStateChange);
        runner.off('result', onResult);
        runner.off('error', onError);
      });
    }

    try {
      // Replay past events from Postgres.
      // lastSeq is a per-competition event count (number of events the client has already seen),
      // not a global DB serial — this is stable across concurrent competitions.
      try {
        const pastEvents = await repo.getEvents(competitionId, lastSeq > 0 ? lastSeq : undefined);
        for (let i = 0; i < pastEvents.length; i++) {
          const row = pastEvents[i];
          sentIds.add(row.id);
          send({
            eventId: row.id,
            competitionId: row.competitionId,
            teamId: row.teamId,
            timestamp: row.timestamp,
            type: row.type,
            payload: row.payload,
            metadata: row.metadata,
            _seq: lastSeq + i + 1,
          });
        }
        lastSeq += pastEvents.length;
        seq = lastSeq;
      } catch (err) {
        console.error('[ws] replay error:', err);
      }

      // Flush what arrived during the history read, then go direct.
      for (const fn of buffer) fn();
      buffer.length = 0;
      live = true;
      if (closed) return;

      // Check if already complete
      const result = await repo.getResult(competitionId);
      if (result) {
        const scorecards = (result.scorecards as RawScorecard[]) ?? [];
        const normalized = normalizeResult(scorecards, result.winnerId ?? null, {
          summary: result.summary,
          synthesis: result.synthesis as RawSynthesis,
          presentations: result.presentations as unknown[] | null,
          forge: result.forge,
          deliverables: result.deliverables as TeamDeliverable[] | null,
        });
        send({ type: 'COMPLETE', result: normalized });
        ws.close();
        return;
      }

      if (!runner) {
        send({ type: 'ERROR', message: 'Competition not found — the server may have restarted mid-competition.' });
        ws.close();
        return;
      }
    } catch (err) {
      console.error('[ws] connection error:', err);
      send({ type: 'ERROR', message: err instanceof Error ? err.message : 'Internal error' });
      ws.close();
    }
  });
}
