import { NextRequest, NextResponse } from 'next/server';
import { orchestratorHeaders } from '../../../lib/orchestrator';

const ORCHESTRATOR = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const res = await fetch(`${ORCHESTRATOR}/agent-profiles${qs ? `?${qs}` : ''}`, { cache: 'no-store' });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${ORCHESTRATOR}/agent-profiles`, {
    method: 'POST',
    headers: orchestratorHeaders(true),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
