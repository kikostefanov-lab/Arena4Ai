import type { Request, Response, NextFunction } from 'express';
import { safeEqual } from '../stream-ticket.js';

/**
 * Checks Authorization: Bearer <ARENA_API_KEY> on the request.
 * If ARENA_API_KEY is not set in the environment, auth is disabled (dev mode).
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.ARENA_API_KEY;
  if (!apiKey) {
    // Auth disabled — no key configured
    next();
    return;
  }

  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!safeEqual(token, apiKey)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

/**
 * Strict guard: when ARENA_API_KEY is set, EVERY request needs the key except
 * `/health` (liveness probes) and OPTIONS (CORS preflight, which cannot carry
 * credentials). When the key is unset, everything is open.
 */
export function requireApiKeyForAll(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS' || req.path === '/health') {
    next();
    return;
  }
  requireApiKey(req, res, next);
}

/** Verbs that can change state, spend tokens, or start work on the host. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * App-wide guard: every mutating request needs the key, read-only requests
 * do not.
 *
 * This exists because per-router `requireApiKey` calls are a list you have to
 * remember to add to. It was applied to the competitions router only, which
 * left POST /tournaments (it launches competitions), the brief and persona
 * writes, and the /generate-* routes (they spawn the `claude` CLI under the
 * operator's own login) reachable by anyone who could reach the port.
 *
 * OPTIONS is answered earlier, by the CORS preflight handler, so a browser
 * preflight never hits this.
 */
export function requireApiKeyForMutations(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }
  requireApiKey(req, res, next);
}
