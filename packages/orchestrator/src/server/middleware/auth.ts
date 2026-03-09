import type { Request, Response, NextFunction } from 'express';

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

  if (token !== apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
