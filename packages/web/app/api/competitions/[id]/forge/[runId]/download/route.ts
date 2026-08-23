import { NextRequest, NextResponse } from 'next/server';
import type { ForgeArtifact } from '@arena/shared';
import { resolveZipPath, expandMultiFileArtifact } from '../../../../../../../lib/forge-zip-utils';
import { orchestratorUrl, orchestratorHeaders } from '../../../../../../../lib/orchestrator';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { id, runId } = await params;
  // Fetch forge data and competition brief in parallel
  const headers = orchestratorHeaders();
  const [forgeRes, compRes] = await Promise.all([
    fetch(orchestratorUrl(`/competitions/${id}/forge`), { headers }),
    fetch(orchestratorUrl(`/competitions/${id}`), { headers }),
  ]);

  if (!forgeRes.ok || !compRes.ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  type ForgeSourceLiteral = 'winner' | 'loser' | 'synthesis';
  const { runs } = await forgeRes.json() as { runs: Array<{ id: string; source: ForgeSourceLiteral; forgeModel: string; generatedAt: string; artifacts: Array<{ type: string; title: string; content: string; outputFormat: string; filename: string }> }> };
  const comp = await compRes.json() as { brief?: { id?: string; title?: string } };

  const run = runs.find((r) => r.id === runId);
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  // Build filename using brief slug + source + timestamp
  // Note: web cannot import from orchestrator — slug/date logic is intentionally duplicated here
  const briefId = comp.brief?.id ?? '';
  const briefTitle = comp.brief?.title ?? id;
  const slug = (briefId || briefTitle)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  const ts = new Date(run.generatedAt);
  const dateStr = [
    ts.getUTCFullYear(),
    String(ts.getUTCMonth() + 1).padStart(2, '0'),
    String(ts.getUTCDate()).padStart(2, '0'),
  ].join('');
  const timeStr = [
    String(ts.getUTCHours()).padStart(2, '0'),
    String(ts.getUTCMinutes()).padStart(2, '0'),
    String(ts.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  const filename = `arena4ai_${slug}_${run.source}_${dateStr}-${timeStr}_forge-run.zip`;

  // Build ZIP using JSZip
  // IMPORTANT: use type: 'nodebuffer' (not 'blob') — NextResponse requires Buffer/Uint8Array
  const JSZipModule = (await import('jszip')).default;
  const zip = new JSZipModule();
  for (const artifact of run.artifacts as ForgeArtifact[]) {
    if (artifact.type === 'reference_implementation' || artifact.type === 'test_suite_template') {
      expandMultiFileArtifact(zip, artifact);
    } else {
      const zipPath = resolveZipPath(artifact);
      if (zipPath) {
        zip.file(zipPath, artifact.content);
      }
    }
  }
  // Add metadata
  zip.file('_metadata.json', JSON.stringify({
    competitionId: id,
    briefId: comp.brief?.id ?? '',
    briefTitle: comp.brief?.title ?? '',
    forgeSource: run.source,
    forgeModel: run.forgeModel,
    generatedAt: run.generatedAt,
    arena4aiVersion: '2.0',
  }, null, 2));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
