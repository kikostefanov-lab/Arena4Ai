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
