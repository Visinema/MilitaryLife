import type { FastifyInstance } from 'fastify';

function shortSha(input: string | undefined): string | null {
  const value = input?.trim();
  if (!value) return null;
  return value.slice(0, 7);
}

function resolveVersion(): string {
  const run = process.env.GITHUB_RUN_NUMBER?.trim();
  if (run && /^\d+$/.test(run)) {
    return `5.0.${run}`;
  }

  const commit = shortSha(process.env.VERCEL_GIT_COMMIT_SHA) ?? shortSha(process.env.GIT_COMMIT_SHA);
  if (commit) {
    return `5.0.${commit}`;
  }

  const timestamp = process.env.VERCEL_GIT_COMMIT_TIMESTAMP?.trim();
  if (timestamp && /^\d+$/.test(timestamp)) {
    return `5.0.${timestamp}`;
  }

  return `5.0.${Math.floor(Date.now() / 1000)}`;
}

export async function metaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/build', async (_request, reply) => {
    reply.code(200).send({
      version: resolveVersion(),
      commitShaShort: shortSha(process.env.VERCEL_GIT_COMMIT_SHA) ?? shortSha(process.env.GIT_COMMIT_SHA),
      builtAt: process.env.BUILD_TIME_ISO ?? new Date().toISOString()
    });
  });
}

