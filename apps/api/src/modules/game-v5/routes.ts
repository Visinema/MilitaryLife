import type { FastifyInstance } from 'fastify';
import { parseOrThrow, sendValidationError } from '../../utils/validate.js';
import {
  academyBatchStartSchemaV51,
  academyBatchSubmitDaySchemaV51,
  academyEnrollSchemaV5,
  certificationExamSchemaV5,
  commandChainOrderAckSchemaV6,
  commandChainOrderCreateSchemaV6,
  commandChainOrderForwardSchemaV6,
  commandChainOrdersQuerySchemaV6,
  councilVoteSchemaV6,
  courtVerdictSchemaV6,
  divisionApplicationRegisterSchemaV6,
  divisionApplicationTryoutSchemaV6,
  mailboxQuerySchemaV6,
  missionExecuteSchemaV5,
  missionPlanSchemaV5,
  npcListQuerySchema,
  socialTimelineQuerySchemaV6,
  recruitmentApplySchemaV51,
  recruitmentBoardQuerySchemaV51,
  sessionHeartbeatSchema,
  sessionStartSchema,
  sessionSyncQuerySchema
} from './schema.js';
import {
  ackCommandChainOrderV5,
  applyRecruitmentV51,
  createCommandChainOrderV5,
  executeDomSessionV5,
  finalizeDivisionApplicationV5,
  getAcademyProgramsV5,
  getAcademyCertificationsV5,
  getAcademyTitlesV5,
  getAcademyBatchCurrentV51,
  getDivisionsCatalogV5,
  getDivisionApplicationV5,
  getDomCycleCurrentV5,
  getCommandChainOrderV5,
  getMailboxV5,
  getExpansionStateV51,
  getRankHistoryV5,
  getRecruitmentBoardV51,
  getSocialTimelineV5,
  forwardCommandChainOrderV5,
  joinDomSessionV5,
  listCommandChainOrdersV5,
  listCouncilsV5,
  listCourtCasesV5,
  markMailboxReadV5,
  registerDivisionApplicationV5,
  runDivisionApplicationTryoutV5,
  voteCouncilV5,
  verdictCourtCaseV5,
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

  app.get('/personnel/rank-history', async (request, reply) => {
    await getRankHistoryV5(request, reply);
  });

  app.get('/divisions/catalog', async (request, reply) => {
    await getDivisionsCatalogV5(request, reply);
  });

  app.post('/divisions/applications/register', async (request, reply) => {
    try {
      const body = parseOrThrow(divisionApplicationRegisterSchemaV6, request.body ?? {});
      await registerDivisionApplicationV5(request, reply, body);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.post('/divisions/applications/:id/tryout', async (request, reply) => {
    try {
      const body = parseOrThrow(divisionApplicationTryoutSchemaV6, request.body ?? {});
      const params = request.params as { id: string };
      await runDivisionApplicationTryoutV5(request, reply, { applicationId: params.id, answers: body.answers });
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.post('/divisions/applications/:id/finalize', async (request, reply) => {
    const params = request.params as { id: string };
    await finalizeDivisionApplicationV5(request, reply, { applicationId: params.id });
  });

  app.get('/divisions/applications/:id', async (request, reply) => {
    const params = request.params as { id: string };
    await getDivisionApplicationV5(request, reply, params.id);
  });

  app.get('/academy/programs', async (request, reply) => {
    await getAcademyProgramsV5(request, reply);
  });

  app.get('/academy/titles', async (request, reply) => {
    await getAcademyTitlesV5(request, reply);
  });

  app.get('/academy/certifications', async (request, reply) => {
    await getAcademyCertificationsV5(request, reply);
  });

  app.get('/dom/cycle/current', async (request, reply) => {
    await getDomCycleCurrentV5(request, reply);
  });

  app.post('/dom/sessions/:sessionId/join', async (request, reply) => {
    const params = request.params as { sessionId: string };
    await joinDomSessionV5(request, reply, { sessionId: params.sessionId });
  });

  app.post('/dom/sessions/:sessionId/execute', async (request, reply) => {
    const params = request.params as { sessionId: string };
    await executeDomSessionV5(request, reply, { sessionId: params.sessionId });
  });

  app.get('/court/cases', async (request, reply) => {
    await listCourtCasesV5(request, reply);
  });

  app.post('/court/cases/:caseId/verdict', async (request, reply) => {
    try {
      const body = parseOrThrow(courtVerdictSchemaV6, request.body ?? {});
      const params = request.params as { caseId: string };
      await verdictCourtCaseV5(request, reply, { caseId: params.caseId, ...body });
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.get('/councils', async (request, reply) => {
    await listCouncilsV5(request, reply);
  });

  app.post('/councils/:councilId/vote', async (request, reply) => {
    try {
      const body = parseOrThrow(councilVoteSchemaV6, request.body ?? {});
      const params = request.params as { councilId: string };
      await voteCouncilV5(request, reply, { councilId: params.councilId, ...body });
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.get('/mailbox', async (request, reply) => {
    try {
      const query = parseOrThrow(mailboxQuerySchemaV6, request.query ?? {});
      await getMailboxV5(request, reply, query);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.post('/mailbox/:messageId/read', async (request, reply) => {
    const params = request.params as { messageId: string };
    await markMailboxReadV5(request, reply, params.messageId);
  });

  app.get('/social/timeline', async (request, reply) => {
    try {
      const query = parseOrThrow(socialTimelineQuerySchemaV6, request.query ?? {});
      await getSocialTimelineV5(request, reply, query);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.get('/command-chain/orders', async (request, reply) => {
    try {
      const query = parseOrThrow(commandChainOrdersQuerySchemaV6, request.query ?? {});
      await listCommandChainOrdersV5(request, reply, query);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.post('/command-chain/orders', async (request, reply) => {
    try {
      const body = parseOrThrow(commandChainOrderCreateSchemaV6, request.body ?? {});
      await createCommandChainOrderV5(request, reply, body);
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.get('/command-chain/orders/:orderId', async (request, reply) => {
    const params = request.params as { orderId: string };
    await getCommandChainOrderV5(request, reply, params.orderId);
  });

  app.post('/command-chain/orders/:orderId/forward', async (request, reply) => {
    try {
      const body = parseOrThrow(commandChainOrderForwardSchemaV6, request.body ?? {});
      const params = request.params as { orderId: string };
      await forwardCommandChainOrderV5(request, reply, { orderId: params.orderId, ...body });
    } catch (error) {
      sendValidationError(reply, error);
    }
  });

  app.post('/command-chain/orders/:orderId/ack', async (request, reply) => {
    try {
      const body = parseOrThrow(commandChainOrderAckSchemaV6, request.body ?? {});
      const params = request.params as { orderId: string };
      await ackCommandChainOrderV5(request, reply, { orderId: params.orderId, ...body });
    } catch (error) {
      sendValidationError(reply, error);
    }
  });
}

