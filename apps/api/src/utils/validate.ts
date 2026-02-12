import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod';

export function parseOrThrow<T>(schema: ZodSchema<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const error = new Error('Validation failed');
    (error as Error & { statusCode?: number; details?: unknown }).statusCode = 400;
    (error as Error & { statusCode?: number; details?: unknown }).details = parsed.error.flatten();
    throw error;
  }

  return parsed.data;
}

export function sendValidationError(reply: FastifyReply, err: unknown): void {
  const candidate = err as { statusCode?: number; details?: unknown; message?: string };
  if (candidate?.statusCode === 400) {
    reply.code(400).send({ error: candidate.message ?? 'Validation failed', details: candidate.details ?? null });
    return;
  }

  reply.code(500).send({ error: 'Internal server error' });
}

export async function ensureAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.auth) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}
