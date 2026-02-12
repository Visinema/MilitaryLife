import { z } from 'zod';

export const eventPoolQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
