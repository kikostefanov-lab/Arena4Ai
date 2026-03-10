import { EventType, type ArenaEvent } from '@arena/shared';
import {
  stripAnsi,
  makeEvent,
  FILE_PATH_RE,
  type NormalizeContext,
} from '../normalizer-utils.js';

/**
 * Content block from Claude Code's stream-json assistant messages.
 */
interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
}

/**
 * Normalise a single line of Claude Code's JSON-lines stdout into a
 * universal ArenaEvent.
 *
 * Claude Code `--output-format stream-json` emits newline-delimited JSON:
 *
 *   { type: "system",  subtype: "init", ... }          → skip (session init)
 *   { type: "assistant", message: { content: [...] } }  → parse content blocks
 *   { type: "user", ... }                               → skip (tool results)
 *   { type: "rate_limit_event", ... }                    → skip
 *
 * Content blocks inside assistant messages:
 *   { type: "tool_use",  name: "Bash", input: {...} }   → TOOL_CALL
 *   { type: "text",      text: "..." }                  → REASONING or FILE_CREATE
 *   { type: "thinking",  thinking: "..." }              → REASONING
 *
 * Malformed JSON produces an ERROR event.
 */
export function normalizeLine(line: string, ctx: NormalizeContext): ArenaEvent {
  let msg: Record<string, unknown>;

  try {
    msg = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return makeEvent(EventType.ERROR, { raw: line, error: 'JSON parse failure' }, ctx);
  }

  // ── Top-level event routing ──────────────────────────────────────────────
  switch (msg.type) {
    case 'assistant': {
      const message = msg.message as Record<string, unknown> | undefined;
      if (!message) return makeEvent(EventType.REASONING, { raw: msg }, ctx);

      const content = message.content as ContentBlock[] | undefined;
      if (!Array.isArray(content) || content.length === 0) {
        return makeEvent(EventType.REASONING, { raw: msg }, ctx);
      }

      // Extract the last content block — Claude streams partial messages
      // so we get the same message ID multiple times as content grows.
      const block = content[content.length - 1];
      return normalizeContentBlock(block, ctx);
    }

    // Legacy format (pre-stream-json) — keep for backward compatibility
    case 'tool_use': {
      const input = msg.input as Record<string, unknown> | undefined;
      return makeEvent(
        EventType.TOOL_CALL,
        { tool: msg.name, input: input ?? {} },
        ctx,
      );
    }

    case 'text': {
      const text = stripAnsi(String(msg.text ?? ''));
      const isFile = FILE_PATH_RE.test(text);
      return makeEvent(
        isFile ? EventType.FILE_CREATE : EventType.REASONING,
        { text },
        ctx,
      );
    }

    case 'error': {
      const err = msg.error as Record<string, unknown> | undefined;
      return makeEvent(EventType.ERROR, { error: err ?? msg }, ctx);
    }

    // system, user, rate_limit_event — suppress noise
    case 'system':
    case 'user':
    case 'rate_limit_event':
      return makeEvent(EventType.REASONING, { raw: msg }, ctx);

    default:
      return makeEvent(EventType.REASONING, { raw: msg }, ctx);
  }
}

/**
 * Normalise a single content block from an assistant message.
 */
function normalizeContentBlock(block: ContentBlock, ctx: NormalizeContext): ArenaEvent {
  switch (block.type) {
    case 'tool_use': {
      const toolName = block.name ?? 'unknown';
      // Detect file-writing tools
      const isFileWrite = toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit';
      if (isFileWrite) {
        const filePath = (block.input?.file_path as string) ?? (block.input?.path as string) ?? '';
        return makeEvent(EventType.FILE_CREATE, { tool: toolName, text: filePath, input: block.input ?? {} }, ctx);
      }
      return makeEvent(EventType.TOOL_CALL, { tool: toolName, input: block.input ?? {} }, ctx);
    }

    case 'text': {
      const text = stripAnsi(String(block.text ?? ''));
      const isFile = FILE_PATH_RE.test(text);
      return makeEvent(
        isFile ? EventType.FILE_CREATE : EventType.REASONING,
        { text },
        ctx,
      );
    }

    case 'thinking': {
      const text = stripAnsi(String(block.thinking ?? ''));
      return makeEvent(EventType.REASONING, { text }, ctx);
    }

    default:
      return makeEvent(EventType.REASONING, { raw: block }, ctx);
  }
}

export type { NormalizeContext };
