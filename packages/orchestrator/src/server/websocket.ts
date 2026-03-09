import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { db } from '../db/client.js';
import { CompetitionRepository } from '../db/repository.js';
import { runnerRegistry } from './runner-registry.js';

const repo = new CompetitionRepository(db);

export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = req.url ?? '';
    const match = url.match(/^\/competitions\/([^/]+)\/stream$/);
    if (!match) {
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
    ws.once('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as { lastSeq?: number };
        if (typeof msg.lastSeq === 'number') lastSeq = msg.lastSeq;
      } catch { /* ignore */ }
    });

    // Small delay to allow lastSeq message to arrive before replay
    await new Promise((r) => setTimeout(r, 50));

    const send = (payload: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    // Replay past events from Postgres
    try {
      const pastEvents = await repo.getEvents(competitionId, lastSeq > 0 ? lastSeq : undefined);
      for (const row of pastEvents) {
        send({
          eventId: row.id,
          competitionId: row.competitionId,
          teamId: row.teamId,
          timestamp: row.timestamp,
          type: row.type,
          payload: row.payload,
          metadata: row.metadata,
          _seq: row.seq,
        });
      }
      if (pastEvents.length > 0) {
        lastSeq = pastEvents[pastEvents.length - 1].seq;
      }
    } catch (err) {
      console.error('[ws] replay error:', err);
    }

    // Check if already complete
    const result = await repo.getResult(competitionId);
    if (result) {
      send({ type: 'COMPLETE', result });
      ws.close();
      return;
    }

    // Subscribe to live events from the active runner
    const runner = runnerRegistry.get(competitionId);
    if (!runner) {
      ws.close();
      return;
    }

    let seq = lastSeq;
    const onArenaEvent = (event: unknown) => { seq++; send({ ...(event as object), _seq: seq }); };
    const onStateChange = (state: unknown) => { send({ type: 'STATE_CHANGE', state }); };
    const onResult = (r: unknown) => { send({ type: 'COMPLETE', result: r }); ws.close(); };
    const onError = (err: Error) => { send({ type: 'ERROR', message: err.message }); ws.close(); };

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
  });
}
