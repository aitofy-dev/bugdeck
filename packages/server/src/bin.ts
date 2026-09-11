#!/usr/bin/env node
/**
 * `bugdeck-server` — the standalone entry point.
 *
 * The only thing here that is not in `serve()` is the process: an exit code and
 * two signal handlers. Everything a library consumer would want is importable.
 */
import { serve } from './serve.js';

const started = await serve();
if (!started.ok) {
  console.error(started.message);
  process.exit(1);
}

const stop = (): void => {
  void started.value.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
