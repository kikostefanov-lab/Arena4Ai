import type { ArenaEvent, FileOperation, FileOpSource, ProviderFileCapability } from '../types/event.js';
import { PROVIDER_FILE_CAPABILITIES } from '../types/event.js';

/**
 * Turns raw ArenaEvents into the small, honest shape the renderer draws from.
 *
 * THE PROBLEM THIS MODULE EXISTS TO SOLVE
 * The arena binds four visual channels to event data: a block is a file, its
 * height is the edit count, a beam is a tool call, a crack is an error. Three
 * different CLIs feed those channels and they do not report identically. If the
 * renderer simply counts what arrives, whichever provider narrates least draws
 * the shortest city — and a short city reads as "did less work", which is a
 * claim about the model rather than about the CLI's logging. That is the same
 * class of unfairness as a judge favouring its own vendor, except baked into the
 * picture, where nobody thinks to check it.
 *
 * So every channel carries a CONFIDENCE alongside its value, derived from
 * PROVIDER_FILE_CAPABILITIES, and the renderer is required to draw the
 * difference. See `EditDepthMode`.
 */

// ─── provider resolution ─────────────────────────────────────────────────────

export type KnownProvider = keyof typeof PROVIDER_FILE_CAPABILITIES;

/** Capability assumed for a provider we have never heard of: claims nothing. */
export const UNKNOWN_PROVIDER_CAPABILITY: ProviderFileCapability = {
  path: false,
  op: false,
  opSource: 'first-sighting',
  tool: false,
  input: false,
};

/**
 * Extract the provider from a model string such as `claude:architect`,
 * `gemini`, or `codex:speedrunner`.
 */
export function providerOf(model: string): string {
  return (model ?? '').toLowerCase().split(':')[0].trim();
}

/**
 * Capability for a model string. An unrecognised provider does NOT fall back to
 * claude's (the richest) — it falls back to claiming nothing, so a new adapter
 * that has not declared its capabilities renders as an honest unknown rather
 * than silently borrowing someone else's credibility.
 */
export function capabilityFor(model: string): ProviderFileCapability {
  const p = providerOf(model);
  return (PROVIDER_FILE_CAPABILITIES as Record<string, ProviderFileCapability>)[p]
    ?? UNKNOWN_PROVIDER_CAPABILITY;
}

// ─── the normalized frame event ──────────────────────────────────────────────

export type FrameEventKind = 'file' | 'tool' | 'error' | 'reasoning' | 'state' | 'commentary' | 'other';

export interface FrameEvent {
  /** Milliseconds from the start of the competition. */
  t: number;
  teamId: string | null;
  kind: FrameEventKind;
  /** File events only — the block this event addresses. */
  path?: string;
  op?: FileOperation;
  opSource?: FileOpSource;
  /** Tool events only. */
  tool?: string;
  /** One line of human-readable detail for the ticker. */
  text: string;
  /** State changes only. */
  state?: string;
  /** True when this event arrived in the pre-c965642 payload shape. */
  legacy: boolean;
}

// ─── legacy payload handling ─────────────────────────────────────────────────

/**
 * Events recorded before c965642 have a different payload shape and there was
 * DELIBERATELY NO BACKFILL, so historical competitions will be replayed through
 * this renderer forever. What they carried:
 *
 *   claude   { tool, text: <path>, input }   — path is in `text`, sometimes prose
 *   codex    { text: <path> }                — `text` IS the path
 *   gemini   { text: <prose> }               — a path may be embedded in a sentence
 *
 * and, critically, NO normalizer emitted FILE_MODIFY at all. Every historical
 * file event is a FILE_CREATE. So a historical stream has no measured edit
 * depth anywhere — not a low one, none — and the renderer must say so rather
 * than drawing a uniformly flat city that looks like a competition where nobody
 * revised anything.
 */

/** Matches a path-ish token inside prose. Kept deliberately conservative. */
const LEGACY_PATH_RE = /(?:^|\s)((?:[\w.@-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,8})(?:\s|$|[:,)])/;

/** Strip an absolute sandbox workdir prefix, mirroring the normalizers. */
const WORKDIR_RE = /^.*\/arena-[^/]+\//;

export function recoverLegacyPath(payload: Record<string, unknown>): string | undefined {
  const input = payload.input as Record<string, unknown> | undefined;
  const direct =
    (typeof payload.path === 'string' && payload.path) ||
    (input && typeof input.file_path === 'string' && input.file_path) ||
    (input && typeof input.path === 'string' && input.path) ||
    undefined;
  const raw = direct || (typeof payload.text === 'string' ? payload.text : undefined);
  if (!raw) return undefined;
  const trimmed = raw.trim();
  // `text` was often the bare path already.
  if (!/\s/.test(trimmed) && /[./]/.test(trimmed)) return trimmed.replace(WORKDIR_RE, '');
  const m = LEGACY_PATH_RE.exec(trimmed);
  return m ? m[1].replace(WORKDIR_RE, '') : undefined;
}

// ─── normalization ───────────────────────────────────────────────────────────

