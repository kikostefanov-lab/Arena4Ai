import { describe, it, expect } from 'vitest';
import { EventType } from '@arena/shared';
import { normalizeLine as claudeLine } from '../claude/claude-normalizer.js';
import { CodexNormalizer } from '../codex/codex-normalizer.js';
import { normalizeLine as geminiLine } from '../gemini/gemini-normalizer.js';
import { PROVIDER_FILE_CAPABILITIES } from '../normalizer-utils.js';

const BASE = { competitionId: 'c', teamId: 't' };

function codexFileEvent(line: string) {
  const n = new CodexNormalizer(BASE);
  n.addLine('OpenAI Codex v0.144.1'); n.addLine('--------');
  n.addLine('workdir: /tmp/x'); n.addLine('model: m'); n.addLine('--------');
  n.addLine('codex'); n.addLine('x'); n.addLine('file update');
  return n.addLine(line)!;
}
const claudeFileEvent = (tool: string, path: string) =>
  claudeLine(JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: tool, input: { file_path: path } }] },
  }), BASE);

/**
 * AA-064. A renderer binding "height = edit count" must not draw a taller city for
 * whichever CLI happens to be chattiest. These tests pin the shared contract.
 */
describe('cross-provider file event parity', () => {
  it('all three providers report a create the same way', () => {
    const evs = [
      claudeFileEvent('Write', '/var/folders/t/arena-team-a-Kq9/solution.py'),
      codexFileEvent('A /tmp/arena-team-a-X/solution.py'),
      geminiLine('Created solution.py for the task', BASE),
    ];
    for (const ev of evs) {
      expect(ev.type).toBe(EventType.FILE_CREATE);
      const p = ev.payload as Record<string, unknown>;
      expect(p.op).toBe('create');
      expect(p.path).toBe('solution.py');   // structured, provider-neutral
      expect(typeof p.text).toBe('string'); // backwards compatibility retained
      expect(typeof p.opSource).toBe('string');
    }
  });

  it('all three providers report a modify the same way — the edit-count field', () => {
    const evs = [
      claudeFileEvent('Edit', '/var/folders/t/arena-team-a-Kq9/solution.py'),
      codexFileEvent('M /tmp/arena-team-a-X/solution.py'),
      geminiLine('Modified solution.py with the fix', BASE),
    ];
    for (const ev of evs) {
      expect(ev.type).toBe(EventType.FILE_MODIFY);
      expect((ev.payload as Record<string, unknown>).op).toBe('modify');
      expect((ev.payload as Record<string, unknown>).path).toBe('solution.py');
    }
  });

  it('every file event carries the four always-present fields', () => {
    const evs = [
      claudeFileEvent('Write', '/var/folders/t/arena-team-a-Kq9/a.py'),
      codexFileEvent('A /tmp/arena-team-a-X/a.py'),
      geminiLine('Wrote a.py', BASE),
    ];
    for (const ev of evs) {
      for (const k of ['op', 'opSource', 'path', 'text']) {
        expect(ev.payload).toHaveProperty(k);
      }
    }
  });

  it('absent is absent: only claude reports tool/input, and the others OMIT them', () => {
    const c = claudeFileEvent('Write', '/var/folders/t/arena-team-a-Kq9/a.py').payload as Record<string, unknown>;
    expect(c.tool).toBe('Write');
    expect(c.input).toBeDefined();

    for (const ev of [codexFileEvent('A /tmp/arena-team-a-X/a.py'), geminiLine('Wrote a.py', BASE)]) {
      const p = ev.payload as Record<string, unknown>;
      // The key must be missing, not present-and-falsy. `?? 0` on a missing key
      // is a bug a renderer can catch; `?? 0` on tool:'unknown' is one it cannot.
      expect('tool' in p).toBe(false);
      expect('input' in p).toBe(false);
    }
  });

  it('opSource states how much the operation can be trusted', () => {
    expect((claudeFileEvent('Edit', '/var/folders/t/arena-team-a-Kq9/a.py').payload as Record<string, unknown>).opSource).toBe('tool');
    expect((codexFileEvent('M /tmp/arena-team-a-X/a.py').payload as Record<string, unknown>).opSource).toBe('marker');
    expect((geminiLine('Modified a.py', BASE).payload as Record<string, unknown>).opSource).toBe('verb');
  });

  it('the published capability table matches what the normalizers actually do', () => {
    expect(PROVIDER_FILE_CAPABILITIES.claude.tool).toBe(true);
    expect(PROVIDER_FILE_CAPABILITIES.codex.tool).toBe(false);
    expect(PROVIDER_FILE_CAPABILITIES.gemini.tool).toBe(false);
    expect(PROVIDER_FILE_CAPABILITIES.codex.opSource).toBe('marker');
    expect(PROVIDER_FILE_CAPABILITIES.gemini.opSource).toBe('verb');
  });
});

describe('toRelativePath — the old codex pattern only matched teams a and b', () => {
  it('strips the workdir for team-c and team-d too', () => {
    const ev = codexFileEvent('M /var/folders/t/arena-team-c-Zz1/main.py');
    expect((ev.payload as Record<string, unknown>).path).toBe('main.py');
    const ev2 = claudeFileEvent('Edit', '/var/folders/t/arena-team-d-Qq2/main.py');
    expect((ev2.payload as Record<string, unknown>).path).toBe('main.py');
  });

  it('leaves a non-workdir path alone rather than mangling it', () => {
    const ev = claudeFileEvent('Write', '/etc/hosts');
    expect((ev.payload as Record<string, unknown>).path).toBe('/etc/hosts');
  });
});
