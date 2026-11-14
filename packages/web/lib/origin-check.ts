/**
 * Same-origin guard for state-changing `/api/*` requests.
 *
 * The proxy routes attach the operator's ARENA_API_KEY server-side, so any page
 * that can make the victim's browser send a POST to this app (a classic CSRF)
 * would be exercising the operator's key. This rejects browser requests that
 * did not originate from this app.
 *
 * Pure function, no Next imports, so the orchestrator test suite can exercise
 * it (the web package has no test runner of its own).
 *
 * Rules, in order, for POST/PUT/PATCH/DELETE on /api/*:
 *  1. Sec-Fetch-Site (sent by every current browser, not forgeable by page JS):
 *     `same-origin` and `none` (user-initiated) pass; `same-site` and
 *     `cross-site` are rejected. `same-site` is rejected on purpose: another
 *     port on localhost is same-site.
 *  2. Otherwise, if Origin is present, its host must equal the request's Host
 *     (or X-Forwarded-Host), or be listed in ARENA_WEB_ALLOWED_ORIGINS.
 *  3. Neither header: not a browser (curl, server-side, scripts). Allowed;
 *     CSRF requires a browser, and a non-browser caller can reach the
 *     orchestrator or this port directly anyway.
 */

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface OriginCheckInput {
  method: string;
  pathname: string;
  /** Case-insensitive header lookup. */
  header: (name: string) => string | null | undefined;
  /** Comma-separated extra origins, normally process.env.ARENA_WEB_ALLOWED_ORIGINS. */
  allowedOrigins?: string;
}

export interface OriginCheckResult {
  ok: boolean;
  reason?: string;
}

export function checkMutationOrigin(input: OriginCheckInput): OriginCheckResult {
  if (!MUTATING.has(input.method.toUpperCase())) return { ok: true };
  if (!input.pathname.startsWith('/api/')) return { ok: true };

  const extra = (input.allowedOrigins ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const origin = input.header('origin')?.trim();
  const originAllowedExplicitly =
    !!origin && (extra.includes('*') || extra.includes(origin.replace(/\/$/, '')));

  const fetchSite = input.header('sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite) {
    if (fetchSite === 'same-origin' || fetchSite === 'none') return { ok: true };
    if (originAllowedExplicitly) return { ok: true };
    return { ok: false, reason: `cross-site request blocked (Sec-Fetch-Site: ${fetchSite})` };
  }

  if (origin) {
    if (originAllowedExplicitly) return { ok: true };
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return { ok: false, reason: 'cross-site request blocked (unparseable Origin)' };
    }
    const hosts = [input.header('x-forwarded-host'), input.header('host')]
      .filter((h): h is string => !!h)
      .flatMap((h) => h.split(',').map((s) => s.trim()));
    if (hosts.includes(originHost)) return { ok: true };
    return { ok: false, reason: 'cross-site request blocked (Origin does not match Host)' };
  }

  return { ok: true };
}
