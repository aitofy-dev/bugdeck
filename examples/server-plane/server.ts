/**
 * The whole standalone server, as a file you can read in one breath.
 *
 * `serve()` reads the environment, resolves your Plane board's columns, opens
 * the SQLite store and listens. A bad environment comes back as a VALUE — it
 * lists what is missing and exits 1, rather than discovering it on the first
 * report.
 *
 *   cp .env.example .env && pnpm start
 *
 * `npx @bugdeck/server` does exactly this and nothing more. Write the file only
 * when you want to wrap it: a health check next to it, your own logger, a
 * process manager that wants the port back.
 */
import { serve } from '@bugdeck/server';

const started = await serve();
if (!started.ok) {
  console.error(started.message);
  process.exit(1);
}

console.log(`bugdeck on http://localhost:${started.value.port}`);
console.log('plane columns:', started.value.states);

const stop = (): void => {
  void started.value.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
