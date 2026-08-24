import { EventType, type ArenaEvent } from '@arena/shared';
import {
  stripAnsi,
  makeEvent,
  makeFileEvent,
  operationFromVerb,
  toRelativePath,
  FILE_PATH_RE,
  ERROR_LINE_RE,
  type NormalizeContext,
} from '../normalizer-utils.js';

/**
 * Normalise a single line of Gemini CLI output into a universal ArenaEvent.
 *
 * The adapter runs gemini with `-o stream-json`, so each line is one JSON event
 * (verified against gemini-cli 0.38.2, `StreamJsonFormatter.emitEvent()`):
 *
 *   {"type":"init",       "session_id":…, "model":…}
 *   {"type":"message",    "role":"assistant","content":…}
 *   {"type":"tool_use",   "tool_name":…, "tool_id":…, "parameters":{…}}
 *   {"type":"tool_result","tool_id":…, "status":"success"|"error", "output":…}
 *   {"type":"error",      "severity":…, "message":…}
 *   {"type":"result",     "status":…, "stats":{…}}
 *
 * Before AA-037 gemini ran in text mode, so a file operation could only be
 * inferred from a verb in an English sentence. The prose path is KEPT below as a
 * fallback and is selected purely by content: any line that does not parse as a
 * stream-json event falls through to it. That covers an older gemini CLI (the
 * flag landed in 0.38), plus any stray non-JSON the CLI prints alongside.
 */

/** gemini's file tools. `replace` with an empty old_string creates the file. */
const WRITE_FILE_TOOL = 'write_file';
const EDIT_FILE_TOOL = 'replace';

interface StreamEvent {
  type?: string;
  role?: string;
  content?: unknown;
  tool_name?: string;
  parameters?: Record<string, unknown>;
  message?: string;
  severity?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
}

function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return String(o.text ?? o.content ?? '');
  }
  return v == null ? '' : String(v);
}

/** A structured stream-json event, or null if this line is not one. */
function parseStreamEvent(line: string): StreamEvent | null {
  if (!line.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(line) as StreamEvent;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function fromToolUse(msg: StreamEvent, ctx: NormalizeContext): ArenaEvent {
  const tool = msg.tool_name ?? 'unknown';
  const params = msg.parameters ?? {};
  const filePath = (params.file_path as string) ?? (params.path as string) ?? '';

  if (tool === WRITE_FILE_TOOL || tool === EDIT_FILE_TOOL) {
    // `replace` with an empty old_string is gemini's create-a-new-file form
    // (isNewFile = params.old_string === "" && !fileExists, gemini-cli 0.38.2).
    // Reading the parameter is strictly more accurate than the tool name alone.
    const createsNewFile = tool === WRITE_FILE_TOOL || params.old_string === '';
    const relPath = toRelativePath(filePath);
    return makeFileEvent(
      {
        op: createsNewFile ? 'create' : 'modify',
        opSource: 'tool',
        text: relPath,
        path: relPath || undefined,
        tool,
        input: params,
      },
      ctx,
    );
  }

  return makeEvent(EventType.TOOL_CALL, { tool, input: params }, ctx);
}

export function normalizeLine(line: string, ctx: NormalizeContext): ArenaEvent {
  const clean = stripAnsi(line.trim());

  if (!clean) {
    return makeEvent(EventType.REASONING, { text: '' }, ctx);
  }

  // ── Structured path (gemini-cli >= 0.38, `-o stream-json`) ─────────────────
  const msg = parseStreamEvent(clean);
  if (msg?.type) {
    switch (msg.type) {
      case 'tool_use':
        return fromToolUse(msg, ctx);

      case 'error':
        return makeEvent(EventType.ERROR, { error: msg.message ?? msg }, ctx);

      case 'tool_result':
        return msg.status === 'error'
          ? makeEvent(EventType.ERROR, { error: msg.error ?? msg.output ?? msg }, ctx)
          : makeEvent(EventType.REASONING, { text: textOf(msg.output) }, ctx);

      case 'result':
        return msg.status === 'error'
          ? makeEvent(EventType.ERROR, { error: msg.error ?? msg }, ctx)
          : makeEvent(EventType.REASONING, { raw: msg }, ctx);

      case 'message':
        return makeEvent(EventType.REASONING, { text: textOf(msg.content) }, ctx);

      case 'init':
      default:
        return makeEvent(EventType.REASONING, { raw: msg }, ctx);
    }
  }

  // ── Prose fallback (older gemini CLI, or non-JSON noise) ───────────────────
  // Selected by content, not configuration: we get here only when the line is
  // not a stream-json event. Operations derived here are tagged opSource 'verb'
  // so a consumer can weight them as the heuristic they are.
  if (ERROR_LINE_RE.test(clean)) {
    return makeEvent(EventType.ERROR, { error: clean }, ctx);
  }

  const fileMatch = FILE_PATH_RE.exec(clean);
  if (fileMatch) {
    return makeFileEvent(
      { op: operationFromVerb(fileMatch[1]), opSource: 'verb', text: clean, path: fileMatch[2] },
      ctx,
    );
  }

  return makeEvent(EventType.REASONING, { text: clean }, ctx);
}

export type { NormalizeContext };
