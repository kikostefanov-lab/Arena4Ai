import { orchestratorUrl, orchestratorHeaders } from '../../../lib/orchestrator';

/**
 * Never prerender this route.
 *
 * It is a PROXY to a live backend, so a cached copy of it is a lie by
 * construction. Next 14 statically evaluates a GET handler that never touches
 * the Request object, and every handler in this file is exactly that shape.
 *
 * What that actually did, measured on a clean build:
 *  - with no orchestrator running, the fetch threw and the export ABORTED
 *    (/api/analytics and /api/leaderboard), or was swallowed and a frozen error
 *    response was baked in (/api/health shipped {"ok":false} 503 forever);
 *  - with an orchestrator running, the build SUCCEEDED and baked that machine's
 *    real database into a static file — .next/server/app/api/leaderboard.body
 *    held actual standings, analytics.body held 26 real competitions — served
 *    as a 200 for the life of the deployment. That one is worse: the build is
 *    green, so nothing reports it.
 *
 * Some routes here were dynamic only by ACCIDENT — because they also export a
 * POST, or because one fetch happened to pass `cache: 'no-store'`. Delete the
 * POST and the route silently becomes a cached proxy again. The declaration is
 * explicit so that cannot happen quietly.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const res = await fetch(orchestratorUrl('/tournaments'), { headers: orchestratorHeaders() });
  const data = await res.json();
  return Response.json(data);
}

export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch(orchestratorUrl('/tournaments'), {
    method: 'POST',
    headers: orchestratorHeaders(true),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
