import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email().max(120),
  password: z.string().min(8).max(72)
});

export const loginSchema = registerSchema;
