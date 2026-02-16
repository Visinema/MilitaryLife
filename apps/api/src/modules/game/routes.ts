import type { FastifyInstance } from 'fastify';
import { parseOrThrow, sendValidationError } from '../../utils/validate.js';
import {
  decisionChoiceSchema,
  decisionLogQuerySchema,
  deploymentSchema,
  pauseSchema,
  resumeSchema,
  trainingSchema,
  militaryAcademySchema,
  travelSchema,
  commandActionSchema,
  socialInteractionSchema,
  recruitmentApplySchema,
  newsQuerySchema,
  gameTimeScaleSchema
} from './schema.js';
import {
  chooseDecision,
  getCurrentSnapshotForSubPage,
  getNpcBackgroundActivity,
  getDecisionLogs,
  getGameConfig,
  getSnapshot,
  getCeremonyReport,
  pauseGame,
  resumeGame,
  runCareerReview,
  runDeployment,
  runTraining,
  restartWorldFromZero,
  runMilitaryAcademy,
  runTravel,
  runCommandAction,
  runSocialInteraction,
  completeCeremony,
  runRaiderDefense,
  runRecruitmentApply,
  getNews,
  setGameTimeScale
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

  app.post('/actions/military-academy', async (request, reply) => {
    try {
      const body = parseOrThrow(militaryAcademySchema, request.body ?? {});
      await runMilitaryAcademy(request, reply, {
        tier: body.tier === 2 ? 2 : 1,
        answers: body.answers ?? null,
        preferredDivision: body.preferredDivision
      });
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.post('/actions/travel', async (request, reply) => {
    try {
      const body = parseOrThrow(travelSchema, request.body);
      await runTravel(request, reply, body.place);
    } catch (err) {
      sendValidationError(reply, err);
    }
  });



  app.post('/actions/command', async (request, reply) => {
    try {
      const body = parseOrThrow(commandActionSchema, request.body ?? {});
      await runCommandAction(request, reply, body);
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.post('/actions/restart-world', async (request, reply) => {
    await restartWorldFromZero(request, reply);
  });


  app.post('/actions/ceremony-complete', async (request, reply) => {
    await completeCeremony(request, reply);
  });

  app.post('/actions/raider-defense', async (request, reply) => {
    await runRaiderDefense(request, reply);
  });


  app.post('/actions/recruitment-apply', async (request, reply) => {
    try {
      const body = parseOrThrow(recruitmentApplySchema, request.body ?? {});
      await runRecruitmentApply(request, reply, { trackId: body.trackId, answers: body.answers ?? {} });
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.post('/actions/social-interaction', async (request, reply) => {
    try {
      const body = parseOrThrow(socialInteractionSchema, request.body ?? {});
      await runSocialInteraction(request, reply, body);
    } catch (err) {
      sendValidationError(reply, err);
    }
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

  app.get('/ceremony', async (request, reply) => {
    await getCeremonyReport(request, reply);
  });

  app.get('/subpage-snapshot', async (request, reply) => {
    await getCurrentSnapshotForSubPage(request, reply);
  });


  app.get('/news', async (request, reply) => {
    try {
      const query = parseOrThrow(newsQuerySchema, request.query ?? {});
      await getNews(request, reply, query.type);
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.post('/actions/time-scale', async (request, reply) => {
    try {
      const body = parseOrThrow(gameTimeScaleSchema, request.body ?? {});
      const scale: 1 | 3 = body.scale === 3 ? 3 : 1;
      await setGameTimeScale(request, reply, { scale });
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.get('/npc-activity', async (request, reply) => {
    await getNpcBackgroundActivity(request, reply);
  });
}
