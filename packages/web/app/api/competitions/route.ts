export async function POST(req: Request) {
  const body = await req.json();
  const res = await fetch('http://localhost:3000/competitions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
