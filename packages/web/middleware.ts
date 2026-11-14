import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkMutationOrigin } from './lib/origin-check';

/**
 * CSRF guard for the orchestrator proxy. See lib/origin-check.ts for the rules.
 * Only mutating /api/* requests are ever rejected; pages and GETs pass through.
 */
export function middleware(req: NextRequest) {
  const result = checkMutationOrigin({
    method: req.method,
    pathname: req.nextUrl.pathname,
    header: (name) => req.headers.get(name),
    allowedOrigins: process.env.ARENA_WEB_ALLOWED_ORIGINS,
  });
  if (!result.ok) {
    return NextResponse.json({ error: 'Forbidden', detail: result.reason }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
