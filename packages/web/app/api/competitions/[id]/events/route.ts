import { orchestratorUrl, orchestratorHeaders } from '../../../../../lib/orchestrator';

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const url = new URL(req.url);
  const afterSeq = url.searchParams.get('afterSeq');
  const upstream = await fetch(
    orchestratorUrl(`/competitions/${params.id}/events${afterSeq ? `?afterSeq=${afterSeq}` : ''}`),
    { headers: orchestratorHeaders() },
  );
  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
