import type { EventType } from '../constants/event-types.js';

export interface ArenaEvent<T = unknown> {
  eventId: string;
  competitionId: string;
  teamId: string;
  timestamp: string; // ISO 8601
  type: EventType;
  payload: T;
  metadata: Record<string, unknown>;
}

/** Whether a file event created a new file or changed an existing one. */
export type FileOperation = 'create' | 'modify';

/**
 * How confidently we know the operation. A renderer that draws height from edit
 * counts needs to know whether it is standing on a fact or an inference.
 *
 *  - 'tool'           the provider named the tool (claude: Write vs Edit). Reliable.
 *  - 'marker'         the provider tagged the line (codex: `A path` vs `M path`). Reliable.
 *  - 'verb'           parsed from the CLI's own prose ("modified foo.ts"). Heuristic.
 *  - 'first-sighting' inferred from whether we had seen the path before. Weakest.
 */
export type FileOpSource = 'tool' | 'marker' | 'verb' | 'first-sighting';

/**
 * Provider-neutral payload for FILE_CREATE / FILE_MODIFY events.
 *
 * Every optional field here is optional because SOME PROVIDER GENUINELY CANNOT
 * SUPPLY IT — not because it is sometimes inconvenient to fill in. A field is
 * omitted entirely rather than defaulted, so a consumer can distinguish
 * "this provider does not report tools" from "zero tools were used". Anything
 * that defaults an absent field to 0 will silently flatter whichever provider
 * reports the most, which is the failure this contract exists to prevent.
 */
export interface FileEventPayload {
  /** Structured file path. Absent when the provider gave only unparseable prose. */
  path?: string;
  /** create or modify. Always present — see `opSource` for how much to trust it. */
  op: FileOperation;
  /** Provenance of `op`. Always present. */
  opSource: FileOpSource;
  /** Tool that performed the write. Absent when the provider does not name one. */
  tool?: string;
  /** Raw tool input. Absent unless the provider emits structured tool calls. */
  input?: Record<string, unknown>;
  /** Human-readable line. Retained for backwards compatibility — existing UI reads it. */
  text: string;
}
