import type { FastifyInstance } from 'fastify';
import { parseOrThrow, sendValidationError } from '../../utils/validate.js';
import { createProfileSchema } from './schema.js';
import { createProfile } from './service.js';

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.post('/create', async (request, reply) => {
    try {
      const body = parseOrThrow(createProfileSchema, request.body);
      await createProfile(request, reply, { ...body, startAge: body.startAge ?? 17 });
    } catch (err) {
      sendValidationError(reply, err);
    }
  });
}
