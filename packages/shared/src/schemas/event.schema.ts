import { z } from 'zod';
import { EventType } from '../constants/event-types.js';

export const arenaEventSchema = z.object({
  eventId: z.string().min(1),
  competitionId: z.string().min(1),
  teamId: z.string().min(1),
  timestamp: z.string().datetime(),
  type: z.nativeEnum(EventType),
  payload: z.unknown(),
  metadata: z.record(z.unknown()),
});
