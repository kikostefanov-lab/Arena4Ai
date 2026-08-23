import { NextRequest, NextResponse } from 'next/server';
import { orchestratorUrl, orchestratorHeaders } from '../../../../../../lib/orchestrator';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upstream = await fetch(orchestratorUrl(`/competitions/${id}/forge/download`), {
    headers: orchestratorHeaders(),
  });
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
