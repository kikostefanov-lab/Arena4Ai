import { NextRequest, NextResponse } from 'next/server';

const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

// Next.js 15: params is a Promise — must be awaited
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${apiBase()}/competitions/${id}/forge`);
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${apiBase()}/competitions/${id}/forge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
