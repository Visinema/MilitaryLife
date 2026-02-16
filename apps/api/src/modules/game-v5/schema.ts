import { z } from 'zod';

export const sessionStartSchema = z.object({
  resetWorld: z.boolean().optional().default(false)
});

export const sessionHeartbeatSchema = z.object({
  sessionTtlMs: z.coerce.number().int().min(5_000).max(180_000).optional().default(30_000)
});

export const sessionSyncQuerySchema = z.object({
  sinceVersion: z.coerce.number().int().min(0).optional()
});

export const npcListQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'INJURED', 'KIA', 'RESERVE', 'RECRUITING']).optional(),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(120).optional().default(20)
});

export const missionPlanSchemaV5 = z.object({
  missionType: z.enum(['RECON', 'COUNTER_RAID', 'BLACK_OPS', 'TRIBUNAL_SECURITY']),
  dangerTier: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EXTREME']),
  strategy: z.string().min(3).max(120),
  objective: z.string().min(3).max(160),
  prepChecklist: z.array(z.string().min(2).max(80)).max(10).default([]),
  participantNpcIds: z.array(z.string().min(3).max(96)).max(20).optional().default([])
});

export const missionExecuteSchemaV5 = z.object({
  missionId: z.string().min(4).max(120),
  playerParticipates: z.boolean().optional().default(false)
});

export const academyEnrollSchemaV5 = z.object({
  enrolleeType: z.enum(['PLAYER', 'NPC']),
  npcId: z.string().min(3).max(96).optional(),
  track: z.enum(['OFFICER', 'HIGH_COMMAND', 'SPECIALIST', 'TRIBUNAL', 'CYBER']),
  tier: z.coerce.number().int().min(1).max(3)
});

export const certificationExamSchemaV5 = z.object({
  holderType: z.enum(['PLAYER', 'NPC']),
  npcId: z.string().min(3).max(96).optional(),
  certCode: z.string().min(2).max(96),
  score: z.coerce.number().int().min(0).max(100)
});

export const academyBatchStartSchemaV51 = z.object({
  track: z.enum(['OFFICER', 'HIGH_COMMAND', 'SPECIALIST', 'TRIBUNAL', 'CYBER']).default('OFFICER'),
  tier: z.coerce.number().int().min(1).max(3).default(1)
});

export const academyBatchSubmitDaySchemaV51 = z.object({
  answers: z.array(z.coerce.number().int().min(1).max(4)).length(3)
});

export const recruitmentBoardQuerySchemaV51 = z.object({
  division: z.string().min(2).max(96).optional()
});

export const recruitmentApplySchemaV51 = z.object({
  division: z.string().min(2).max(96),
  answers: z.array(z.coerce.number().int().min(1).max(4)).length(3)
});

export const divisionApplicationRegisterSchemaV6 = z.object({
  division: z.string().min(2).max(96)
});

export const divisionApplicationTryoutSchemaV6 = z.object({
  answers: z.array(z.coerce.number().int().min(1).max(4)).length(3)
});

export const domSessionActionSchemaV6 = z.object({
  sessionId: z.string().min(4).max(128)
});

export const courtVerdictSchemaV6 = z.object({
  verdict: z.enum(['UPHOLD', 'DISMISS', 'REASSIGN']),
  note: z.string().max(500).optional(),
  newDivision: z.string().min(2).max(96).optional(),
  newPosition: z.string().min(2).max(96).optional()
});

export const councilVoteSchemaV6 = z.object({
  voteChoice: z.enum(['APPROVE', 'REJECT', 'ABSTAIN']),
  rationale: z.string().max(500).optional()
});

export const mailboxQuerySchemaV6 = z.object({
  unreadOnly: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(200).optional().default(40)
});

export const socialTimelineQuerySchemaV6 = z.object({
  actorType: z.enum(['PLAYER', 'NPC']).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional().default(120)
});

export const commandChainOrderCreateSchemaV6 = z.object({
  targetNpcId: z.string().min(3).max(128).optional(),
  targetDivision: z.string().min(2).max(96).optional(),
  message: z.string().min(3).max(600),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional().default('MEDIUM'),
  ackWindowDays: z.coerce.number().int().min(1).max(7).optional().default(2),
  chainPathNpcIds: z.array(z.string().min(3).max(128)).max(12).optional().default([])
});

export const commandChainOrderForwardSchemaV6 = z.object({
  actorNpcId: z.string().min(3).max(128).optional(),
  forwardedToNpcId: z.string().min(3).max(128),
  note: z.string().max(600).optional()
});

export const commandChainOrderAckSchemaV6 = z.object({
  actorNpcId: z.string().min(3).max(128).optional(),
  note: z.string().max(600).optional()
});

export const commandChainOrdersQuerySchemaV6 = z.object({
  status: z.enum(['PENDING', 'FORWARDED', 'ACKNOWLEDGED', 'BREACHED', 'EXPIRED']).optional(),
  limit: z.coerce.number().int().min(1).max(250).optional().default(80)
});
