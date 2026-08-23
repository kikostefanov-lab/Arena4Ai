import { NextResponse } from 'next/server';
import { orchestratorHeaders } from '../../../lib/orchestrator';

export async function POST(req: Request) {
  const { idea, format } = await req.json();
  if (!idea || typeof idea !== 'string' || idea.trim().length < 10) {
    return NextResponse.json({ error: 'Idea too short' }, { status: 400 });
  }

  const orchestratorUrl = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
  const res = await fetch(`${orchestratorUrl}/generate-brief`, {
    method: 'POST',
    headers: orchestratorHeaders(true),
    body: JSON.stringify({ idea: idea.trim(), format }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
  return NextResponse.json(await res.json());
}
