import type { FastifyInstance } from 'fastify';
import compress from '@fastify/compress';

export async function compressPlugin(app: FastifyInstance): Promise<void> {
  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate']
  });
}
