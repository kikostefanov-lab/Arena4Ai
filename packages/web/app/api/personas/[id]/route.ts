import { NextRequest, NextResponse } from 'next/server';
import { orchestratorHeaders } from '../../../../lib/orchestrator';

const ORCH = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${ORCH}/personas/${id}`);
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${ORCH}/personas/${id}`, {
    method: 'PATCH',
    headers: orchestratorHeaders(true),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${ORCH}/personas/${id}`, { method: 'DELETE', headers: orchestratorHeaders() });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
