import { NextRequest, NextResponse } from 'next/server';
import { orchestratorUrl, orchestratorHeaders } from '../../../../../lib/orchestrator';

// Next.js 15: params is a Promise — must be awaited
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(orchestratorUrl(`/competitions/${id}/forge`), {
    headers: orchestratorHeaders(),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(orchestratorUrl(`/competitions/${id}/forge`), {
    method: 'POST',
    headers: orchestratorHeaders(true),
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
