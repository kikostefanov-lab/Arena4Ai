import { NextRequest, NextResponse } from 'next/server';
import { orchestratorHeaders } from '../../../../lib/orchestrator';
const ORCH = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${ORCH}/agents/${id}`);
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${ORCH}/agents/${id}`, {
    method: 'PATCH', headers: orchestratorHeaders(true), body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${ORCH}/agents/${id}`, { method: 'DELETE', headers: orchestratorHeaders() });
  return NextResponse.json(await res.json(), { status: res.status });
}
