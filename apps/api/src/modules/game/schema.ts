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
  preferredDivision: z.enum(['INFANTRY', 'INTEL', 'LOGISTICS', 'CYBER']).optional()
});

export const travelSchema = z.object({
  place: z.enum(['BASE_HQ', 'BORDER_OUTPOST', 'LOGISTICS_HUB', 'TACTICAL_TOWN'])
});
