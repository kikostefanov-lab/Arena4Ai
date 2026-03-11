import { NextRequest, NextResponse } from 'next/server';

// Next.js 15: params is a Promise — must be awaited
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; teamId: string }> }
) {
  const { id, teamId } = await params;
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  const upstream = `${apiBase}/competitions/${id}/deliverables/${teamId}/download`;

  const res = await fetch(upstream);
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
