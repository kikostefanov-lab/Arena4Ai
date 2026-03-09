import { db } from '../db/client.js';
import { CompetitionRepository } from '../db/repository.js';

/** Shared repository singleton. Both websocket.ts and competitions.ts import from here. */
export const repo = new CompetitionRepository(db);
