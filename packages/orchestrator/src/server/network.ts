/**
 * Where the orchestrator listens, and which browser origins may open its
 * WebSocket. Pure functions so they can be tested without a socket.
 */

export const DEFAULT_HOST = '127.0.0.1';

/** CLI flag wins, then ARENA_HOST, then loopback. */
export function resolveHost(
  cliHost: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const chosen = (cliHost ?? env.ARENA_HOST ?? '').trim();
  return chosen || DEFAULT_HOST;
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === '127.0.0.1' || h.startsWith('127.');
}

/**
 * A warning to print at startup, or null when the bind is safe. "Safe" means
 * loopback, or an exposed bind with ARENA_API_KEY set.
 */
export function exposureWarning(host: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (isLoopbackHost(host) || env.ARENA_API_KEY) return null;
  return (
    `[arena] WARNING: listening on ${host} (not loopback) with ARENA_API_KEY unset. ` +
    'Anyone who can reach this port can launch competitions and spawn agent CLIs on this machine ' +
    'under your login. Set ARENA_API_KEY, or bind to 127.0.0.1.'
  );
}

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i;

/**
 * Origin allow-list for the WebSocket upgrade. This stops a page on another
 * site from opening the stream from the viewer's browser (cross-site WebSocket
 * hijacking). It is NOT authentication: a non-browser client can send any
 * Origin, or none.
 *
 * - No Origin header (curl, node scripts, the CLI): allowed.
 * - ARENA_ALLOWED_ORIGINS unset: loopback origins on any port.
 * - ARENA_ALLOWED_ORIGINS="https://a.example,https://b.example": exactly those
 *   (plus loopback). "*" allows every origin.
 */
export function isAllowedWsOrigin(
  origin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!origin) return true;
  const configured = (env.ARENA_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (configured.includes('*')) return true;
  if (LOOPBACK_ORIGIN.test(origin)) return true;
  return configured.includes(origin.replace(/\/$/, ''));
}
