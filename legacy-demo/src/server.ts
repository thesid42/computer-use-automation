import { buildApp } from './app.js';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '3001');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be an integer between 1 and 65535; received ${process.env.PORT ?? '3001'}`);
}

const app = await buildApp();

try {
  await app.listen({ host, port });
  app.log.info(`legacy-demo listening at http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
