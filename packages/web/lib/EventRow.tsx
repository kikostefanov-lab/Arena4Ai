'use client';

import { hexToRgb, BODY_FONT, BODY_FONT_SIZE, BODY_FONT_SIZE_SM, BODY_LINE_HEIGHT } from './design-tokens';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface EventRowEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface EventInfo {
  label: string;
  icon: string;
  color: string;
  bg: string;
  text: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getToolIcon(toolName: string): string {
  const n = toolName.toLowerCase();
  if (/bash|shell|run|exec|command/.test(n)) return '⚡';
  if (/write|create|save/.test(n)) return '✍️';
  if (/read|cat|view|open/.test(n)) return '👁️';
  if (/search|grep|find|glob/.test(n)) return '🔍';
  if (/python|py|node|js/.test(n)) return '🐍';
  if (/edit|replace|patch|str/.test(n)) return '✏️';
  if (/web|http|fetch|curl|url/.test(n)) return '🌐';
  if (/list|ls|dir/.test(n)) return '📂';
  if (/git/.test(n)) return '🔀';
  return '🔧';
}

export function toolCommentary(toolName: string, valStr: string): string {
  const n = toolName.toLowerCase();
  if (/bash|shell|run|exec/.test(n)) return `$ ${valStr}`;
  if (/write|create/.test(n)) return `Writing to ${valStr}`;
  if (/read|cat|view/.test(n)) return `Reading ${valStr}`;
  if (/search|grep|find/.test(n)) return `Searching: ${valStr}`;
  if (/edit|replace|patch|str/.test(n)) return `Patching ${valStr}`;
  if (/glob/.test(n)) return `Glob: ${valStr}`;
  return valStr ? `${toolName}: ${valStr}` : toolName;
}

export function classifyEvent(type: string, payload: unknown): EventInfo | null {
  const p = payload as Record<string, unknown> | null;
  if (!p) return null;

  switch (type) {
    case 'TOOL_CALL': {
      const tool = String(p.tool ?? 'unknown');
      const input = (p.input ?? {}) as Record<string, unknown>;
      const val = input.command ?? input.code ?? input.path ?? input.query ?? input.content;
      const valStr = val ? String(val).replace(/\n/g, ' ').trim().slice(0, 80) : '';
      const keys = Object.keys(input);
      const text = toolCommentary(tool, valStr || (keys.length ? `${keys[0]}=…` : ''));
      return {
        label: tool.toUpperCase().slice(0, 8),
        icon: getToolIcon(tool),
        color: '#0080ff',
        bg: 'rgba(0,128,255,0.08)',
        text,
      };
    }

    case 'FILE_CREATE': {
      const text = String(p.text ?? p.path ?? '');
      const m = text.match(/(\/?(?:[\w.-]+\/)*[\w.-]+\.\w+)/);
      const fname = m ? m[1] : text.slice(0, 80);
      return { label: 'CREATE', icon: '📄', color: '#00f0ff', bg: 'rgba(0,240,255,0.08)', text: `New file: ${fname}` };
    }

    case 'FILE_MODIFY': {
      const text = String(p.text ?? p.path ?? '');
      const m = text.match(/(\/?(?:[\w.-]+\/)*[\w.-]+\.\w+)/);
      const fname = m ? m[1] : text.slice(0, 80);
      return { label: 'MODIFY', icon: '✏️', color: '#0066ff', bg: 'rgba(0,102,255,0.08)', text: `Modified: ${fname}` };
    }

    case 'REASONING': {
      if (p.text && typeof p.text === 'string') {
        return { label: 'THINK', icon: '🧠', color: '#0080ff', bg: 'rgba(0,128,255,0.06)', text: p.text.trim() };
      }
      if (p.raw) {
        const raw = p.raw as Record<string, unknown>;

        if (raw.type === 'system' || raw.type === 'rate_limit_event') return null;

        if (raw.type === 'user') {
          const msg = raw.message as Record<string, unknown> | null;
          const content = msg?.content;
          if (Array.isArray(content)) {
            const toolResult = (content as Record<string, unknown>[]).find((b) => b.type === 'tool_result');
            if (toolResult?.content && typeof toolResult.content === 'string') {
              const resultText = toolResult.content.replace(/\n/g, ' ').trim();
              const isErr = /error|failed|exception|traceback|command not found/i.test(resultText);
              return {
                label: isErr ? 'FAIL' : 'RESULT',
                icon: isErr ? '❌' : '✅',
                color: isErr ? '#ef4444' : '#00f0ff',
                bg: isErr ? 'rgba(239,68,68,0.08)' : 'rgba(0,240,255,0.06)',
                text: resultText,
              };
            }
          }
          return null;
        }

        if (raw.type === 'result') {
          const res = raw.result;
          const resText = res && typeof res === 'string' ? res.trim() : null;
          if (!resText) return null;
          return { label: 'DONE', icon: '🏁', color: '#ff6600', bg: 'rgba(255,102,0,0.08)', text: resText };
        }

        if (raw.type === 'assistant') {
          const msg = raw.message as Record<string, unknown> | null;
          const content = msg?.content;
          if (Array.isArray(content)) {
            const blocks = content as Record<string, unknown>[];

            // Text output from agent
            const tb = blocks.find((b) => b.type === 'text');
            if (tb?.text && typeof tb.text === 'string') {
              return { label: 'OUTPUT', icon: '💬', color: '#00d4ff', bg: 'rgba(0,212,255,0.07)', text: tb.text };
            }

            // Claude's internal thinking
            const thinkBlock = blocks.find((b) => b.type === 'thinking');
            if (thinkBlock?.thinking && typeof thinkBlock.thinking === 'string') {
              const rawThink = thinkBlock.thinking.replace(/\n/g, ' ').trim();
              // Take first natural sentence for punchy commentary
              const sentence = rawThink.match(/[^.!?]{10,}[.!?]/)?.[0]?.trim() ?? rawThink;
              return { label: 'THINK', icon: '🧠', color: '#0080ff', bg: 'rgba(0,128,255,0.06)', text: sentence };
            }

            // Tool invocation
            const toolBlock = blocks.find((b) => b.type === 'tool_use');
            if (toolBlock) {
              const toolName = String(toolBlock.name ?? 'tool');
              const input = toolBlock.input as Record<string, unknown> | undefined;
              const val = input?.command ?? input?.code ?? input?.path ?? input?.content ?? input?.query ?? input?.pattern;
              const valStr = val && typeof val === 'string' ? val.replace(/\n/g, ' ').slice(0, 80) : '';
              const text = toolCommentary(toolName, valStr);
              return {
                label: toolName.toUpperCase().slice(0, 8),
                icon: getToolIcon(toolName),
                color: '#0080ff',
                bg: 'rgba(0,128,255,0.08)',
                text,
              };
            }
          }
          return null;
        }
      }
      return null;
    }

    case 'ERROR': {
      const err = p.error;
      let text = '';
      if (typeof err === 'string') text = err;
      else if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>;
        text = String(e.message ?? e.text ?? JSON.stringify(err));
      } else {
        text = typeof p.raw === 'string' ? p.raw.slice(0, 120) : '';
      }
      if (!text) return null;
      return { label: 'ERROR', icon: '⚠️', color: '#ef4444', bg: 'rgba(239,68,68,0.10)', text };
    }

    case 'COMMENTARY': {
      const text = typeof p.text === 'string' ? p.text.trim() : '';
      if (!text) return null;
      return { label: '🎙️ Commentary', icon: '🎙️', color: '#ffd700', bg: 'rgba(255,215,0,0.08)', text };
    }

    case 'TIME_WARNING':
    case 'TIME_UP': {
      const rem = p.remainingMs ?? p.remaining;
      const text = rem != null ? `${Math.round(Number(rem) / 1000)}s remaining on the clock` : null;
      if (!text) return null;
      const isUp = type === 'TIME_UP';
      return { label: isUp ? 'TIME UP' : 'TIME', icon: '⏰', color: isUp ? '#ff6600' : '#ffd700', bg: isUp ? 'rgba(255,102,0,0.12)' : 'rgba(255,215,0,0.10)', text };
    }

    case 'JUDGE_SCORE': {
      const score = p.score ?? p.totalScore;
      const crit = p.criterionId ?? p.criterion;
      if (crit && score != null) return { label: 'SCORE', icon: '⚖️', color: '#0066ff', bg: 'rgba(0,102,255,0.10)', text: `${String(crit)} → ${score}` };
      return null;
    }

    default: return null;
  }
}

