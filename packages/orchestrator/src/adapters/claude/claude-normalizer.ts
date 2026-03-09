import { EventType, type ArenaEvent } from '@arena/shared';
import {
  stripAnsi,
  makeEvent,
  FILE_PATH_RE,
  type NormalizeContext,
} from '../normalizer-utils.js';

/**
 * Normalise a single line of Claude Code's JSON-lines stdout into a
 * universal ArenaEvent.
 *
 * Claude Code streams newline-delimited JSON objects of the shape:
 *   { type: 'tool_use' | 'text' | 'error' | ... }
 *
 * Unknown types fall back to REASONING.
 * Malformed JSON produces an ERROR event.
 */
export function normalizeLine(line: string, ctx: NormalizeContext): ArenaEvent {
  let msg: Record<string, unknown>;

  try {
    msg = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return makeEvent(EventType.ERROR, { raw: line, error: 'JSON parse failure' }, ctx);
  }

  switch (msg.type) {
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

    default:
      return makeEvent(EventType.REASONING, { raw: msg }, ctx);
  }
}

export type { NormalizeContext };
