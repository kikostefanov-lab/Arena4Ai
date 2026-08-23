import { EventType, type ArenaEvent } from '@arena/shared';
import { stripAnsi, makeEvent, makeFileEvent, toRelativePath, type NormalizeContext } from '../normalizer-utils.js';

/**
 * Stateful normaliser for the Codex CLI output stream.
 *
 * Codex outputs everything to stderr in a structured plain-text format:
 *
 *   OpenAI Codex v...       ← banner / header (skip)
 *   --------                ← separator (skip)
 *   workdir: /tmp/...       ← config dump (skip)
 *   ...
 *   --------                ← end of config (skip)
 *   user                    ← prompt echo (skip)
 *   [PERSONA] ...           ← prompt echo (skip)
 *   codex                   ← keyword → following lines are Codex reasoning
 *   Implementing this now…  ← REASONING
 *   exec                    ← keyword → next line is shell command
 *   /bin/zsh -lc 'ls -la'…  ← TOOL_CALL (bash)
 *   [output lines]          ← REASONING (exec output)
 *   file update             ← keyword → next line is file path
 *   A /tmp/…/solution.py    ← FILE_CREATE
 *   [diff lines]            ← ignored
 *   tokens used             ← end marker
 *   9,065                   ← ignored
 */
type Mode = 'header' | 'suppressing' | 'reasoning' | 'exec_cmd' | 'exec_output' | 'file_update' | 'skip';

const SEP_RE = /^-{4,}$/;
// If Codex doesn't emit the expected separators within this many lines, give up
// waiting and transition to suppressing (prompt-echo suppression) anyway.
const HEADER_LINE_LIMIT = 80;
// Max lines of exec output to show before suppressing the rest
const EXEC_OUTPUT_MAX_LINES = 3;

export class CodexNormalizer {
  private mode: Mode = 'header';
  private separatorCount = 0;
  private headerLineCount = 0;
  private execOutputLineCount = 0;
  private ctx: NormalizeContext;

  constructor(ctx: NormalizeContext) {
    this.ctx = ctx;
  }

  /** Process one line; returns an ArenaEvent or null if the line should be suppressed. */
  addLine(rawLine: string): ArenaEvent | null {
    const line = stripAnsi(rawLine.trim());
    if (!line) return null;

    // ── Banner / header block ──────────────────────────────────────────────
    // Suppress everything until the second separator line (4+ dashes).
    // Fall back after HEADER_LINE_LIMIT lines in case format differs.
    if (this.mode === 'header') {
      ++this.headerLineCount;
      if (SEP_RE.test(line) && ++this.separatorCount >= 2) {
        this.mode = 'suppressing';
      } else if (this.headerLineCount >= HEADER_LINE_LIMIT) {
        this.mode = 'suppressing';
      }
      return null;
    }

    // ── Post-header prompt echo suppression ───────────────────────────────
    // Suppress the prompt echo block until the first "codex" keyword.
    if (this.mode === 'suppressing') {
      if (line.toLowerCase() === 'codex') this.mode = 'reasoning';
      return null;
    }

    // ── Keyword dispatch (compute toLowerCase once) ───────────────────────
    const lower = line.toLowerCase();

    if (lower === 'codex') { this.mode = 'reasoning'; return null; }
    if (lower === 'exec') { this.mode = 'exec_cmd'; this.execOutputLineCount = 0; return null; }
    if (lower === 'file update') { this.mode = 'file_update'; return null; }
    if (lower.startsWith('tokens used')) {
      this.mode = 'skip';
      return makeEvent(EventType.REASONING, { raw: { type: 'result', result: 'Completed.' } }, this.ctx);
    }

    // ── Mode-specific parsing ─────────────────────────────────────────────
    switch (this.mode) {
      case 'reasoning':
        // Suppress diff/patch noise that leaks into reasoning
        if (line.startsWith('apply_patch') || line.startsWith('Success.')) return null;
        return makeEvent(EventType.REASONING, { text: line }, this.ctx);

      case 'exec_cmd': {
        // e.g. "/bin/zsh -lc 'ls -la' in /tmp/arena-..."
        // Strip the " in /path" suffix for the display
        const cmd = line.replace(/ in \/.*$/, '').trim();
        this.mode = 'exec_output';
        return makeEvent(EventType.TOOL_CALL, { tool: 'bash', input: { command: cmd } }, this.ctx);
      }

      case 'exec_output':
        // Show only the first few lines of exec output; suppress the rest
        if (++this.execOutputLineCount > EXEC_OUTPUT_MAX_LINES) return null;
        return makeEvent(EventType.REASONING, { text: line }, this.ctx);

      case 'file_update': {
        // "A /path/to/file.py" or "M /path/to/file.py"
        // Codex tags each line: "A path" = added, "M path" = modified. That marker
        // was previously parsed and then discarded, which is why every codex file
        // event looked like a create. It is a reliable signal, straight from the CLI.
        const fileMatch = line.match(/^([AM])\s+(.+)$/);
        const marker = fileMatch?.[1];
        const path = fileMatch ? fileMatch[2] : line;
        // Strip absolute temp dir prefix for display (shared helper: the old
        // pattern here only matched teams a and b).
        const displayPath = toRelativePath(path);
        this.mode = 'skip'; // skip the diff lines
        // No marker at all means we could not parse the line; fall back to create
        // rather than assert a change we cannot see.
        return makeFileEvent(
          {
            op: marker === 'M' ? 'modify' : 'create',
            opSource: 'marker',
            text: displayPath,
            path: displayPath || undefined,
            // `tool` deliberately omitted: codex applies edits via apply_patch and
            // never names a per-file tool. Absent, not "unknown".
          },
          this.ctx,
        );
      }

      case 'skip':
        // Diff lines after file_update — all suppressed.
        // Keyword transitions are handled above before reaching this switch.
        return null;

      default:
        return null;
    }
  }
}
