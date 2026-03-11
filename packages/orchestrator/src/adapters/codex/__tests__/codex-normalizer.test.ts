import { describe, it, expect } from 'vitest';
import { CodexNormalizer } from '../codex-normalizer.js';
import { EventType } from '@arena/shared';

const BASE = { competitionId: 'comp-1', teamId: 'team-b' };

/** Advance the normalizer past the standard Codex banner header. */
function skipHeader(n: CodexNormalizer) {
  n.addLine('OpenAI Codex v0.108.0-alpha.12 (research preview)');
  n.addLine('--------');
  n.addLine('workdir: /tmp/arena-test');
  n.addLine('model: gpt-5.3-codex');
  n.addLine('--------');  // second separator marks end of header
}

describe('CodexNormalizer', () => {
  it('suppresses banner / header lines', () => {
    const n = new CodexNormalizer(BASE);
    expect(n.addLine('OpenAI Codex v0.108.0-alpha.12 (research preview)')).toBeNull();
    expect(n.addLine('--------')).toBeNull();
    expect(n.addLine('workdir: /tmp/arena-test')).toBeNull();
    expect(n.addLine('--------')).toBeNull();
  });

  it('emits REASONING after "codex" keyword', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    expect(n.addLine('codex')).toBeNull();
    const ev = n.addLine('Implementing the FizzBuzz solution now.');
    expect(ev?.type).toBe(EventType.REASONING);
    expect((ev?.payload as { text: string }).text).toBe('Implementing the FizzBuzz solution now.');
  });

  it('emits TOOL_CALL for exec command line', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    n.addLine('codex');
    n.addLine('Running a check');
    expect(n.addLine('exec')).toBeNull();
    const ev = n.addLine("/bin/zsh -lc 'python3 solution.py | head -5' in /tmp/arena");
    expect(ev?.type).toBe(EventType.TOOL_CALL);
    expect((ev?.payload as { tool: string }).tool).toBe('bash');
    const input = (ev?.payload as { input: { command: string } }).input;
    expect(input.command).toBe("/bin/zsh -lc 'python3 solution.py | head -5'");
  });

  it('emits REASONING for exec output lines', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    n.addLine('codex'); n.addLine('x');
    n.addLine('exec');
    n.addLine("/bin/zsh -lc 'ls'");  // TOOL_CALL
    const ev = n.addLine('solution.py');
    expect(ev?.type).toBe(EventType.REASONING);
  });

  it('emits FILE_CREATE for "file update" with "A path" line', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    n.addLine('codex'); n.addLine('x');
    expect(n.addLine('file update')).toBeNull();
    const ev = n.addLine('A /tmp/arena-team-a-XYZ/solution.py');
    expect(ev?.type).toBe(EventType.FILE_CREATE);
    // Path should be trimmed to relative form
    expect((ev?.payload as { text: string }).text).toBe('solution.py');
  });

  it('suppresses diff lines after file update', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    n.addLine('codex'); n.addLine('x');
    n.addLine('file update');
    n.addLine('A /tmp/arena-team-a-XYZ/solution.py');
    expect(n.addLine('+for i in range(1, 101):')).toBeNull();
    expect(n.addLine('+    print(i)')).toBeNull();
  });

  it('resumes REASONING after a second "codex" keyword', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    n.addLine('codex'); n.addLine('First thought');
    n.addLine('file update');
    n.addLine('A /tmp/arena-team-a-XYZ/solution.py');
    n.addLine('+code line');  // diff line, suppressed
    n.addLine('codex');  // back to reasoning
    const ev = n.addLine('Done. Deliverables created.');
    expect(ev?.type).toBe(EventType.REASONING);
  });

  it('includes correct competitionId and teamId', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    n.addLine('codex');
    const ev = n.addLine('hello');
    expect(ev?.competitionId).toBe('comp-1');
    expect(ev?.teamId).toBe('team-b');
  });

  it('returns event with valid ISO timestamp', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    n.addLine('codex');
    const ev = n.addLine('hello');
    expect(new Date(ev!.timestamp).toISOString()).toBe(ev!.timestamp);
  });

  it('returns event with non-empty eventId', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    n.addLine('codex');
    const ev = n.addLine('hello');
    expect(ev?.eventId).toBeTruthy();
  });

  it('falls back to suppressing mode after HEADER_LINE_LIMIT lines', () => {
    const n = new CodexNormalizer(BASE);
    // Feed 80 arbitrary lines without any separators
    for (let i = 0; i < 80; i++) n.addLine(`banner line ${i}`);
    // Now the "codex" keyword should trigger reasoning
    expect(n.addLine('codex')).toBeNull();
    const ev = n.addLine('Started working.');
    expect(ev?.type).toBe(EventType.REASONING);
  });

  it('accepts any separator with 4+ dashes (not just exactly 8)', () => {
    const n = new CodexNormalizer(BASE);
    n.addLine('OpenAI Codex v0.108.0');
    n.addLine('------------'); // 12 dashes — still a valid separator
    n.addLine('workdir: /tmp');
    n.addLine('----');          // 4 dashes
    // Now in suppressing mode; 'codex' keyword transitions to reasoning
    n.addLine('codex');
    const ev = n.addLine('Writing solution.');
    expect(ev?.type).toBe(EventType.REASONING);
  });

  it('emits DONE event on tokens-used line', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    n.addLine('codex'); n.addLine('done');
    const ev = n.addLine('tokens used');
    expect(ev).not.toBeNull();
    expect(ev?.type).toBe('REASONING');
    expect(n.addLine('9,065')).toBeNull();
  });

  it('strips ANSI escape codes', () => {
    const n = new CodexNormalizer(BASE);
    skipHeader(n);
    n.addLine('codex');
    const ev = n.addLine('\x1b[32mGreen text output\x1b[0m');
    expect(ev?.type).toBe(EventType.REASONING);
    expect((ev?.payload as { text: string }).text).toBe('Green text output');
  });
});
