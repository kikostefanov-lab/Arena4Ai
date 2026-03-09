import type { ArenaEvent } from './event.js';
import type { Brief, Deliverable } from './competition.js';

export interface ModelAdapter {
  teamId: string;
  injectBrief(brief: Brief, persona: string): Promise<void>;
  startExecution(): Promise<void>;
  on(event: 'arenaEvent', listener: (e: ArenaEvent) => void): this;
  collectDeliverables(): Promise<Deliverable>;
  shutdown(): Promise<void>;
}
