import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const mp4 = path.join('/tmp/arena-reels', `${id}.mp4`);

  if (!fs.existsSync(mp4)) {
    return NextResponse.json({ error: 'Reel not found' }, { status: 404 });
  }

  const stat = fs.statSync(mp4);
  // Stream the file to avoid loading potentially large MP4 into heap
  const nodeStream = fs.createReadStream(mp4);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="arena-recap-${id}.mp4"`,
      'Content-Length': String(stat.size),
    },
  });
}
