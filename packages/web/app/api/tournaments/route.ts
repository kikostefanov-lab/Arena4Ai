import { orchestratorUrl, orchestratorHeaders } from '../../../lib/orchestrator';

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
