import { NextResponse } from 'next/server';
import { orchestratorUrl, orchestratorHeaders } from '../../../../../lib/orchestrator';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const res = await fetch(orchestratorUrl(`/competitions/${id}/re-judge`), {
      method: 'POST',
      headers: orchestratorHeaders(true),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: 'Re-judge failed' }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Re-judge failed' }, { status: 500 });
  }
}
