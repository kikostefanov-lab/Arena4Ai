import { NextResponse } from 'next/server';
import { orchestratorHeaders } from '../../../lib/orchestrator';

export async function GET() {
  const apiBase = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${apiBase}/briefs`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const apiBase = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${apiBase}/briefs`, {
      method: 'POST',
      headers: orchestratorHeaders(true),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Save failed' }));
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }
}
