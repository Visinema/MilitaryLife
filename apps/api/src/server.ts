import { buildApp } from './app.js';

const app = await buildApp();

try {
  await app.listen({
    host: app.env.API_HOST,
    port: app.env.API_PORT
  });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
