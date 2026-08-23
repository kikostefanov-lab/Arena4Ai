// Proxies the orchestrator's /models endpoint at request time. Without this the
// route is statically prerendered during `next build`, which fails because the
// orchestrator is not running at build time.
export const dynamic = 'force-dynamic';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export async function GET() {
  const res = await fetch(`${API}/models`);
  const data = await res.json();
  return Response.json(data, {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
  });
}
