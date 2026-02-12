import type { FastifyReply, FastifyRequest } from 'fastify';
import { generateToken, hashPassword, sha256, verifyPassword } from '../../utils/crypto.js';
import {
  createSession,
  createUser,
  deleteSessionByTokenHash,
  deleteSessionsByUserId,
  findSessionByTokenHash,
  findUserByEmail,
  findUserById,
  touchSession
} from './repo.js';

export interface SessionPrincipal {
  sid: string;
  sessionId: string;
  userId: string;
  email: string;
  profileId: string | null;
  expiresAt: string;
}

function getCookieOptions(isProd: boolean, expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd,
    path: '/',
    expires: expiresAt
  };
}

function buildSessionExpiry(days: number): Date {
  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  return expires;
}

export async function attachAuth(request: FastifyRequest): Promise<void> {
  const sid = request.cookies.sid;
  if (!sid) {
    request.auth = null;
    return;
  }

  const tokenHash = sha256(sid);
  const session = await findSessionByTokenHash(request.server.db, tokenHash);
  if (!session) {
    request.auth = null;
    return;
  }

  await touchSession(request.server.db, session.session_id);

  request.auth = {
    sid,
    sessionId: session.session_id,
    userId: session.user_id,
    email: session.email,
    profileId: session.profile_id,
    expiresAt: session.expires_at
  };
}

export async function registerUser(request: FastifyRequest, reply: FastifyReply, email: string, password: string) {
  const existing = await findUserByEmail(request.server.db, email);
  if (existing) {
    reply.code(409).send({ error: 'Email already registered' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const userId = await createUser(request.server.db, email, passwordHash);

  await deleteSessionsByUserId(request.server.db, userId);
  const sid = generateToken();
  const tokenHash = sha256(sid);
  const expiresAt = buildSessionExpiry(request.server.env.SESSION_DAYS);
  await createSession(request.server.db, userId, tokenHash, expiresAt.toISOString());

  reply.setCookie('sid', sid, getCookieOptions(request.server.env.NODE_ENV === 'production', expiresAt));
  reply.code(201).send({ userId, email, profileId: null });
}

export async function loginUser(request: FastifyRequest, reply: FastifyReply, email: string, password: string) {
  const user = await findUserByEmail(request.server.db, email);
  if (!user) {
    reply.code(401).send({ error: 'Invalid credentials' });
    return;
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    reply.code(401).send({ error: 'Invalid credentials' });
    return;
  }

  await deleteSessionsByUserId(request.server.db, user.id);

  const sid = generateToken();
  const tokenHash = sha256(sid);
  const expiresAt = buildSessionExpiry(request.server.env.SESSION_DAYS);
  await createSession(request.server.db, user.id, tokenHash, expiresAt.toISOString());

  const profile = await findSessionByTokenHash(request.server.db, tokenHash);

  reply.setCookie('sid', sid, getCookieOptions(request.server.env.NODE_ENV === 'production', expiresAt));
  reply.code(200).send({ userId: user.id, email: user.email, profileId: profile?.profile_id ?? null });
}

export async function logoutUser(request: FastifyRequest, reply: FastifyReply) {
  const sid = request.cookies.sid;
  if (sid) {
    await deleteSessionByTokenHash(request.server.db, sha256(sid));
  }

  reply.clearCookie('sid', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: request.server.env.NODE_ENV === 'production'
  });
  reply.code(204).send();
}

export async function getMe(request: FastifyRequest, reply: FastifyReply) {
  if (!request.auth) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const user = await findUserById(request.server.db, request.auth.userId);
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  reply.code(200).send({ userId: user.id, email: user.email, profileId: request.auth.profileId });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await attachAuth(request);
  if (!request.auth) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}
