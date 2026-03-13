import { NextRequest, NextResponse } from 'next/server';
const ORCH = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${ORCH}/agents/${id}/fork`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
