import { orchestratorUrl, orchestratorHeaders } from '../../../lib/orchestrator';

export async function GET() {
  const res = await fetch(orchestratorUrl('/analytics/summary'), {
    headers: orchestratorHeaders(),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
