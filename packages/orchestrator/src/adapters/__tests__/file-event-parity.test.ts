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
/** gemini's primary path since AA-037: `-o stream-json` tool_use events. */
const geminiFileEvent = (tool_name: string, file_path: string, extra: Record<string, unknown> = {}) =>
  geminiLine(JSON.stringify({ type: 'tool_use', tool_name, tool_id: 'g1', parameters: { file_path, ...extra } }), BASE);

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
      geminiFileEvent('write_file', '/var/folders/t/arena-team-c-Kq9/solution.py'),
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
      geminiFileEvent('replace', '/var/folders/t/arena-team-c-Kq9/solution.py', { old_string: 'a' }),
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
      geminiFileEvent('write_file', '/var/folders/t/arena-team-c-Kq9/a.py'),
    ];
    for (const ev of evs) {
      for (const k of ['op', 'opSource', 'path', 'text']) {
        expect(ev.payload).toHaveProperty(k);
      }
    }
  });

  it('absent is absent: codex omits tool/input entirely — claude and gemini report them', () => {
    // AA-037 moved gemini into the reporting camp. Codex stays out of it by
    // nature, not by neglect: it applies edits via apply_patch and names no
    // per-file tool, so the keys are MISSING rather than present-and-falsy.
    for (const ev of [
      claudeFileEvent('Write', '/var/folders/t/arena-team-a-Kq9/a.py'),
      geminiFileEvent('write_file', '/var/folders/t/arena-team-c-Kq9/a.py'),
    ]) {
      const p = ev.payload as Record<string, unknown>;
      expect(typeof p.tool).toBe('string');
      expect(p.input).toBeDefined();
    }

    const codex = codexFileEvent('A /tmp/arena-team-a-X/a.py').payload as Record<string, unknown>;
    expect('tool' in codex).toBe(false);
    expect('input' in codex).toBe(false);
  });

  it('opSource states how much the operation can be trusted', () => {
    expect((claudeFileEvent('Edit', '/var/folders/t/arena-team-a-Kq9/a.py').payload as Record<string, unknown>).opSource).toBe('tool');
    expect((codexFileEvent('M /tmp/arena-team-a-X/a.py').payload as Record<string, unknown>).opSource).toBe('marker');
    expect((geminiFileEvent('replace', 'a.py', { old_string: 'x' }).payload as Record<string, unknown>).opSource).toBe('tool');
  });

  it('the published capability table matches what the normalizers actually do', () => {
    expect(PROVIDER_FILE_CAPABILITIES.claude.tool).toBe(true);
    expect(PROVIDER_FILE_CAPABILITIES.codex.tool).toBe(false);
    expect(PROVIDER_FILE_CAPABILITIES.gemini.tool).toBe(true);   // AA-037: stream-json
    expect(PROVIDER_FILE_CAPABILITIES.codex.opSource).toBe('marker');
    expect(PROVIDER_FILE_CAPABILITIES.gemini.opSource).toBe('tool'); // AA-037: was 'verb'
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
