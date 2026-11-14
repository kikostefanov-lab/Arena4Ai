import { orchestratorUrl, orchestratorHeaders } from '../../../../../lib/orchestrator';

/**
 * A short-lived pass for this competition's WebSocket stream.
 *
 * The browser opens the stream straight to the orchestrator and cannot hold the
 * server's API key, so this route (running on the server, with the key) asks
 * the orchestrator for a ticket and returns only that. With no key configured
 * the orchestrator answers `{ ticket: null }` and the stream is open.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const upstream = await fetch(orchestratorUrl(`/competitions/${encodeURIComponent(id)}/stream-ticket`), {
      headers: orchestratorHeaders(),
      cache: 'no-store',
    });
    const data = await upstream.json();
    return Response.json(data, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ticket: null, expiresInMs: null }, { status: 502 });
  }
}
