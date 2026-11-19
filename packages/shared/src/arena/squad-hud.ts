/**
 * Squad wording for the log view, kept in shared so it is tested here (the web
 * package has no test runner) and the log and the arena say the same thing.
 */

export interface SquadEventLine {
  icon: string;
  label: string;
  text: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The log line for a SUB_AGENT_SPAWN / SUB_AGENT_DONE event; null for any other type or a bad payload. */
export function describeSquadEvent(type: string, payload: unknown): SquadEventLine | null {
  if (type !== 'SUB_AGENT_SPAWN' && type !== 'SUB_AGENT_DONE') return null;
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  if (type === 'SUB_AGENT_SPAWN') {
    const text = [str(p.label) || str(p.agentId) || 'sub-agent', str(p.model)].filter(Boolean).join(' · ');
    return { icon: '🛰', label: 'SQUAD +', text };
  }

  const status = str(p.status) || 'unknown';
  const text = [status, str(p.reason)].filter(Boolean).join(' · ');
  return { icon: status === 'completed' ? '✓' : '✗', label: 'SQUAD −', text };
}
