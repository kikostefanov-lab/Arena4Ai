import { orchestratorUrl, orchestratorHeaders } from '../../../../lib/orchestrator';

export async function GET() {
  try {
    const res = await fetch(orchestratorUrl('/analytics/criteria'), {
      headers: orchestratorHeaders(),
      cache: 'no-store',
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: 'Could not reach orchestrator' }, { status: 502 });
  }
}
