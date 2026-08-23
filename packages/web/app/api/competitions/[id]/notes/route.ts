import { NextRequest, NextResponse } from 'next/server';
import { orchestratorUrl, orchestratorHeaders } from '../../../../../lib/orchestrator';

// Next.js 15: params is a Promise — must be awaited
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(orchestratorUrl(`/competitions/${id}/notes`), {
    method: 'PATCH',
    headers: orchestratorHeaders(true),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
