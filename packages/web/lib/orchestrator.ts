const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

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
