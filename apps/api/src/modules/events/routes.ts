import type { FastifyInstance } from 'fastify';
import { parseOrThrow, sendValidationError } from '../../utils/validate.js';
import { getEventPool } from './service.js';
import { eventPoolQuerySchema } from './schema.js';

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/pool', async (request, reply) => {
    try {
      const query = parseOrThrow(eventPoolQuerySchema, request.query ?? {});
      await getEventPool(request, reply, query.limit ?? 20);
    } catch (err) {
      sendValidationError(reply, err);
    }
  });
}
