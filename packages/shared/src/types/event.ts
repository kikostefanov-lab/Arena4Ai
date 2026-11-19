import type { EventType } from '../constants/event-types.js';

/**
 * Event `metadata` keys written by the squad feature (all optional):
 *  - `agentId?: string`  the event was produced by that sub-agent (matches a
 *                        SubAgentSpawnPayload.agentId); absent means the team's lead agent.
 *  - `squad?: true`      a file was written while a squad was open and the member
 *                        responsible is unknown (providers without attribution).
 */
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
export type FileOpSource = 'tool' | 'marker' | 'verb' | 'first-sighting' | 'watch';

/** How a sub-agent ended. 'unknown' when the provider never reported an outcome. */
export type SubAgentStatus = 'completed' | 'failed' | 'killed' | 'unknown';

/** Payload of a SUB_AGENT_SPAWN event. */
export interface SubAgentSpawnPayload {
  agentId: string;
  parentAgentId?: string;
  label: string;
  description: string;
  kind?: string;
  model?: string;
  background?: boolean;
  /** 1 for a direct child of the lead agent. */
  depth: number;
}

const SQUAD_LABEL_MAX = 18;

/**
 * Leading boilerplate a lead's prompt to a sub-agent opens with, which says
 * nothing about the task. "Write …", "Create …" and the like are the task and
 * are kept.
 */
const LABEL_FILLER: readonly RegExp[] = [
  /^in (?:the )?(?:current )?(?:working )?(?:directory|folder|workdir|repo(?:sitory)?)\b[^,:;]*[,:;]\s*/i,
  /^please\b[,\s]*/i,
  /^you are [^.!?]*[.!?]\s+/i, // a whole "You are a helper." sentence, when more follows
  /^you are\s+(?:to\s+)?/i,
  /^your (?:task|job|goal|assignment) is\s+(?:to\s+)?/i,
];

/** The description with leading filler removed, or as given when nothing would be left. */
function stripLabelFiller(text: string): string {
  let out = text;
  for (let changed = true; changed;) {
    changed = false;
    for (const re of LABEL_FILLER) {
      const next = out.replace(re, '');
      if (next !== out && next.trim()) { out = next; changed = true; }
    }
  }
  return out;
}

/**
 * Short chip label for a sub-agent: the first words of its description, at most
 * 18 chars, after leading filler ("In the current working directory,",
 * "Please", "You are …", "Your task is to") so it reads like the task. Shared so
 * the normalizers and the arena's read-time upgrade of stored Claude matches
 * label a sub-agent identically.
 */
export function squadLabel(text: string): string {
  const clean = stripLabelFiller(text.replace(/\s+/g, ' ').trim());
  if (!clean) return 'sub-agent';
  if (clean.length <= SQUAD_LABEL_MAX) return clean;
  const cut = clean.slice(0, SQUAD_LABEL_MAX - 1);
  const atWord = cut.lastIndexOf(' ');
  const base = atWord > 0 ? cut.slice(0, atWord) : cut;
  return `${base.trimEnd()}…`;
}

/**
 * Claude's task statuses (`task_updated.patch.status`, `task_notification.status`)
 * as squad outcomes. Shared by the Claude normalizer and the arena's read-time
 * upgrade of stored matches, so live and replayed squads end the same way.
 */
export const CLAUDE_TASK_STATUS: Readonly<Record<string, SubAgentStatus>> = {
  completed: 'completed',
  failed: 'failed',
  error: 'failed',
  killed: 'killed',
  stopped: 'killed',
};

/** Payload of a SUB_AGENT_DONE event. */
export interface SubAgentDonePayload {
  agentId: string;
  status: SubAgentStatus;
  reason?: string;
  summary?: string;
  model?: string;
  usage?: { tokens?: number; toolUses?: number; durationMs?: number };
}

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
  /** Events can be attributed to the sub-agent that produced them (`metadata.agentId`). */
  subagentAttribution: boolean;
  /** 'live': spawn/done events arrive as they happen. 'collected': reconstructed after the fact. */
  subagentLifecycle: 'live' | 'collected';
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
 * yet to parse it. `opSource` says how far the operation can be trusted.
 *
 * As of AA-037 all three providers report a tool-derived operation, so all three
 * can support edit-counting. Codex remains the one that names no per-file tool:
 * it applies edits via apply_patch, so `tool`/`input` are absent by nature rather
 * than unparsed. Its operation is still reliable — it comes from the CLI's own
 * A/M marker.
 */
export const PROVIDER_FILE_CAPABILITIES: Record<'claude' | 'codex' | 'gemini', ProviderFileCapability> = {
  claude: { path: true, op: true, opSource: 'tool',   tool: true,  input: true,  subagentAttribution: true,  subagentLifecycle: 'live' },
  codex:  { path: true, op: true, opSource: 'marker', tool: false, input: false, subagentAttribution: false, subagentLifecycle: 'collected' },
  // AA-037: gemini now runs with `-o stream-json`, so tool_name and parameters
  // arrive as data. Its operation is tool-derived like claude's, not parsed from
  // prose — and `replace` with an empty old_string is read as a create, which the
  // tool name alone would have got wrong.
  gemini: { path: true, op: true, opSource: 'tool',   tool: true,  input: true,  subagentAttribution: false, subagentLifecycle: 'collected' },
};
