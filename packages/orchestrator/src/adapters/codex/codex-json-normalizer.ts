import {
  EventType,
  type ArenaEvent,
  type SubAgentDonePayload,
  type SubAgentSpawnPayload,
  type SubAgentStatus,
} from '@arena/shared';
import {
  makeEvent,
  makeFileEvent,
  squadLabel,
  toRelativePath,
  type NormalizeContext,
} from '../normalizer-utils.js';

type Json = Record<string, unknown>;

/** Sub-agent states that mean "still working": no DONE yet. */
const OPEN_STATES = new Set(['pending_init', 'running', 'in_progress']);

/** Error-like terminal states: the sub-agent itself failed. */
const FAILED_STATES = new Set(['errored', 'failed', 'error']);
/** Terminal states where the sub-agent was stopped rather than failing. */
const KILLED_STATES = new Set(['shutdown', 'interrupted', 'closed', 'cancelled', 'canceled']);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * A codex sub-agent's terminal status in the contract's terms. Only error-like
 * states are `failed`: a lead that shuts a helper down has not watched it fail.
 */
export function codexSubAgentStatus(status: string): SubAgentStatus {
  if (status === 'completed') return 'completed';
  if (FAILED_STATES.has(status)) return 'failed';
  if (KILLED_STATES.has(status)) return 'killed';
  return 'unknown';
}

/** The message of an error-shaped object: `message` or `error.message` (or `error` itself). */
function errorMessage(obj: Json): string | undefined {
  const err = obj.error;
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object') {
    const m = str((err as Json).message);
    if (m) return m;
  }
  return str(obj.message) || undefined;
}

/**
 * Normalises `codex exec --json` stdout (JSONL) into ArenaEvents.
 *
 * `item.completed` lines carry the work: `item.started` has the same data
 * half-filled. Of the bookkeeping lines only the failures matter: a top-level
 * `error` and `turn.failed` are where `--json` puts the reason a run died (it no
 * longer reaches stderr), so they become ERROR events the adapter also keeps for
 * the crash summary. One line can yield several events (a multi-file change, a
 * `wait` that closes several sub-agents).
 */
export class CodexJsonNormalizer {
  private readonly known = new Set<string>();
  private readonly done = new Set<string>();

  constructor(private readonly ctx: NormalizeContext) {}

  addLine(line: string): ArenaEvent[] {
    let msg: Json;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object') return [];
      msg = parsed as Json;
    } catch {
      return [];
    }
    if (msg.type === 'error' || msg.type === 'turn.failed') {
      const error = errorMessage(msg) ?? (msg.type === 'turn.failed' ? 'Codex turn failed' : 'Codex error');
      return [makeEvent(EventType.ERROR, { error, raw: msg }, this.ctx)];
    }
    if (msg.type !== 'item.completed') return [];
    const item = msg.item;
    if (!item || typeof item !== 'object') return [];
    return this.item(item as Json);
  }

  private item(item: Json): ArenaEvent[] {
    switch (item.type) {
      case 'agent_message':
      case 'reasoning': {
        const text = str(item.text);
        return text ? [makeEvent(EventType.REASONING, { text }, this.ctx)] : [];
      }
      case 'command_execution':
        return [makeEvent(EventType.TOOL_CALL, {
          tool: 'exec',
          input: { command: item.command },
          exitCode: item.exit_code,
          status: item.status,
        }, this.ctx)];
      case 'file_change': {
        const changes = Array.isArray(item.changes) ? (item.changes as unknown[]) : [];
        return changes.flatMap((raw) => {
          if (!raw || typeof raw !== 'object') return [];
          const c = raw as Json;
          const path = str(c.path);
          if (!path) return [];
          // A deleted file is not a block to raise; the contract has no delete
          // op, so a delete emits nothing rather than masquerading as a modify.
          if (c.kind === 'delete') return [];
          const rel = toRelativePath(path);
          const op = c.kind === 'add' ? 'create' : 'modify';
          return [makeFileEvent({
            op,
            opSource: 'marker',
            path: rel,
            text: `${op === 'create' ? 'Created' : 'Modified'} ${rel}`,
          }, this.ctx)];
        });
      }
      case 'web_search':
        return [makeEvent(EventType.TOOL_CALL, {
          tool: 'web_search',
          input: { query: str(item.query) ?? '' },
        }, this.ctx)];
      case 'error':
        return [makeEvent(EventType.ERROR, { error: errorMessage(item) ?? 'Codex error', raw: item }, this.ctx)];
      case 'collab_tool_call':
        return this.collab(item);
      default:
        return [];
    }
  }

  private collab(item: Json): ArenaEvent[] {
    const tool = str(item.tool);
    const receivers = Array.isArray(item.receiver_thread_ids)
      ? (item.receiver_thread_ids as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

    if (tool === 'spawn_agent') {
      if (item.status === 'failed') {
        return [makeEvent(
          EventType.REASONING,
          { text: 'Codex refused a sub-agent: concurrency cap reached' },
          this.ctx,
        )];
      }
      if (item.status !== 'completed') return [];
      const prompt = str(item.prompt) ?? '';
      const model = str(item.model);
      const events: ArenaEvent[] = [];
      for (const id of receivers) {
        if (this.known.has(id)) continue;
        this.known.add(id);
        const payload: SubAgentSpawnPayload = {
          agentId: id,
          label: squadLabel(prompt),
          description: prompt,
          depth: 1,
          ...(model ? { model } : {}),
        };
        events.push(makeEvent(EventType.SUB_AGENT_SPAWN, payload, this.ctx));
      }
      return events;
    }

    if (tool === 'wait' || tool === 'close_agent') {
      const states = item.agents_states && typeof item.agents_states === 'object'
        ? (item.agents_states as Record<string, Json>)
        : {};
      const events: ArenaEvent[] = [];
      const finish = (id: string, status: SubAgentStatus, summary?: string, reason?: string) => {
        this.done.add(id);
        const payload: SubAgentDonePayload = {
          agentId: id,
          status,
          ...(summary ? { summary } : {}),
          ...(reason ? { reason } : {}),
        };
        events.push(makeEvent(EventType.SUB_AGENT_DONE, payload, this.ctx));
      };
      // A completed close_agent has stopped its receivers whatever state they
      // were in: a helper still running is `killed` by its lead, not failed.
      const closing = tool === 'close_agent' && item.status === 'completed';
      for (const [id, state] of Object.entries(states)) {
        if (this.done.has(id)) continue;
        const status = str(state?.status) ?? '';
        if (OPEN_STATES.has(status)) {
          if (closing) finish(id, 'killed', undefined, 'closed by lead');
          continue;
        }
        finish(id, codexSubAgentStatus(status), str(state?.message));
      }
      if (closing) {
        for (const id of receivers) {
          if (!this.done.has(id) && this.known.has(id)) finish(id, 'killed', undefined, 'closed by lead');
        }
      }
      if (events.length === 0 && receivers.length === 0 && this.known.size === 0) {
        return [makeEvent(
          EventType.REASONING,
          { text: 'Codex reported a squad it did not identify', squadUnidentified: true },
          this.ctx,
        )];
      }
      return events;
    }
    return [];
  }
}
