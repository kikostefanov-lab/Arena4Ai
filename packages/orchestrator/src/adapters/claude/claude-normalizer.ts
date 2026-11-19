import {
  EventType,
  type ArenaEvent,
  type SubAgentDonePayload,
  type SubAgentSpawnPayload,
  type SubAgentStatus,
} from '@arena/shared';
import {
  squadLabel,
  stripAnsi,
  makeEvent,
  FILE_PATH_RE,
  makeFileEvent,
  toRelativePath,
  operationFromVerb,
  type NormalizeContext,
} from '../normalizer-utils.js';

/**
 * Content block from Claude Code's stream-json assistant messages.
 */
interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
}

/**
 * Normalise a single line of Claude Code's JSON-lines stdout into a
 * universal ArenaEvent.
 *
 * Claude Code `--output-format stream-json` emits newline-delimited JSON:
 *
 *   { type: "system",  subtype: "init", ... }          → skip (session init)
 *   { type: "assistant", message: { content: [...] } }  → parse content blocks
 *   { type: "user", ... }                               → skip (tool results)
 *   { type: "rate_limit_event", ... }                    → skip
 *
 * Content blocks inside assistant messages:
 *   { type: "tool_use",  name: "Bash", input: {...} }   → TOOL_CALL
 *   { type: "text",      text: "..." }                  → REASONING or FILE_CREATE
 *   { type: "thinking",  thinking: "..." }              → REASONING
 *
 * Malformed JSON produces an ERROR event.
 */
export function normalizeLine(line: string, ctx: NormalizeContext): ArenaEvent {
  let msg: Record<string, unknown>;

  try {
    msg = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return makeEvent(EventType.ERROR, { raw: line, error: 'JSON parse failure' }, ctx);
  }

  // ── Top-level event routing ──────────────────────────────────────────────
  switch (msg.type) {
    case 'assistant': {
      const message = msg.message as Record<string, unknown> | undefined;
      if (!message) return makeEvent(EventType.REASONING, { raw: msg }, ctx);

      const content = message.content as ContentBlock[] | undefined;
      if (!Array.isArray(content) || content.length === 0) {
        return makeEvent(EventType.REASONING, { raw: msg }, ctx);
      }

      // Extract the last content block — Claude streams partial messages
      // so we get the same message ID multiple times as content grows.
      const block = content[content.length - 1];
      return normalizeContentBlock(block, ctx);
    }

    // Legacy format (pre-stream-json) — keep for backward compatibility
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
      const m = FILE_PATH_RE.exec(text);
      if (!m) return makeEvent(EventType.REASONING, { text }, ctx);
      // Prose, not a tool call — the verb is the only operation signal available.
      return makeFileEvent(
        { op: operationFromVerb(m[1]), opSource: 'verb', text, path: m[2] },
        ctx,
      );
    }

    case 'error': {
      const err = msg.error as Record<string, unknown> | undefined;
      return makeEvent(EventType.ERROR, { error: err ?? msg }, ctx);
    }

    // system, user, rate_limit_event — suppress noise
    case 'system':
    case 'user':
    case 'rate_limit_event':
      return makeEvent(EventType.REASONING, { raw: msg }, ctx);

    default:
      return makeEvent(EventType.REASONING, { raw: msg }, ctx);
  }
}

/**
 * Normalise a single content block from an assistant message.
 */
function normalizeContentBlock(block: ContentBlock, ctx: NormalizeContext): ArenaEvent {
  switch (block.type) {
    case 'tool_use': {
      const toolName = block.name ?? 'unknown';
      // Detect file-writing tools
      const isFileWrite = toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit';
      if (isFileWrite) {
        const filePath = (block.input?.file_path as string) ?? (block.input?.path as string) ?? '';
        // Claude names the tool, so the operation is a fact rather than a guess:
        // Write creates, Edit/NotebookEdit change something already there. We take
        // the tool at its word even for a Write over an existing path — the tool is
        // the strongest signal the CLI gives us, and inventing a second rule on top
        // of it would only make Claude's events disagree with Claude's own log.
        const op = toolName === 'Write' ? 'create' : 'modify';
        const relPath = toRelativePath(filePath);
        return makeFileEvent(
          { op, opSource: 'tool', text: relPath, path: relPath || undefined, tool: toolName, input: block.input ?? {} },
          ctx,
        );
      }
      return makeEvent(EventType.TOOL_CALL, { tool: toolName, input: block.input ?? {} }, ctx);
    }

    case 'text': {
      const text = stripAnsi(String(block.text ?? ''));
      const m = FILE_PATH_RE.exec(text);
      if (!m) return makeEvent(EventType.REASONING, { text }, ctx);
      // Prose, not a tool call — the verb is the only operation signal available.
      return makeFileEvent(
        { op: operationFromVerb(m[1]), opSource: 'verb', text, path: m[2] },
        ctx,
      );
    }

    case 'thinking': {
      const text = stripAnsi(String(block.thinking ?? ''));
      return makeEvent(EventType.REASONING, { text }, ctx);
    }

    default:
      return makeEvent(EventType.REASONING, { raw: block }, ctx);
  }
}

