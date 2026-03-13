import { NextRequest, NextResponse } from 'next/server';

const ORCHESTRATOR = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

// Next.js 15: params is a Promise — must be awaited
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${ORCHESTRATOR}/agent-profiles/${id}/fork`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
