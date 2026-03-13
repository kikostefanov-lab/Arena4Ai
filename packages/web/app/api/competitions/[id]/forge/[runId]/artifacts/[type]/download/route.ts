import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import JSZip from 'jszip';
import type { ForgeArtifact, ForgeOutputFormat } from '@arena/shared';
import { expandMultiFileArtifact } from '../../../../../../../../../lib/forge-zip-utils';

const CONTENT_TYPES: Record<ForgeOutputFormat, string> = {
  markdown:   'text/markdown',
  sql:        'text/plain',
  yaml:       'text/yaml',
  dockerfile: 'text/plain',
  csv:        'text/csv',
  json:       'application/json',
  text:       'text/plain',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string; type: string }> }
) {
  const { id, runId, type: artifactType } = await params;

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  const forgeRes = await fetch(`${apiBase}/competitions/${id}/forge`);
  if (!forgeRes.ok) {
    return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  }

  const forgeData = await forgeRes.json() as { runs?: Array<{ id: string; artifacts: ForgeArtifact[]; forgeModel?: string }> };
  const run = forgeData.runs?.find(r => r.id === runId);
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const artifact = run.artifacts.find(a => a.type === artifactType);
  if (!artifact) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
  }

  // Multi-file types: return a sub-ZIP
  if (artifact.type === 'reference_implementation' || artifact.type === 'test_suite_template') {
    const zip = new JSZip();
    expandMultiFileArtifact(zip, artifact);
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const zipName = artifact.type === 'reference_implementation' ? 'src-files.zip' : 'test-files.zip';
    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
      },
    });
  }

  // Single-file: return raw content with correct Content-Type
  const contentType = CONTENT_TYPES[artifact.outputFormat] ?? 'text/plain';
  const basename = path.basename(artifact.filename);
  return new NextResponse(artifact.content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${basename}"`,
    },
  });
}
