import { NextResponse } from 'next/server';

export async function GET() {
  const orchestratorUrl = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${orchestratorUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return NextResponse.json({ ok: res.ok });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
