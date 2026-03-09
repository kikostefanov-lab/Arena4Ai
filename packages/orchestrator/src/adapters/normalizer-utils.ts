import { randomUUID } from 'node:crypto';
import { EventType, type ArenaEvent } from '@arena/shared';

/** Strip ANSI escape codes from strings before embedding in events. */
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export interface NormalizeContext {
  competitionId: string;
  teamId: string;
}

export function makeEvent(
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

/** Detects file paths mentioned in plain-text CLI output. */
export const FILE_PATH_RE = /(?:created?|wrote?|writing|modified?|updated?)\s+(?:file\s+)?(\S+\.\w+)/i;

/** Detects error lines in CLI output. */
export const ERROR_LINE_RE = /^(?:error|fatal|exception)[:\s]/i;

/** Normalize line endings and trim trailing whitespace for output comparison. */
export function normalizeOutput(s: string): string {
  return s.trim().replace(/\r\n/g, '\n');
}