export function getRelativeTime(timestamp: string, startTs: string | null): string {
  if (!startTs) return '';
  const diff = Math.max(0, new Date(timestamp).getTime() - new Date(startTs).getTime());
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${(s % 60).toString().padStart(2, '0')}s` : `${s}s`;
}

// ─── EventRow component ───────────────────────────────────────────────────────

const EXPAND_THRESHOLD = 120;

export function EventRow({
  event,
  startTs,
  expanded,
  onToggle,
  isNew,
}: {
  event: EventRowEvent;
  startTs: string | null;
  expanded: boolean;
  onToggle: () => void;
  isNew?: boolean;
}) {
  const info = classifyEvent(event.type, event.payload);
  if (!info) return null;

  const relTime = getRelativeTime(event.timestamp, startTs);
  const canExpand = info.text.length > EXPAND_THRESHOLD;

  return (
    <div
      style={{
        borderLeft: expanded ? '2px solid #00f0ff' : '2px solid transparent',
        borderRadius: '8px',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Main row */}
      <div
        className={isNew ? 'arena-event-row' : undefined}
        onClick={canExpand ? onToggle : undefined}
        style={{
          background: info.bg,
          borderRadius: expanded ? '8px 8px 0 0' : '8px',
          padding: '0.55rem 0.8rem',
          fontSize: '0.88rem',
          lineHeight: 1.5,
          display: 'flex',
          gap: '0.55rem',
          alignItems: 'flex-start',
          cursor: canExpand ? 'pointer' : 'default',
          transition: 'background 0.15s ease',
        }}
      >
        {/* Timestamp */}
        <span style={{
          color: '#3d7d94', fontSize: '0.58rem', fontFamily: BODY_FONT,
          flexShrink: 0, width: '2.8rem', textAlign: 'right',
          marginTop: '2px', letterSpacing: '-0.3px',
        }}>
          {relTime}
        </span>
        {/* Icon */}
        <span style={{ flexShrink: 0, fontSize: '0.82rem', lineHeight: 1.4 }}>{info.icon}</span>
        {/* Label badge */}
        <span style={{
          color: info.color, fontWeight: 800, flexShrink: 0, fontSize: '0.58rem',
          letterSpacing: '0.5px',
          background: `rgba(${hexToRgb(info.color)},0.12)`,
          padding: '0.1rem 0.45rem', borderRadius: '4px', marginTop: '1px',
          whiteSpace: 'nowrap',
        }}>
          {info.label}
        </span>
        {/* Summary text (truncated) */}
        <span style={{
          color: '#c8eef8',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
          fontFamily: BODY_FONT,
          fontSize: '0.65rem',
          lineHeight: 1.4,
        }}>
          {info.text}
        </span>
        {/* Expand arrow */}
        {canExpand && (
          <span style={{ fontSize: '0.6rem', color: '#0e3050', flexShrink: 0, marginLeft: '0.3rem' }}>
            {expanded ? '▲' : '▼'}
          </span>
        )}
      </div>

      {/* Expand panel */}
      {expanded && (
        <div style={{
          background: 'rgba(0,4,8,0.7)',
          borderTop: '1px solid rgba(10,34,53,0.6)',
          borderRadius: '0 0 8px 8px',
          padding: '0.6rem 0.8rem 0.6rem 4.5rem',
        }}>
          <p style={{
            color: '#c8eef8',
            fontSize: BODY_FONT_SIZE,
            lineHeight: BODY_LINE_HEIGHT,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: BODY_FONT,
          }}>
            {info.text}
          </p>
          <button
            onClick={onToggle}
            style={{
              marginTop: '0.5rem',
              background: 'none',
              border: 'none',
              color: '#7cc6db',
              fontSize: '0.65rem',
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'inherit',
            }}
          >
            ▲ collapse
          </button>
        </div>
      )}
    </div>
  );
}
