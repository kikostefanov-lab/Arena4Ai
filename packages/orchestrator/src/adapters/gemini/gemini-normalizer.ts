import { EventType, type ArenaEvent } from '@arena/shared';
import {
  stripAnsi,
  makeEvent,
  FILE_PATH_RE,
  ERROR_LINE_RE,
  type NormalizeContext,
} from '../normalizer-utils.js';

/**
 * Normalise a single line of Gemini CLI stdout into a universal ArenaEvent.
 *
 * Gemini CLI may output plain text or structured JSON, including function_call
 * objects for tool use. We infer event types from content patterns.
 */
export function normalizeLine(line: string, ctx: NormalizeContext): ArenaEvent {
  const clean = stripAnsi(line.trim());

  if (!clean) {
    return makeEvent(EventType.REASONING, { text: '' }, ctx);
  }

  // Try JSON first — Gemini CLI may output structured data.
  try {
    const msg = JSON.parse(clean) as Record<string, unknown>;

    if (msg.type === 'error' || msg.error) {
      return makeEvent(EventType.ERROR, { error: msg.error ?? msg }, ctx);
    }

    // Handle both tool_use and Gemini's function_call format.
    if (msg.type === 'tool_use' || msg.type === 'function_call' || msg.tool || msg.functionCall) {
      const fc = msg.functionCall as Record<string, unknown> | undefined;
      const toolName = (msg.name ?? msg.tool ?? fc?.name) as string | undefined;
      const input = (msg.input ?? msg.args ?? fc?.args ?? {}) as Record<string, unknown>;
      return makeEvent(EventType.TOOL_CALL, { tool: toolName ?? 'unknown', input }, ctx);
    }

    const text = String(msg.text ?? msg.content ?? msg.message ?? clean);
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
