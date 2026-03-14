import { NextResponse } from 'next/server';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const apiBase = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
  try {
    const res = await fetch(`${apiBase}/briefs/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: 'Delete failed' }));
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
