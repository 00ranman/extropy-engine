/**
 * @module service
 * Express application factory for the @extropy/ethics microservice.
 *
 * Usage (standalone):
 *   import { createApp } from './service';
 *   const app = createApp();
 *   app.listen(3000);
 *
 * Or import the router directly:
 *   import { router } from './routes';
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import { router } from './routes';
import { initDb } from './db';

export interface ServiceOptions {
  /** Mount prefix for all ethics routes. Default: '/' */
  prefix?: string;
  /** Skip DB initialisation (useful in unit tests). Default: false */
  skipDbInit?: boolean;
}

/**
 * Build and return a configured Express application.
 * Attaches JSON body parser, the ethics router, and an error handler.
 */
export function createApp(options: ServiceOptions = {}): Application {
  const { prefix = '/', skipDbInit = false } = options;
  const app = express();

  app.use(express.json());

  // Attach ethics routes under the configured prefix
  app.use(prefix, router);

  // Generic JSON error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[ethics-service]', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });

  if (!skipDbInit) {
    initDb().catch((e) =>
      console.warn('[ethics-service] DB init skipped — DATABASE_URL may not be set:', e.message)
    );
  }

  return app;
}

/**
 * Standalone entry-point: start the HTTP server.
 * Only executed when this file is run directly (not when imported as a library).
 */
if (require.main === module) {
  const PORT = parseInt(process.env.PORT ?? '4007', 10);
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[@extropy/ethics] HTTP service listening on port ${PORT}`);
  });
}
