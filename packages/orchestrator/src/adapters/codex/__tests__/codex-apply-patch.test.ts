import { describe, it, expect } from 'vitest';
import { CodexNormalizer } from '../codex-normalizer.js';
import { EventType } from '@arena/shared';

/**
 * AA-079 (a) — the apply_patch / unified-diff regression oracle.
 *
 * PROVENANCE. Competition ebb45f36-250c-4084-b87f-d58bb52129b1 (Voice-to-Sheet,
 * claude vs codex) delivered SEVENTEEN files for team-b and produced FOUR
 * FILE_CREATE events. The 17 paths below are `results.deliverables` for that
 * team, verbatim, and the line shapes below are the ones actually present in its
 * stored stream — including the trailing colon on `file update:` and the `a//`
 * double slash that git produces when the paths are absolute.
 *
 * WHAT IS REAL AND WHAT IS RECONSTRUCTED, stated plainly because it matters for
 * how much this test proves: the PATHS and the LINE SHAPES are real. The exact
 * interleaving is not replayable — `events.seq` is assigned by fire-and-forget
 * writes, so the stored order of a diff's own lines is scrambled — so the blocks
 * here are reassembled into the order git emits them. This test therefore pins
 * the parser against the real format and the real manifest, not against a byte
 * capture of one run.
 */

const BASE = { competitionId: 'ebb45f36', teamId: 'team-b' };
const WORKDIR = '/private/var/folders/8q/mdrhff0x40db3yk_5t24hmkw0000gq/T/arena-team-b-Sy9nCY';

/** `results.deliverables` for team-b, exactly. This is the bijection target. */
const DELIVERABLES = [
  '.env.example', '.gitignore', 'app/app.js', 'app/icon.svg', 'app/index.html',
  'app/styles.css', 'manifest.json', 'package.json', 'README.md',
  'server/auth.mjs', 'server/deepgram.mjs', 'server/dtools.mjs', 'server/extract.mjs',
  'server/googleSheets.mjs', 'server/index.mjs', 'service-worker.js', 'setup-guide.md',
];

function skipHeader(n: CodexNormalizer) {
  n.addLine('OpenAI Codex v0.108.0-alpha.12 (research preview)');
  n.addLine('--------');
  n.addLine(`workdir: ${WORKDIR}`);
  n.addLine('--------');
  n.addLine('codex');
}

/** One new-file hunk, in the shape codex actually emits. */
function newFileBlock(path: string): string[] {
  return [
    `diff --git a/${WORKDIR}/${path} b/${WORKDIR}/${path}`,
    'new file mode 100644',
    'index 0000000000000000000000000000000000000000..e11853a1fff11c2a34d39e87844fb1a24fb87cef',
    '--- /dev/null',
    `+++ b/${WORKDIR}/${path}`,
    '@@ -0,0 +1,3 @@',
    '+first line of content',
    '+',
    '+third line',
  ];
}

function collect(lines: string[], n = new CodexNormalizer(BASE)) {
  const events = [];
  for (const line of lines) {
    const ev = n.addLine(line);
    if (ev) events.push(ev);
  }
  return events;
}

describe('CodexNormalizer — apply_patch / unified diff (AA-079)', () => {
  it('recovers all 17 deliverables from one apply_patch block — the bijection', () => {
    const lines = ['file update:', ...DELIVERABLES.flatMap(newFileBlock)];
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    const events = collect(lines, n);

    const fileEvents = events.filter(
      (e) => e.type === EventType.FILE_CREATE || e.type === EventType.FILE_MODIFY,
    );
    const paths = fileEvents.map((e) => (e.payload as { path?: string }).path);

    // No duplicates: `diff --git` and `+++` both name the file, exactly one wins.
    expect(new Set(paths).size).toBe(paths.length);
    // ONLY_IN_DIFF === 0 and ONLY_IN_DELIVERABLES === 0.
    expect([...paths].sort()).toEqual([...DELIVERABLES].sort());
    expect(paths).toHaveLength(17);
  });

  it('parses a patch block even without the "file update:" header', () => {
    // While the keyword test required a bare `file update`, every one of these
    // blocks arrived in reasoning mode. Parsing must not depend on the header.
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    const events = collect(newFileBlock('server/index.mjs'), n);
    const files = events.filter((e) => e.type === EventType.FILE_CREATE);
    expect(files).toHaveLength(1);
    expect((files[0].payload as { path?: string }).path).toBe('server/index.mjs');
  });

  it('accepts "file update:" with the trailing colon', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    const events = collect(['file update:', `A ${WORKDIR}/solution.py`], n);
    expect(events.filter((e) => e.type === EventType.FILE_CREATE)).toHaveLength(1);
  });

  it('keeps EVERY file of a multi-file A/M block, not just the first', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    const events = collect([
      'file update',
      `A ${WORKDIR}/one.py`,
      `M ${WORKDIR}/two.py`,
      `A ${WORKDIR}/three.py`,
    ], n);
    const files = events.filter(
      (e) => e.type === EventType.FILE_CREATE || e.type === EventType.FILE_MODIFY,
    );
    expect(files.map((e) => (e.payload as { path?: string }).path))
      .toEqual(['one.py', 'two.py', 'three.py']);
    // The A/M marker still decides the operation.
    expect(files[1].type).toBe(EventType.FILE_MODIFY);
  });

  it('reports a modify when git does not say "new file mode"', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    const events = collect([
      `diff --git a/${WORKDIR}/README.md b/${WORKDIR}/README.md`,
      'index e11853a..c79b888 100644',
      `--- a/${WORKDIR}/README.md`,
      `+++ b/${WORKDIR}/README.md`,
      '@@ -1,2 +1,3 @@',
      '+added a line',
    ], n);
    const files = events.filter((e) => e.type === EventType.FILE_MODIFY);
    expect(files).toHaveLength(1);
    expect((files[0].payload as { op: string; opSource: string }).op).toBe('modify');
    expect((files[0].payload as { opSource: string }).opSource).toBe('marker');
  });

  it('does NOT invent a create for a deleted file', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    const events = collect([
      `diff --git a/${WORKDIR}/old.js b/${WORKDIR}/old.js`,
      'deleted file mode 100644',
      `--- a/${WORKDIR}/old.js`,
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-gone',
    ], n);
    expect(events.filter(
      (e) => e.type === EventType.FILE_CREATE || e.type === EventType.FILE_MODIFY,
    )).toHaveLength(0);
  });

  it('does not turn diff body lines into files or reasoning noise', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    const events = collect(newFileBlock('app/app.js'), n);
    // Exactly one event: the file. Every structural and body line is swallowed.
    expect(events).toHaveLength(1);
  });

  it('resumes normal reasoning after a patch block ends', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    collect(newFileBlock('manifest.json'), n);
    const ev = n.addLine('Now wiring the service worker.');
    expect(ev?.type).toBe(EventType.REASONING);
    expect((ev?.payload as { text: string }).text).toBe('Now wiring the service worker.');
  });
});
