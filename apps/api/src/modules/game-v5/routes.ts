import type { FastifyInstance } from 'fastify';
import { parseOrThrow, sendValidationError } from '../../utils/validate.js';
import {
  academyBatchStartSchemaV51,
  academyBatchSubmitDaySchemaV51,
  academyEnrollSchemaV5,
  certificationExamSchemaV5,
  missionExecuteSchemaV5,
  missionPlanSchemaV5,
  npcListQuerySchema,
  recruitmentApplySchemaV51,
  recruitmentBoardQuerySchemaV51,
  sessionHeartbeatSchema,
  sessionStartSchema,
  sessionSyncQuerySchema
} from './schema.js';
import {
  applyRecruitmentV51,
  getAcademyBatchCurrentV51,
  getExpansionStateV51,
  getRecruitmentBoardV51,
  completeCeremonyV5,
  graduateAcademyBatchV51,
  enrollAcademyV5,
  executeMissionV5,
  getCurrentCeremonyV5,
  getNpcDetailV5,
  heartbeatSessionV5,
  listNpcsV5,
  planMissionV5,
  startAcademyBatchV51,
  startSessionV5,
  submitCertificationExamV5,
  submitAcademyBatchDayV51,
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

  app.get('/expansion/state', async (request, reply) => {
    await getExpansionStateV51(request, reply);
  });

  app.post('/academy/batch/start', async (request, reply) => {
    try {
      const body = parseOrThrow(academyBatchStartSchemaV51, request.body ?? {});
      await startAcademyBatchV51(request, reply, body);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.get('/academy/batch/current', async (request, reply) => {
    await getAcademyBatchCurrentV51(request, reply);
  });

  app.post('/academy/batch/submit-day', async (request, reply) => {
    try {
      const body = parseOrThrow(academyBatchSubmitDaySchemaV51, request.body ?? {});
      await submitAcademyBatchDayV51(request, reply, body);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.post('/academy/batch/graduate', async (request, reply) => {
    await graduateAcademyBatchV51(request, reply);
  });

  app.get('/recruitment/board', async (request, reply) => {
    try {
      const query = parseOrThrow(recruitmentBoardQuerySchemaV51, request.query ?? {});
      await getRecruitmentBoardV51(request, reply, query.division);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.post('/recruitment/apply', async (request, reply) => {
    try {
      const body = parseOrThrow(recruitmentApplySchemaV51, request.body ?? {});
      await applyRecruitmentV51(request, reply, body);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });
}