function textOf(payload: Record<string, unknown>): string {
  for (const k of ['text', 'path', 'message', 'error', 'cmd', 'raw']) {
    const v = payload[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Normalize one ArenaEvent. `originMs` is the competition start in epoch ms, so
 * the renderer works in elapsed time regardless of when the events were recorded.
 */
export function toFrameEvent(ev: ArenaEvent, originMs: number): FrameEvent {
  const payload = (ev.payload ?? {}) as Record<string, unknown>;
  const t = Math.max(0, Date.parse(ev.timestamp) - originMs);
  const base = { t, teamId: ev.teamId || null, text: textOf(payload) };

  switch (ev.type) {
    case 'FILE_CREATE':
    case 'FILE_MODIFY': {
      // The presence of opSource is what separates a post-c965642 event from a
      // historical one. It is always written by the current normalizers and was
      // never written by the old ones, which makes it a reliable discriminator
      // and avoids having to date-check every event against a commit.
      const hasContract = typeof payload.opSource === 'string';
      if (hasContract) {
        return {
          ...base,
          kind: 'file',
          path: typeof payload.path === 'string' ? payload.path : undefined,
          op: payload.op as FileOperation,
          opSource: payload.opSource as FileOpSource,
          tool: typeof payload.tool === 'string' ? payload.tool : undefined,
          legacy: false,
        };
      }
      return {
        ...base,
        kind: 'file',
        path: recoverLegacyPath(payload),
        // Left undefined on purpose. The op for a legacy event is not unknown-
        // but-guessable, it is genuinely absent: every historical file event was
        // a FILE_CREATE whether or not it created anything. The world model
        // resolves it by first sighting and labels it as such.
        op: undefined,
        opSource: undefined,
        tool: typeof payload.tool === 'string' ? payload.tool : undefined,
        legacy: true,
      };
    }
    case 'TOOL_CALL':
      return {
        ...base,
        kind: 'tool',
        tool: typeof payload.tool === 'string' ? payload.tool : undefined,
        legacy: false,
      };
    case 'ERROR':
      return { ...base, kind: 'error', legacy: false };
    case 'REASONING':
      return { ...base, kind: 'reasoning', legacy: false };
    case 'COMMENTARY':
      return { ...base, kind: 'commentary', legacy: false };
    default:
      if (typeof payload.state === 'string') {
        return { ...base, kind: 'state', state: payload.state, legacy: false };
      }
      return { ...base, kind: 'other', legacy: false };
  }
}

/** Normalize and sort a whole competition's events. */
export function toFrameEvents(events: ArenaEvent[], originMs?: number): FrameEvent[] {
  if (events.length === 0) return [];
  const origin = originMs ?? Math.min(...events.map((e) => Date.parse(e.timestamp)));
  return events.map((e) => toFrameEvent(e, origin)).sort((a, b) => a.t - b.t);
}

// ─── edit depth: the honest-absence decision ─────────────────────────────────

/**
 * How much to trust the block-height channel for one team.
 *
 *   'measured'    the provider reports create-vs-modify from a tool name or its
 *                 own A/M marker. Height is a fact. Draw it solid.
 *   'inferred'    no operation in the payload, but paths repeat, so a second
 *                 sighting of a path is very probably an edit. Height is a
 *                 reasonable guess. Draw it, but mark it.
 *   'unavailable' no operation AND no usable path. There is nothing to count.
 *                 Draw a flat cap with hatching — NEVER a short solid block,
 *                 which would read as "this model did less work".
 */
export type EditDepthMode = 'measured' | 'inferred' | 'unavailable';

export interface TeamTelemetry {
  provider: string;
  capability: ProviderFileCapability;
  editDepth: EditDepthMode;
  /** True when any file event for this team arrived in the legacy shape. */
  legacy: boolean;
  /** Plain-English reason, shown in the renderer's legend. Never hidden. */
  note?: string;
}

/**
 * Decide the edit-depth mode for a team from its declared capability and what
 * its events actually contained. Declared capability alone is not enough: a
 * provider that CAN report an operation still yields nothing on a historical
 * competition recorded before it did.
 */
export function resolveTelemetry(model: string, fileEvents: FrameEvent[]): TeamTelemetry {
  const provider = providerOf(model);
  const capability = capabilityFor(model);
  const anyLegacy = fileEvents.some((e) => e.legacy);
  const anyContract = fileEvents.some((e) => !e.legacy && e.opSource);
  const anyPath = fileEvents.some((e) => !!e.path);

  // A provider that structurally CANNOT report the operation is the primary
  // honest-absence case: its files can be placed (it reports paths) but its
  // heights can never be trusted, no matter how modern the events are. Drawing
  // a growing city for it would be inventing edit counts out of repeated
  // sightings and presenting them at the same visual confidence as claude's
  // tool-derived facts.
  if (!capability.op) {
    return {
      provider,
      capability,
      editDepth: 'unavailable',
      legacy: anyLegacy,
      note: `${provider}: this provider does not report file operations — block heights are drawn flat, not low`,
    };
  }
  if (anyContract) {
    return { provider, capability, editDepth: 'measured', legacy: anyLegacy };
  }
  if (fileEvents.length === 0) {
    // No files at all is a fact about the run, not a gap in telemetry.
    return { provider, capability, editDepth: 'measured', legacy: false };
  }
  if (anyPath) {
    return {
      provider,
      capability,
      editDepth: 'inferred',
      legacy: anyLegacy,
      note: `${provider}: edit depth inferred from repeated paths — this competition predates file-operation telemetry`,
    };
  }
  return {
    provider,
    capability,
    editDepth: 'unavailable',
    legacy: anyLegacy,
    note: `${provider}: no file paths in these events — block heights are not measurable and are drawn flat`,
  };
}
