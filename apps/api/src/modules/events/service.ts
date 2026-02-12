import type { FastifyReply, FastifyRequest } from 'fastify';
import { attachAuth } from '../auth/service.js';
import { findProfileId, listActiveEventsForProfile } from './repo.js';

export async function getEventPool(request: FastifyRequest, reply: FastifyReply, limit: number): Promise<void> {
  await attachAuth(request);
  if (!request.auth) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const client = await request.server.db.connect();
  try {
    const profileId = request.auth.profileId ?? (await findProfileId(client, request.auth.userId));
    if (!profileId) {
      reply.code(404).send({ error: 'Profile not found' });
      return;
    }

    const items = await listActiveEventsForProfile(client, profileId, limit);
    reply.code(200).send({ items });
  } catch (err) {
    request.log.error(err, 'events-pool-failure');
    reply.code(500).send({ error: 'Failed to load event pool' });
  } finally {
    client.release();
  }
}
