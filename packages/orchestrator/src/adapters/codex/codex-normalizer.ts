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
 *   [diff lines]            ← see below
 *   tokens used             ← end marker
 *   9,065                   ← ignored
 *
 * AA-079 — THE SECOND SHAPE, which used to be thrown away.
 *
 * Codex does not always announce a file with an `A`/`M` marker. When it applies
 * edits via apply_patch it emits a UNIFIED DIFF, and it writes the header with a
 * trailing colon:
 *
 *   file update:
 *   diff --git a//tmp/arena-x/.env.example b//tmp/arena-x/.env.example
 *   new file mode 100644
 *   index 000…..e11…
 *   --- /dev/null
 *   +++ b//tmp/arena-x/.env.example
 *   @@ -0,0 +1,17 @@
 *   +CONTENT…
 *
 * Two separate defects dropped every file in that shape:
 *   1. the keyword test was `line === 'file update'`, so `file update:` never
 *      matched and the block was never entered;
 *   2. once a marker line HAD been parsed the mode became 'skip', which
 *      discarded the rest of the block — and one apply_patch block can carry
 *      MANY files.
 *
 * Measured on competition ebb45f36: codex delivered 17 files and this normaliser
 * produced 4 file events. All 17 paths were present in the stream the whole time
 * as `+++ b/<path>` headers; they were simply discarded. A provider that reports
 * SOME of its writes is indistinguishable from one that only PERFORMED that many,
 * which renders as a shorter city and reads as a claim about the MODEL rather
 * than about its CLI's logging.
 *
 * Diff parsing is therefore MODE-INDEPENDENT: a `diff --git` line starts a patch
 * block wherever it appears, including inside reasoning, because that is exactly
 * where these lines landed while the keyword test was failing.
 */
type Mode = 'header' | 'suppressing' | 'reasoning' | 'exec_cmd' | 'exec_output' | 'file_update' | 'skip';

/** `file update` / `file update:` / `File Update :` — the colon is optional. */
const FILE_UPDATE_RE = /^file\s+update\s*:?$/i;
/** `diff --git a/<old> b/<new>`. Paths may be absolute, giving `a//abs/path`. */
const DIFF_GIT_RE = /^diff --git\s+a\/+(.+?)\s+b\/+(.+)$/;
/** The `+++ b/<path>` header naming the post-image. `/dev/null` means a delete. */
const DIFF_PLUS_RE = /^\+\+\+\s+(?:b\/+)?(.+)$/;
/** `new file mode 100644` — git's own statement that this path did not exist. */
const NEW_FILE_MODE_RE = /^new file mode\s+\d+$/;
/** `deleted file mode 100644`. */
const DELETED_FILE_MODE_RE = /^deleted file mode\s+\d+$/;

/**
 * True for a line that belongs to the body or the metadata of a diff.
 *
 * Used in two places: inside a `diff --git` block, and after an A/M marker line
 * where codex prints the raw hunk with no `diff --git` header at all. In both
 * cases the line is patch interior and must be swallowed rather than surfaced as
 * reasoning — the A/M form has always printed its diff this way, and it was the
 * old `mode = 'skip'` that hid it.
 */
