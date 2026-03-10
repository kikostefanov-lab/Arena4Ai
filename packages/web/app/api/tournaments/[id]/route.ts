import { orchestratorUrl, orchestratorHeaders } from '../../../../lib/orchestrator';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const res = await fetch(orchestratorUrl(`/tournaments/${params.id}`), {
    headers: orchestratorHeaders(),
  });
  if (!res.ok) return Response.json({ error: 'Not found' }, { status: 404 });
  const data = await res.json();
  return Response.json(data);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const res = await fetch(orchestratorUrl(`/tournaments/${params.id}`), {
    method: 'DELETE',
    headers: orchestratorHeaders(),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  if (!action) return Response.json({ error: 'action required' }, { status: 400 });

  const upstream = await fetch(
    orchestratorUrl(`/tournaments/${params.id}/${action}`),
    { method: 'POST', headers: orchestratorHeaders() }
  );
  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
