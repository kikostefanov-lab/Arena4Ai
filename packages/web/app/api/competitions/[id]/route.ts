export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const res = await fetch(`http://localhost:3000/competitions/${params.id}`);
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

  const orchestratorUrl = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
  const apiKey = process.env.ARENA_API_KEY;
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const upstream = await fetch(
    `${orchestratorUrl}/competitions/${params.id}/${action}`,
    { method: 'POST', headers }
  );
  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
