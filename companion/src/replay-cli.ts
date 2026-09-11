import 'dotenv/config';
import { runReplayCli } from './replay/cli.js';

const exitCode = await runReplayCli(process.argv.slice(2));
process.exitCode = exitCode;
