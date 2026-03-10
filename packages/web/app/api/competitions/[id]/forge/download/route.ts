import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await fetch(`${API_BASE}/competitions/${id}/forge/download`);
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Download failed' }, { status: upstream.status });
  }
  const blob = await upstream.blob();
  const disposition = upstream.headers.get('Content-Disposition') ?? `attachment; filename="${id}-forge.zip"`;
  return new NextResponse(blob, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': disposition,
    },
  });
}
