import 'dotenv/config';
import { createCompanion } from './app/server.js';

const port = Number(process.env.PORT ?? '3000');
const host = process.env.HOST ?? '127.0.0.1';
const app = await createCompanion({ offline: process.env.OFFLINE_DEMO === '1' });
await app.listen({ port, host });
console.log(`Automation Companion listening at http://${host}:${port}`);
console.log(`Target application: ${process.env.TARGET_URL ?? 'http://localhost:3001'}`);
if (process.env.OFFLINE_DEMO === '1') console.log('Offline scripted demo enabled; no LLM or browser is used.');
