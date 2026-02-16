import { z } from 'zod';
import { PAUSE_REASONS } from '@mls/shared/constants';

export const pauseSchema = z.object({
  reason: z.enum(PAUSE_REASONS)
});

export const resumeSchema = z.object({
  pauseToken: z.string().uuid()
});

export const trainingSchema = z.object({
  intensity: z.enum(['LOW', 'MEDIUM', 'HIGH'])
});

export const deploymentSchema = z.object({
  missionType: z.enum(['PATROL', 'SUPPORT']),
  missionDurationDays: z.coerce.number().int().min(1).max(14).default(2)
});

export const decisionChoiceSchema = z.object({
  optionId: z.string().min(1).max(24)
});

export const decisionLogQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export const militaryAcademySchema = z.object({
  tier: z.coerce.number().int().min(1).max(2).default(1),
  answers: z.array(z.coerce.number().int().min(1).max(4)).length(5).optional(),
  preferredDivision: z.string().min(2).max(64).optional()
});

export const travelSchema = z.object({
  place: z.enum(['BASE_HQ', 'BORDER_OUTPOST', 'LOGISTICS_HUB', 'TACTICAL_TOWN'])
});

export const commandActionSchema = z.object({
  action: z.enum(['PLAN_MISSION', 'ISSUE_SANCTION', 'ISSUE_PROMOTION']),
  targetNpcId: z.string().min(1).max(64).optional(),
  note: z.string().min(1).max(240).optional()
});


export const socialInteractionSchema = z.object({
  npcId: z.string().min(1).max(64),
  interaction: z.enum(['MENTOR', 'SUPPORT', 'BOND', 'DEBRIEF']),
  note: z.string().min(1).max(180).optional()
});


export const recruitmentApplySchema = z.object({
  trackId: z.string().min(2).max(64),
  answers: z.record(z.string(), z.string().max(120)).default({})
});

export const newsQuerySchema = z.object({
  type: z.enum(['DISMISSAL', 'MISSION', 'PROMOTION', 'MEDAL']).optional()
});


export const v3MissionSchema = z.object({
  missionType: z.enum(['RECON', 'COUNTER_RAID', 'BLACK_OPS', 'TRIBUNAL_SECURITY']),
  dangerTier: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EXTREME']).default('MEDIUM'),
  playerParticipates: z.boolean().default(false)
});

export const appointSecretarySchema = z.object({
  npcName: z.string().min(2).max(64)
});

export const courtReviewSchema = z.object({
  caseId: z.string().min(2).max(64),
  verdict: z.enum(['UPHOLD', 'DISMISS', 'REASSIGN'])
});


export const militaryLawVoteSchema = z.discriminatedUnion('articleKey', [
  z.object({
    articleKey: z.literal('chiefTerm'),
    optionId: z.enum(['TERM_42', 'TERM_54', 'TERM_60', 'TERM_72', 'TERM_90']),
    rationale: z.string().min(2).max(200).optional()
  }),
  z.object({
    articleKey: z.literal('cabinet'),
    optionId: z.enum(['CABINET_5', 'CABINET_6', 'CABINET_7', 'CABINET_8', 'CABINET_9']),
    rationale: z.string().min(2).max(200).optional()
  }),
  z.object({
    articleKey: z.literal('optionalPosts'),
    optionId: z.enum(['POSTS_MINIMAL', 'POSTS_BALANCED', 'POSTS_EXPEDITIONARY', 'POSTS_OVERSIGHT']),
    rationale: z.string().min(2).max(200).optional()
  })
]);



export const missionCallResponseSchema = z.object({
  participate: z.boolean()
});

export const gameTimeScaleSchema = z.object({
  scale: z.union([z.literal(1), z.literal(3)]).default(1)
});
