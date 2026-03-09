import { orchestratorUrl, orchestratorHeaders } from '../../../lib/orchestrator.js';

export async function GET() {
  const upstream = await fetch(orchestratorUrl('/competitions'), { headers: orchestratorHeaders() });
  const data = await upstream.json();
  return Response.json(data);
}

export async function POST(request: Request) {
  const body = await request.json();

  const upstream = await fetch(
    orchestratorUrl('/competitions'),
    { method: 'POST', headers: orchestratorHeaders(true), body: JSON.stringify(body) }
  );
  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
