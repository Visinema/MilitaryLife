import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

export async function cookiePlugin(app: FastifyInstance): Promise<void> {
  await app.register(cookie, {
    secret: app.env.COOKIE_SECRET,
    hook: 'onRequest'
  });
}
