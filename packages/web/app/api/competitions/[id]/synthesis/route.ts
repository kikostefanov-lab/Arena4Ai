import { NextRequest, NextResponse } from 'next/server';

// Next.js 15: params is a Promise — must be awaited
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  const res = await fetch(`${apiBase}/competitions/${id}/synthesis`, { method: 'POST' });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
