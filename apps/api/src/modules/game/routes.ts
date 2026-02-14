import type { FastifyInstance } from 'fastify';
import { parseOrThrow, sendValidationError } from '../../utils/validate.js';
import {
  decisionChoiceSchema,
  decisionLogQuerySchema,
  deploymentSchema,
  pauseSchema,
  resumeSchema,
  trainingSchema
} from './schema.js';
import {
  chooseDecision,
  getCurrentSnapshotForSubPage,
  getDecisionLogs,
  getGameConfig,
  getSnapshot,
  pauseGame,
  resumeGame,
  runCareerReview,
  runDeployment,
  runTraining,
  restartWorldFromZero
} from './service.js';

export async function gameRoutes(app: FastifyInstance): Promise<void> {
  app.get('/snapshot', async (request, reply) => {
    await getSnapshot(request, reply);
  });

  app.post('/pause', async (request, reply) => {
    try {
      const body = parseOrThrow(pauseSchema, request.body);
      await pauseGame(request, reply, body.reason);
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.post('/resume', async (request, reply) => {
    try {
      const body = parseOrThrow(resumeSchema, request.body);
      await resumeGame(request, reply, body.pauseToken);
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.post('/actions/training', async (request, reply) => {
    try {
      const body = parseOrThrow(trainingSchema, request.body);
      await runTraining(request, reply, body.intensity);
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.post('/actions/deployment', async (request, reply) => {
    try {
      const body = parseOrThrow(deploymentSchema, request.body);
      await runDeployment(request, reply, body.missionType, body.missionDurationDays);
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.post('/actions/career-review', async (request, reply) => {
    await runCareerReview(request, reply);
  });


  app.post('/actions/restart-world', async (request, reply) => {
    await restartWorldFromZero(request, reply);
  });

  app.post('/decisions/:eventId/choose', async (request, reply) => {
    try {
      const eventId = Number((request.params as { eventId: string }).eventId);
      if (!Number.isInteger(eventId)) {
        reply.code(400).send({ error: 'Invalid event id' });
        return;
      }
      const body = parseOrThrow(decisionChoiceSchema, request.body);
      await chooseDecision(request, reply, eventId, body.optionId);
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.get('/decision-logs', async (request, reply) => {
    try {
      const query = parseOrThrow(decisionLogQuerySchema, request.query ?? {});
      await getDecisionLogs(request, reply, { cursor: query.cursor, limit: query.limit ?? 20 });
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.get('/config', async (request, reply) => {
    await getGameConfig(request, reply);
  });

  app.get('/subpage-snapshot', async (request, reply) => {
    await getCurrentSnapshotForSubPage(request, reply);
  });
}
