import { orchestratorUrl, orchestratorHeaders } from '../../../../lib/orchestrator';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const res = await fetch(orchestratorUrl(`/competitions/${params.id}`), { headers: orchestratorHeaders() });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action'); // cancel | pause | resume
  if (!action) return Response.json({ error: 'action required' }, { status: 400 });

  const upstream = await fetch(
    orchestratorUrl(`/competitions/${params.id}/${action}`),
    { method: 'POST', headers: orchestratorHeaders() }
  );
  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
