// ORCHESTRATOR_URL is the server-side name; NEXT_PUBLIC_API_URL is kept as a
// fallback because several proxy routes used to read it directly.
const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Headers for every server-to-server call to the orchestrator.
 *
 * Always use this instead of a bare `fetch` header literal: when the operator
 * sets ARENA_API_KEY, the orchestrator's mutating routes start requiring
 * `Authorization: Bearer <key>`, and any proxy route that hand-rolled its
 * headers would begin returning 401 to the UI.
 */
export function orchestratorHeaders(includeContentType = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeContentType) headers['Content-Type'] = 'application/json';
  const apiKey = process.env.ARENA_API_KEY;
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return headers;
}

export function orchestratorUrl(path: string): string {
  return `${ORCHESTRATOR_URL}${path}`;
}
