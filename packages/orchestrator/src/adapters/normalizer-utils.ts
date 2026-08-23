import { randomUUID } from 'node:crypto';
import {
  EventType,
  type ArenaEvent,
  type FileEventPayload,
  type FileOperation,
  type FileOpSource,
} from '@arena/shared';

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

/**
 * Detects file paths mentioned in plain-text CLI output.
 *
 * Group 1 is the VERB, group 2 the PATH. The verb is captured because for the
 * plain-text providers it is the only create-vs-modify signal that exists —
 * discarding it is what forced every text-derived file event to be a "create".
 */
export const FILE_PATH_RE = /(created?|wrote?|writing|modified?|updated?)\s+(?:file\s+)?(\S+\.\w+)/i;

/**
 * Strip the agent's temp workdir prefix so a path identifies the same file
 * whichever provider reported it.
 *
 * Workdirs are `mkdtemp(tmpdir()/arena-<teamId>-XXXX)` (competition-runner.ts).
 * Claude reports absolute paths and codex reported relative ones, so a renderer
 * keying blocks by path would have treated `/var/.../arena-team-a-Z/main.py` and
 * `main.py` as two different files — one city per team, built to different rules.
 *
 * Deliberately `arena-[^/]+` and not `arena-team-[ab]-[^/]+`: the previous codex
 * pattern only matched teams a and b, so team-c and team-d (both supported, see
 * --team-c/--team-d) kept a full absolute path.
 */
export function toRelativePath(path: string): string {
  return path.replace(/^.*\/arena-[^/]+\//, '');
}

/** Verbs that mean "changed something that already existed". */
const MODIFY_VERBS = /^(modif|updat)/i;

/** Classify a prose verb into an operation. Heuristic — callers pass opSource 'verb'. */
export function operationFromVerb(verb: string): FileOperation {
  return MODIFY_VERBS.test(verb.trim()) ? 'modify' : 'create';
}

/**
 * Build a FILE_CREATE / FILE_MODIFY event with the provider-neutral payload.
 *
 * The event TYPE and `payload.op` are derived from the same value, so they can
 * never disagree. Optional fields are omitted rather than defaulted: a consumer
 * must be able to tell "codex does not report tools" from "no tool was used".
 */
export function makeFileEvent(
  args: {
    op: FileOperation;
    opSource: FileOpSource;
    text: string;
    path?: string;
    tool?: string;
    input?: Record<string, unknown>;
  },
  ctx: NormalizeContext,
): ArenaEvent<FileEventPayload> {
  const payload: FileEventPayload = { op: args.op, opSource: args.opSource, text: args.text };
  if (args.path) payload.path = args.path;
  if (args.tool) payload.tool = args.tool;
  if (args.input) payload.input = args.input;

  return makeEvent(
    args.op === 'modify' ? EventType.FILE_MODIFY : EventType.FILE_CREATE,
    payload,
    ctx,
  ) as ArenaEvent<FileEventPayload>;
}

/**
 * What each provider's CLI can actually tell us about a file write.
 *
 * Exported so a renderer can degrade honestly per provider instead of drawing a
 * shorter city for a provider that simply reports less. `false` here means the
 * CLI does not emit the information at all — not that we have not parsed it yet.
 */
export const PROVIDER_FILE_CAPABILITIES = {
  claude: { path: true, op: true, opSource: 'tool'   as FileOpSource, tool: true,  input: true  },
  codex:  { path: true, op: true, opSource: 'marker' as FileOpSource, tool: false, input: false },
  gemini: { path: true, op: true, opSource: 'verb'   as FileOpSource, tool: false, input: false },
} as const;

/** Detects error lines in CLI output. */
export const ERROR_LINE_RE = /^(?:error|fatal|exception)[:\s]/i;

/** Normalize line endings and trim trailing whitespace for output comparison. */
export function normalizeOutput(s: string): string {
  return s.trim().replace(/\r\n/g, '\n');
}
