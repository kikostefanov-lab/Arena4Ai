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

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Normalises `codex exec --json` stdout (JSONL) into ArenaEvents.
 *
 * Only `item.completed` lines are acted on: `item.started` carries the same data
 * half-filled, and `thread.*` / `turn.*` are bookkeeping. One line can yield
 * several events (a multi-file change, a `wait` that closes several sub-agents).
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
        const changes = Array.isArray(item.changes) ? (item.changes as Json[]) : [];
        return changes.flatMap((c) => {
          const path = str(c.path);
          if (!path) return [];
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
        return [makeEvent(EventType.ERROR, { error: str(item.message) ?? 'Codex error', raw: item }, this.ctx)];
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
      for (const [id, state] of Object.entries(states)) {
        const status = str(state?.status) ?? '';
        if (OPEN_STATES.has(status) || this.done.has(id)) continue;
        this.done.add(id);
        const mapped: SubAgentStatus = status === 'completed' ? 'completed' : 'failed';
        const summary = str(state?.message);
        const payload: SubAgentDonePayload = {
          agentId: id,
          status: mapped,
          ...(summary ? { summary } : {}),
        };
        events.push(makeEvent(EventType.SUB_AGENT_DONE, payload, this.ctx));
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
