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

/** What one provider's CLI can actually tell us about a file write. */
export interface ProviderFileCapability {
  /** A structured path is available. */
  path: boolean;
  /** A create-vs-modify operation can be determined. */
  op: boolean;
  /** How that operation is derived — see FileOpSource. */
  opSource: FileOpSource;
  /** The provider names the tool that performed the write. */
  tool: boolean;
  /** The provider emits the raw tool input. */
  input: boolean;
}

/**
 * Per-provider file-telemetry capabilities.
 *
 * Lives in @arena/shared rather than beside the normalizers on purpose: the
 * consumer that most needs it is the arena renderer in `packages/web`, which
 * cannot import orchestrator internals. A renderer binding a visual channel to
 * edit counts must branch on this, or it will silently draw a shorter, poorer
 * city for whichever CLI simply reports less — the same class of unfairness as
 * a judge favouring its own vendor, except baked into the picture.
 *
 * `false` means the CLI does not emit the information AT ALL — not that we have
 * yet to parse it. `opSource` says how far the operation can be trusted:
 * gemini's 'verb' is parsed from prose and is not sound for edit counting.
 */
export const PROVIDER_FILE_CAPABILITIES: Record<'claude' | 'codex' | 'gemini', ProviderFileCapability> = {
  claude: { path: true, op: true, opSource: 'tool',   tool: true,  input: true  },
  codex:  { path: true, op: true, opSource: 'marker', tool: false, input: false },
  gemini: { path: true, op: true, opSource: 'verb',   tool: false, input: false },
};
