export async function POST(request: Request) {
  const body = await request.json();
  const apiKey = process.env.ARENA_API_KEY;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const upstream = await fetch(
    `${process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000'}/competitions`,
    { method: 'POST', headers, body: JSON.stringify(body) }
  );
  const data = await upstream.json();
  return Response.json(data, { status: upstream.status });
}
