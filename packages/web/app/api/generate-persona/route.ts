import { NextRequest, NextResponse } from 'next/server';
const ORCH = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${ORCH}/generate-persona`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
