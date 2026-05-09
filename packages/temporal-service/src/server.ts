/*
 * Universal Times service bootstrap. Reads env, opens the file-backed
 * store, starts the clock loop, mounts the Express app, and listens.
 */

import { createApp } from './app.js';
import { TemporalClock } from './clock.js';
import { TemporalStore, resolveDataDir } from './store.js';

const PORT = parseInt(process.env.TEMPORAL_PORT ?? '4002', 10);
const ADMIN_TOKEN = process.env.TEMPORAL_ADMIN_TOKEN ?? '';
const VERSION = process.env.TEMPORAL_VERSION ?? '0.1.0';

async function main(): Promise<void> {
  console.log('===============================================================');
  console.log('  TEMPORAL, Extropy Engine Universal Times service');
  console.log('===============================================================');

  const dataDir = resolveDataDir();
  const store = new TemporalStore({ dataDir });
  store.load();
  console.log(`[temporal] store at ${store.path}, ${store.listSubscribers().length} subscribers loaded`);

  const clock = new TemporalClock({ store });
  clock.start();

  const app = createApp({
    store,
    clock,
    ...(ADMIN_TOKEN ? { adminToken: ADMIN_TOKEN } : {}),
    version: VERSION,
  });

  const server = app.listen(PORT, () => {
    console.log(`[temporal] listening on port ${PORT}`);
    console.log(`[temporal] /now /health /subscribe /subscribers`);
  });

  const shutdown = (signal: string) => {
    console.log(`[temporal] ${signal} received, shutting down`);
    clock.stop();
    server.close(() => {
      void store.flush().then(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.env.TEMPORAL_NO_LISTEN !== '1') {
  main().catch((err) => {
    console.error('[temporal] fatal startup error:', err);
    process.exit(1);
  });
}
