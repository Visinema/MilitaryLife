import type { FastifyInstance } from 'fastify';
import { parseOrThrow, sendValidationError } from '../../utils/validate.js';
import { loginSchema, registerSchema } from './schema.js';
import { attachAuth, getMe, loginUser, logoutUser, registerUser } from './service.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', async (request, reply) => {
    try {
      const body = parseOrThrow(registerSchema, request.body);
      await registerUser(request, reply, body.email, body.password);
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.post('/login', async (request, reply) => {
    try {
      const body = parseOrThrow(loginSchema, request.body);
      await loginUser(request, reply, body.email, body.password);
    } catch (err) {
      sendValidationError(reply, err);
    }
  });

  app.post('/logout', async (request, reply) => {
    await logoutUser(request, reply);
  });

  app.get('/me', async (request, reply) => {
    await attachAuth(request);
    await getMe(request, reply);
  });
}
