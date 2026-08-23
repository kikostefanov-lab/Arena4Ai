import { NextRequest, NextResponse } from 'next/server';
import { orchestratorHeaders } from '../../../lib/orchestrator';

const ORCH = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.toString();
  const res = await fetch(`${ORCH}/agents${search ? '?' + search : ''}`);
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${ORCH}/agents`, {
    method: 'POST',
    headers: orchestratorHeaders(true),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
