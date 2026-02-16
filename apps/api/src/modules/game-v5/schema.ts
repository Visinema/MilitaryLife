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
  limit: z.coerce.number().int().min(1).max(80).optional().default(20)
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
