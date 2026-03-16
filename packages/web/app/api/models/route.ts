const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export async function GET() {
  const res = await fetch(`${API}/models`);
  const data = await res.json();
  return Response.json(data, {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
  });
}