const STATUS_MAP: Record<string, SubAgentStatus> = {
  completed: 'completed',
  failed: 'failed',
  error: 'failed',
  killed: 'killed',
  stopped: 'killed',
};

/**
 * Stateful wrapper around {@link normalizeLine} that understands Claude's
 * squad lines: `task_started` / `task_updated` / `task_notification` system
 * lines become SUB_AGENT_SPAWN / SUB_AGENT_DONE, and any line tagged with a
 * `parent_tool_use_id` is attributed to its sub-agent via `metadata.agentId`.
 *
 * One instance per agent process (it remembers tool_use_id -> task id).
 */
export class ClaudeNormalizer {
  private readonly taskByToolUse = new Map<string, string>();
  private readonly known = new Set<string>();
  private readonly done = new Set<string>();
  private readonly modelByAgent = new Map<string, string>();

  constructor(private readonly ctx: NormalizeContext) {}

  addLine(line: string): ArenaEvent[] {
    let msg: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object') msg = parsed as Record<string, unknown>;
    } catch {
      // normalizeLine reports the parse failure
    }
    if (!msg) return [normalizeLine(line, this.ctx)];

    if (msg.type === 'system') {
      const handled = this.systemLine(msg);
      if (handled) return handled;
    }

    const event = normalizeLine(line, this.ctx);
    const parent = msg.parent_tool_use_id;
    if (typeof parent === 'string' && parent) {
      const agentId =
        this.taskByToolUse.get(parent) ?? (typeof msg.agent_id === 'string' ? msg.agent_id : undefined);
      if (agentId) {
        event.metadata.agentId = agentId;
        const model = (msg.message as { model?: unknown } | undefined)?.model;
        if (msg.type === 'assistant' && typeof model === 'string' && !this.modelByAgent.has(agentId)) {
          this.modelByAgent.set(agentId, model);
        }
      }
    }
    return [event];
  }

  /** Returns the events for a squad system line, or undefined when it is not one. */
  private systemLine(msg: Record<string, unknown>): ArenaEvent[] | undefined {
    const taskId = typeof msg.task_id === 'string' ? msg.task_id : undefined;
    if (!taskId) return undefined;

    switch (msg.subtype) {
      case 'task_started': {
        if (msg.task_type !== 'local_agent') return undefined;
        const toolUseId = typeof msg.tool_use_id === 'string' ? msg.tool_use_id : undefined;
        if (toolUseId) this.taskByToolUse.set(toolUseId, taskId);
        this.known.add(taskId);
        const description = typeof msg.description === 'string' ? msg.description : '';
        const payload: SubAgentSpawnPayload = {
          agentId: taskId,
          label: squadLabel(description),
          description,
          kind: typeof msg.subagent_type === 'string' ? msg.subagent_type : undefined,
          background: typeof msg.is_backgrounded === 'boolean' ? msg.is_backgrounded : undefined,
          depth: typeof msg.spawn_depth === 'number' ? msg.spawn_depth : 1,
        };
        return [makeEvent(EventType.SUB_AGENT_SPAWN, payload, this.ctx)];
      }

      case 'task_updated': {
        if (!this.known.has(taskId)) return undefined;
        const status = (msg.patch as { status?: unknown } | undefined)?.status;
        if (typeof status !== 'string' || !(status in STATUS_MAP)) return undefined;
        return this.finish(taskId, STATUS_MAP[status]);
      }

      case 'task_notification': {
        if (!this.known.has(taskId)) return undefined;
        if (this.done.has(taskId)) return [];
        const status = typeof msg.status === 'string' ? STATUS_MAP[msg.status] : undefined;
        const usage = msg.usage as { total_tokens?: number; tool_uses?: number; duration_ms?: number } | undefined;
        return this.finish(taskId, status ?? 'unknown', {
          summary: typeof msg.summary === 'string' ? msg.summary : undefined,
          usage: usage
            ? { tokens: usage.total_tokens, toolUses: usage.tool_uses, durationMs: usage.duration_ms }
            : undefined,
        });
      }

      default:
        return undefined;
    }
  }

  private finish(
    agentId: string,
    status: SubAgentStatus,
    extra: Pick<SubAgentDonePayload, 'summary' | 'usage'> = {},
  ): ArenaEvent[] {
    if (this.done.has(agentId)) return [];
    this.done.add(agentId);
    const payload: SubAgentDonePayload = {
      agentId,
      status,
      model: this.modelByAgent.get(agentId),
      ...extra,
    };
    return [makeEvent(EventType.SUB_AGENT_DONE, payload, this.ctx)];
  }
}

export type { NormalizeContext };
