import { NextRequest, NextResponse } from 'next/server';
import { orchestratorUrl, orchestratorHeaders } from '../../../../../../../lib/orchestrator';

// Next.js 15: params is a Promise — must be awaited
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const { id, teamId } = await params;
  const upstream = orchestratorUrl(`/competitions/${id}/deliverables/${encodeURIComponent(teamId)}/download`);

  const res = await fetch(upstream, { headers: orchestratorHeaders() });
  if (!res.ok) {
    return NextResponse.json({ error: 'Download failed' }, { status: res.status });
  }

  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? 'attachment; filename="files.zip"';

  return new NextResponse(blob, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': cd,
    },
  });
}
