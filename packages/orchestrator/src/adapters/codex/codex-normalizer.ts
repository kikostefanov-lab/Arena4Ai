import { EventType, type ArenaEvent } from '@arena/shared';
import {
  stripAnsi,
  makeEvent,
  FILE_PATH_RE,
  ERROR_LINE_RE,
  type NormalizeContext,
} from '../normalizer-utils.js';

/**
 * Normalise a single line of Codex CLI stdout into a universal ArenaEvent.
 *
 * Codex CLI outputs plain text rather than JSON-lines. We infer event types
 * from content patterns, with a JSON-parse fallback for structured output.
 */
export function normalizeLine(line: string, ctx: NormalizeContext): ArenaEvent {
  const clean = stripAnsi(line.trim());

  if (!clean) {
    return makeEvent(EventType.REASONING, { text: '' }, ctx);
  }

  // Try JSON first — some Codex versions may output structured data.
  try {
    const msg = JSON.parse(clean) as Record<string, unknown>;

    if (msg.type === 'error' || msg.error) {
      return makeEvent(EventType.ERROR, { error: msg.error ?? msg }, ctx);
    }

    if (msg.type === 'tool_use' || msg.tool) {
      return makeEvent(
        EventType.TOOL_CALL,
        { tool: msg.tool ?? msg.name, input: msg.input ?? {} },
        ctx,
      );
    }

    const text = String(msg.text ?? msg.content ?? clean);
    return makeEvent(
      FILE_PATH_RE.test(text) ? EventType.FILE_CREATE : EventType.REASONING,
      { text },
      ctx,
    );
  } catch {
    // Not JSON — treat as plain text
  }

  if (ERROR_LINE_RE.test(clean)) {
    return makeEvent(EventType.ERROR, { error: clean }, ctx);
  }

  if (FILE_PATH_RE.test(clean)) {
    return makeEvent(EventType.FILE_CREATE, { text: clean }, ctx);
  }

  return makeEvent(EventType.REASONING, { text: clean }, ctx);
}

export type { NormalizeContext };
