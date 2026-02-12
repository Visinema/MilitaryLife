import type { FastifyReply, FastifyRequest } from 'fastify';
import { attachAuth } from '../auth/service.js';
import { createProfileAndGameState, findProfileByUserId } from './repo.js';
import type { BranchCode, CountryCode } from '@mls/shared/constants';

export async function createProfile(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: { name: string; startAge: number; country: CountryCode; branch: BranchCode }
) {
  await attachAuth(request);
  if (!request.auth) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  if (!request.auth.sessionId) {
    reply.code(401).send({ error: 'Invalid session' });
    return;
  }

  const client = await request.server.db.connect();
  try {
    await client.query('BEGIN');

    const existing = await findProfileByUserId(client, request.auth.userId);
    if (existing) {
      await client.query('ROLLBACK');
      reply.code(409).send({ error: 'Profile already exists' });
      return;
    }

    const created = await createProfileAndGameState(client, {
      userId: request.auth.userId,
      sessionId: request.auth.sessionId,
      nowMs: Date.now(),
      ...payload
    });

    await client.query('COMMIT');

    reply.code(201).send({
      profileId: created.profileId,
      name: payload.name,
      country: payload.country,
      branch: payload.branch,
      startAge: payload.startAge
    });
  } catch (err) {
    await client.query('ROLLBACK');
    request.log.error(err, 'profile-create-failed');
    reply.code(500).send({ error: 'Failed to create profile' });
  } finally {
    client.release();
  }
}
