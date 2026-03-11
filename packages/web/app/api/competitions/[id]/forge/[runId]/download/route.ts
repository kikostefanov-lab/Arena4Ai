import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';

// Next.js 15: params is a Promise — must be awaited
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { id, runId } = await params;
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

  const res = await fetch(`${apiBase}/competitions/${id}/forge`);
  if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const data = await res.json() as { runs: Array<{ id: string; artifacts: Array<{ title: string; content: string }> }> };
  const run = data.runs?.find((r) => r.id === runId);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const zip = new JSZip();
  for (const artifact of run.artifacts) {
    zip.file(`${artifact.title.replace(/\s+/g, '-').toLowerCase()}.md`, artifact.content);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

  return new NextResponse(blob, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="forge-run-${runId.slice(0, 8)}.zip"`,
    },
  });
}
