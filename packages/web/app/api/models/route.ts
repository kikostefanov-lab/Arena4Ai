import { orchestratorHeaders, orchestratorUrl } from '../../../lib/orchestrator';

// Proxies the orchestrator's /models endpoint at request time. Without this the
// route is statically prerendered during `next build`, which fails because the
// orchestrator is not running at build time.
export const dynamic = 'force-dynamic';

export async function GET() {
  const res = await fetch(orchestratorUrl('/models'), { headers: orchestratorHeaders(), cache: 'no-store' });
  const data = await res.json();
  // The list is read live from the installed agent CLIs (the orchestrator caches
  // it for a few minutes), so keep browser caching short: a new model should
  // show up in the pickers without a day-long wait.
  return Response.json(data, {
    status: res.status,
    headers: { 'Cache-Control': 'private, max-age=60' },
  });
}
