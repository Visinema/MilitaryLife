import { z } from 'zod';
import { BRANCHES, COUNTRIES } from '@mls/shared/constants';

export const createProfileSchema = z
  .object({
    name: z.string().min(2).max(48),
    startAge: z.number().int().min(15).max(40).default(17),
    country: z.enum(COUNTRIES),
    branch: z.enum(BRANCHES)
  })
  .superRefine((value, ctx) => {
    const valid =
      value.country === 'US' && (value.branch === 'US_ARMY' || value.branch === 'US_NAVY');

    if (!valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Branch does not match selected country',
        path: ['branch']
      });
    }
  });
