/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Interoperability Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  - POST /events — standardized webhook for incoming events from any service
 *  - GET /api/v1/interop/manifest — auto-discovery manifest
 *  - GET /api/v1/interop/adapters — list registered adapters
 *  - POST /api/v1/interop/adapters — register a new adapter at runtime
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { InteropService } from '../interop/interop.service.js';
import type { IncomingWebhookEvent } from '../types/index.js';
import type { EntropyDomain } from '@extropy/contracts';

export function createInteropRoutes(interopService: InteropService): Router {
  const router = Router();

  // POST /events — standardized webhook endpoint
  // This is mounted at the app root, not under /api/v1
  router.post('/events', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const event = req.body as IncomingWebhookEvent;
      if (!event.eventId || !event.type || !event.source) {
        res.status(400).json({ error: 'Invalid event: missing eventId, type, or source' });
        return;
      }

      const result = await interopService.handleIncomingEvent(event);
      res.json({
        received: true,
        processed: result.processed,
        crossDomainData: result.crossDomainData ?? null,
        aggregation: result.aggregation ?? null,
      });
    } catch (err) { next(err); }
  });

  // GET /api/v1/interop/manifest — auto-discovery
  router.get('/interop/manifest', (_req: Request, res: Response) => {
    const manifest = interopService.getInteropManifest();
    res.json(manifest);
  });

  // GET /api/v1/interop/adapters — list registered adapters
  router.get('/interop/adapters', (_req: Request, res: Response) => {
    const adapters = interopService.listAdapters().map(a => ({
      appId: a.appId,
      appName: a.appName,
      entropyDomains: a.entropyDomains,
      publishedEvents: a.publishedEvents,
      subscribedEvents: a.subscribedEvents,
    }));
    res.json({ data: adapters, total: adapters.length });
  });

  // POST /api/v1/interop/adapters — register new adapter at runtime
  router.post('/interop/adapters', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { appId, appName, entropyDomains, publishedEvents, subscribedEvents } = req.body as {
        appId: string;
        appName: string;
        entropyDomains: EntropyDomain[];
        publishedEvents: string[];
        subscribedEvents: string[];
      };

      if (!appId || !appName) {
        res.status(400).json({ error: 'Missing required fields: appId, appName' });
        return;
      }

      // Dynamic import to avoid circular deps — use generic adapter
      const { GenericAppAdapter } = require('../interop/interop.service.js') as any;

      // We don't actually export GenericAppAdapter — so we create an inline adapter
      const adapter = {
        appId,
        appName,
        entropyDomains: entropyDomains ?? [],
        publishedEvents: publishedEvents ?? [],
        subscribedEvents: subscribedEvents ?? [],
        async handleEvent(event: any) {
          const payload = event.payload ?? {};
          if (typeof payload.deltaS === 'number' && payload.deltaS > 0) {
            return {
              sourceApp: appId,
              sourceDomain: payload.domain ?? entropyDomains?.[0] ?? 'informational',
              sourceDeltaS: payload.deltaS,
              timestamp: event.timestamp,
              metadata: payload,
            };
          }
          return null;
        },
      };

      interopService.registerAdapter(adapter as any);
      res.status(201).json({ appId, appName, registered: true });
    } catch (err) { next(err); }
  });

  // GET /api/v1/interop/aggregations?householdId=
  router.get('/interop/aggregations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { householdId } = req.query as { householdId: string };
      if (!householdId) { res.status(400).json({ error: 'Query param householdId required' }); return; }
      const history = await interopService.getAggregationHistory(householdId);
      res.json({ data: history, total: history.length });
    } catch (err) { next(err); }
  });

  return router;
}
