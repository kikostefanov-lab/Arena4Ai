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
