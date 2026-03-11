import { NextResponse } from 'next/server';

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
