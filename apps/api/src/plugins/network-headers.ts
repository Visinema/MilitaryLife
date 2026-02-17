import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const ALT_SVC_VALUE = 'h3=":443"; ma=86400';
const PERFORMANCE_HEADERS = {
  'x-dns-prefetch-control': 'on',
  'x-content-type-options': 'nosniff',
  vary: 'Accept-Encoding, Origin'
} as const;

function applyHeaders(reply: FastifyReply): void {
  for (const [key, value] of Object.entries(PERFORMANCE_HEADERS)) {
    reply.header(key, value);
  }

  if (!reply.hasHeader('alt-svc')) {
    reply.header('alt-svc', ALT_SVC_VALUE);
  }
}

export async function networkHeadersPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (_request: FastifyRequest, reply: FastifyReply) => {
    applyHeaders(reply);
  });
}
