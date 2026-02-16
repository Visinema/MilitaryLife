import type { FastifyInstance } from 'fastify';
import { parseOrThrow, sendValidationError } from '../../utils/validate.js';
import {
  academyEnrollSchemaV5,
  certificationExamSchemaV5,
  missionExecuteSchemaV5,
  missionPlanSchemaV5,
  npcListQuerySchema,
  sessionHeartbeatSchema,
  sessionStartSchema,
  sessionSyncQuerySchema
} from './schema.js';
import {
  completeCeremonyV5,
  enrollAcademyV5,
  executeMissionV5,
  getCurrentCeremonyV5,
  getNpcDetailV5,
  heartbeatSessionV5,
  listNpcsV5,
  planMissionV5,
  startSessionV5,
  submitCertificationExamV5,
  syncSessionV5
} from './service.js';

export async function gameV5Routes(app: FastifyInstance): Promise<void> {
  app.post('/session/start', async (request, reply) => {
    try {
      const body = parseOrThrow(sessionStartSchema, request.body ?? {});
      await startSessionV5(request, reply, body);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.post('/session/heartbeat', async (request, reply) => {
    try {
      const body = parseOrThrow(sessionHeartbeatSchema, request.body ?? {});
      await heartbeatSessionV5(request, reply, body);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.get('/session/sync', async (request, reply) => {
    try {
      const query = parseOrThrow(sessionSyncQuerySchema, request.query ?? {});
      await syncSessionV5(request, reply, query.sinceVersion);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.get('/npcs', async (request, reply) => {
    try {
      const query = parseOrThrow(npcListQuerySchema, request.query ?? {});
      await listNpcsV5(request, reply, query);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.get('/npcs/:npcId', async (request, reply) => {
    const npcId = (request.params as { npcId: string }).npcId;
    await getNpcDetailV5(request, reply, npcId);
  });

  app.post('/missions/plan', async (request, reply) => {
    try {
      const body = parseOrThrow(missionPlanSchemaV5, request.body ?? {});
      await planMissionV5(request, reply, body);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.post('/missions/execute', async (request, reply) => {
    try {
      const body = parseOrThrow(missionExecuteSchemaV5, request.body ?? {});
      await executeMissionV5(request, reply, body);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.get('/ceremony/current', async (request, reply) => {
    await getCurrentCeremonyV5(request, reply);
  });

  app.post('/ceremony/complete', async (request, reply) => {
    await completeCeremonyV5(request, reply);
  });

  app.post('/academy/enroll', async (request, reply) => {
    try {
      const body = parseOrThrow(academyEnrollSchemaV5, request.body ?? {});
      await enrollAcademyV5(request, reply, body);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.post('/certifications/exam', async (request, reply) => {
    try {
      const body = parseOrThrow(certificationExamSchemaV5, request.body ?? {});
      await submitCertificationExamV5(request, reply, body);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });
}