function isPatchInterior(line: string): boolean {
  return line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('index ')
    || line.startsWith('@@') || line.startsWith('similarity index ')
    || line.startsWith('rename from ') || line.startsWith('rename to ')
    || line.startsWith('old mode ') || line.startsWith('new mode ')
    || NEW_FILE_MODE_RE.test(line) || DELETED_FILE_MODE_RE.test(line)
    || line.startsWith('Binary files ')
    || /^[+\-\\]/.test(line);
}

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

  // ── apply_patch / unified-diff state (AA-079) ──────────────────────────────
  /** True once a `diff --git` line has been seen and before its file is emitted. */
  private inPatch = false;
  /** Set by `new file mode` / `deleted file mode` inside the current patch. */
  private patchIsNew = false;
  private patchIsDeleted = false;
  /** Path from the `diff --git` line, used if no `+++` header arrives. */
  private patchPath: string | null = null;
  /** Guards against emitting the same path twice from one patch block. */
  private patchEmitted = false;

  constructor(ctx: NormalizeContext) {
    this.ctx = ctx;
  }

  /** Clear per-patch state. Called whenever a new block starts or one ends. */
  private resetPatch(): void {
    this.inPatch = false;
    this.patchIsNew = false;
    this.patchIsDeleted = false;
    this.patchPath = null;
    this.patchEmitted = false;
  }

  /**
   * Consume one line of a unified diff (AA-079).
   *
   * Returns `undefined` when the line is NOT part of a patch, meaning the caller
   * should carry on with its normal dispatch. Returns `null` to swallow a patch
   * line, or an ArenaEvent when a file has been identified. The three-way return
   * is what lets this sit ahead of the mode switch without stealing lines that
   * merely look diff-ish.
   *
   * The file is emitted on the `+++ b/<path>` header rather than on
   * `diff --git`, because by then `new file mode` / `deleted file mode` has been
   * seen and the operation is a FACT from git rather than a guess. When a block
   * has no `+++` header the `diff --git` path is used as a fallback.
   */
  private handlePatchLine(line: string): ArenaEvent | null | undefined {
    const git = line.match(DIFF_GIT_RE);
    if (git) {
      // A new `diff --git` closes any previous block. If that block never got a
      // `+++` header, emit it now from its own path so the file is not lost.
      const pending = this.flushPendingPatch();
      this.resetPatch();
      this.inPatch = true;
      // Prefer the b-side (post-image) path; for a rename they differ.
      this.patchPath = git[2] ?? git[1];
      return pending ?? null;
    }

    if (!this.inPatch) return undefined;

    if (NEW_FILE_MODE_RE.test(line)) { this.patchIsNew = true; return null; }
    if (DELETED_FILE_MODE_RE.test(line)) { this.patchIsDeleted = true; return null; }

    const plus = line.match(DIFF_PLUS_RE);
    if (plus) {
      const target = plus[1].trim();
      // `+++ /dev/null` is a deletion. Nothing was written, so nothing is drawn:
      // a deleted file is not a create, and asserting one would be the same kind
      // of invention this card exists to remove.
      if (target === '/dev/null' || this.patchIsDeleted) { this.patchEmitted = true; return null; }
      if (this.patchEmitted) return null;
      this.patchEmitted = true;
      return this.emitPatchFile(target);
    }

    // `--- a/<path>`, `index …`, `@@ …`, and the +/-/space body lines. All are
    // patch interior: swallow them so they do not surface as reasoning noise.
    if (isPatchInterior(line)) return null;

    // Anything else means the patch has ended. Emit a pending file if the block
    // never produced a `+++` header, then hand the line back to normal dispatch.
    const pending = this.flushPendingPatch();
    this.resetPatch();
    return pending ?? undefined;
  }

  /** Emit the current block's file from its `diff --git` path, if not already done. */
  private flushPendingPatch(): ArenaEvent | null {
    if (!this.inPatch || this.patchEmitted || this.patchIsDeleted || !this.patchPath) return null;
    this.patchEmitted = true;
    return this.emitPatchFile(this.patchPath);
  }

  private emitPatchFile(rawPath: string): ArenaEvent | null {
    const displayPath = toRelativePath(rawPath);
    if (!displayPath) return null;
    return makeFileEvent(
      {
        // `new file mode` present => create; absent => the path already existed,
        // so this is a modify. Both come from git's own header, not from prose,
        // which is why `opSource` stays 'marker' — the same trust level as the
        // A/M markers and the value the capability table already declares for
        // codex. See PROVIDER_FILE_CAPABILITIES.
        op: this.patchIsNew ? 'create' : 'modify',
        opSource: 'marker',
        text: displayPath,
        path: displayPath,
        // `tool` omitted: apply_patch names no per-file tool. Absent, not unknown.
      },
      this.ctx,
    );
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

    // ── Unified-diff handling, deliberately BEFORE keyword dispatch ───────
    // A patch block can appear in any mode (see the AA-079 note in the header),
    // so this must not be nested inside the mode switch below.
    const diffEvent = this.handlePatchLine(line);
    if (diffEvent !== undefined) return diffEvent;

    // ── Keyword dispatch (compute toLowerCase once) ───────────────────────
    const lower = line.toLowerCase();

    if (lower === 'codex') { this.mode = 'reasoning'; return null; }
    if (lower === 'exec') { this.mode = 'exec_cmd'; this.execOutputLineCount = 0; return null; }
    // The colon is optional: codex writes `file update:` for apply_patch blocks
    // and a bare `file update` for A/M marker blocks. Matching only the bare
    // form is what stopped every apply_patch block from being parsed at all.
    if (FILE_UPDATE_RE.test(line)) { this.mode = 'file_update'; this.resetPatch(); return null; }
    if (lower.startsWith('tokens used')) {
      this.mode = 'skip';
      return makeEvent(EventType.REASONING, { raw: { type: 'result', result: 'Completed.' } }, this.ctx);
    }

    // ── Mode-specific parsing ─────────────────────────────────────────────
    switch (this.mode) {
      case 'reasoning':
        // Suppress patch chatter that leaks into reasoning. Diff lines have
        // already been consumed by handlePatchLine(); what reaches here is the
        // apply_patch invocation itself and its success acknowledgement.
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
        if (!fileMatch && isPatchInterior(line)) {
          // The hunk that follows an A/M marker. Swallow it and STAY in this
          // mode: the block may still list further files. This is what the old
          // `mode = 'skip'` achieved for line noise, without also discarding
          // every file after the first.
          return null;
        }
        if (!fileMatch) {
          // NOT a marker line. Previously this fell through and turned whatever
          // the line happened to be into a file event — which was survivable only
          // because the mode switched to 'skip' immediately afterwards. Now that
          // the block stays open to catch its remaining files, an unrecognised
          // line must NOT be asserted as a path: that would invent files out of
          // diff content. Close the block and let it be read as reasoning.
          this.mode = 'reasoning';
          return makeEvent(EventType.REASONING, { text: line }, this.ctx);
        }
        // Strip absolute temp dir prefix for display (shared helper: the old
        // pattern here only matched teams a and b).
        const displayPath = toRelativePath(fileMatch[2]);
        // Deliberately NOT `this.mode = 'skip'` any more. One `file update`
        // block can list SEVERAL files, and skipping after the first is how 13
        // of codex's 17 files were lost. Staying in 'file_update' lets each
        // subsequent A/M line be parsed too; diff lines inside the block are
        // consumed by handlePatchLine() before reaching here.
        return makeFileEvent(
          {
            op: fileMatch[1] === 'M' ? 'modify' : 'create',
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
