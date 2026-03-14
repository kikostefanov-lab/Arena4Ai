import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json();
  const apiBase = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${apiBase}/generate-brief/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'Generation failed' }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
