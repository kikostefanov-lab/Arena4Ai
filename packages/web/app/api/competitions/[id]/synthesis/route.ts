import { NextRequest, NextResponse } from 'next/server';
import { orchestratorUrl, orchestratorHeaders } from '../../../../../lib/orchestrator';

// Next.js 15: params is a Promise — must be awaited
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(orchestratorUrl(`/competitions/${id}/synthesis`), {
    method: 'POST',
    headers: orchestratorHeaders(),
  });
  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
