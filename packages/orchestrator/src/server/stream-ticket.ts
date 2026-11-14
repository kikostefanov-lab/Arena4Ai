/**
 * Authentication for the WebSocket event stream.
 *
 * When ARENA_API_KEY is set every HTTP route needs it, but a browser cannot put
 * an Authorization header on a WebSocket, and the server key must never be
 * shipped to a browser. So the stream accepts either:
 *
 *  - `Authorization: Bearer <ARENA_API_KEY>` on the upgrade (scripts, tools), or
 *  - `?ticket=<ticket>`: a short-lived pass for ONE competition, issued by the
 *    authenticated `GET /competitions/:id/stream-ticket`. The web app's server
 *    fetches it with the key and hands only the ticket to the browser.
 *
 * A ticket is `<expiryMs>.<hmac>` where the HMAC (keyed with ARENA_API_KEY)
 * covers the competition id and the expiry. It grants nothing but reading that
 * one stream until it expires. With no key set, the stream is open, as before.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const STREAM_TICKET_TTL_MS = 60_000;

function sign(competitionId: string, expiresAt: number, key: string): string {
  return createHmac('sha256', key).update(`stream:${competitionId}:${expiresAt}`).digest('hex');
}

/** Constant-time string comparison that does not leak length via an exception. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function issueStreamTicket(
  competitionId: string,
  key: string,
  now: number = Date.now(),
  ttlMs: number = STREAM_TICKET_TTL_MS,
): string {
  const expiresAt = now + ttlMs;
  return `${expiresAt}.${sign(competitionId, expiresAt, key)}`;
}

export function verifyStreamTicket(
  ticket: string | null | undefined,
  competitionId: string,
  key: string,
  now: number = Date.now(),
): boolean {
  if (!ticket) return false;
  const dot = ticket.indexOf('.');
  if (dot <= 0) return false;
  const expiresAt = Number(ticket.slice(0, dot));
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  return safeEqual(ticket.slice(dot + 1), sign(competitionId, expiresAt, key));
}

/** May this upgrade request read this competition's stream? */
export function isStreamAuthorized(
  req: { headers: { authorization?: string } },
  competitionId: string,
  query: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): boolean {
  const key = env.ARENA_API_KEY;
  if (!key) return true;
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ') && safeEqual(header.slice(7), key)) return true;
  return verifyStreamTicket(new URLSearchParams(query).get('ticket'), competitionId, key, now);
}
