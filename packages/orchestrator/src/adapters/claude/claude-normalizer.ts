import { randomUUID } from 'node:crypto';
import { EventType, type ArenaEvent } from '@arena/shared';

// Strip ANSI escape codes from strings before embedding in events
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

interface NormalizeContext {
  competitionId: string;
  teamId: string;
}

/** Regex to detect file paths created/modified in text output. */
const FILE_PATH_RE = /(?:created?|wrote?|writing|modified?)\s+(?:file\s+)?(\S+\.\w+)/i;

function makeEvent(
  type: EventType,
  payload: unknown,
  ctx: NormalizeContext,
): ArenaEvent {
  return {
    eventId: randomUUID(),
    competitionId: ctx.competitionId,
    teamId: ctx.teamId,
    timestamp: new Date().toISOString(),
    type,
    payload,
    metadata: {},
  };
}

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
