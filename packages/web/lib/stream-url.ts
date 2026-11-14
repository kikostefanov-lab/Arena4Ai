/**
 * Build the WebSocket URL for a competition's live stream.
 *
 * Fetches a fresh ticket on every call, because tickets are short-lived and a
 * reconnect after a drop needs a new one. If the ticket request fails (or no
 * key is configured, in which case the ticket is null) the bare URL is
 * returned: with no key the stream is open, and with a key the orchestrator
 * will refuse it, which the caller's normal retry handles.
 */
export async function streamUrl(wsBase: string, competitionId: string): Promise<string> {
  const base = `${wsBase}/competitions/${competitionId}/stream`;
  try {
    const res = await fetch(`/api/competitions/${encodeURIComponent(competitionId)}/stream-ticket`, { cache: 'no-store' });
    if (!res.ok) return base;
    const { ticket } = (await res.json()) as { ticket?: string | null };
    return ticket ? `${base}?ticket=${encodeURIComponent(ticket)}` : base;
  } catch {
    return base;
  }
}
