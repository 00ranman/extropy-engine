/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Interoperability Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Split into two routers so privileged management endpoints are never exposed on
 *  the unauthenticated root mount:
 *
 *    createInteropIngressRoutes  mounted at /  (service-to-service ingress)
 *      - POST /events            standardized inbound webhook
 *
 *    createInteropRoutes         mounted at /api/v1 behind requireSession
 *      - GET  /interop/manifest
 *      - GET  /interop/adapters
 *      - POST /interop/adapters       runtime adapter registration (privileged)
 *      - GET  /interop/aggregations?householdId=
 *
 *  Previously a single router was mounted at both / and /api/v1, which left
 *  adapter registration and reads reachable without authentication.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { InteropService } from '../interop/interop.service.js';
import type { HouseholdService } from '../services/household.service.js';
import type { IncomingWebhookEvent } from '../types/index.js';
import type { EntropyDomain } from '@extropy/contracts';
import type { AuthedRequest } from '../auth/auth.middleware.js';
import { requireHouseholdAccess } from '../auth/ownership.middleware.js';

/**
 * Public ingress router mounted at the app root. The /events webhook is a
 * service-to-service entry point. When INTEROP_INGRESS_SECRET is set, callers
 * must present it via the X-Interop-Secret header. The secret is required in
 * production; see app.ts startup guard.
 */
export function createInteropIngressRoutes(interopService: InteropService): Router {
  const router = Router();
  const ingressSecret = process.env.INTEROP_INGRESS_SECRET;

  router.post('/events', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (ingressSecret) {
        const got = req.header('X-Interop-Secret') ?? '';
        if (got !== ingressSecret) {
          res.status(401).json({ error: 'invalid ingress secret' });
          return;
        }
      }
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

  return router;
}

export function createInteropRoutes(
  interopService: InteropService,
  householdService: HouseholdService,
): Router {
  const router = Router();

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

      // Inline generic adapter. GenericAppAdapter is not exported, so we build a
      // minimal adapter that forwards positive deltaS as cross-domain data.
      const adapter = {
        appId,
        appName,
        entropyDomains: entropyDomains ?? [],
        publishedEvents: publishedEvents ?? [],
        subscribedEvents: subscribedEvents ?? [],
        async handleEvent(event: { payload?: Record<string, unknown>; timestamp?: unknown }) {
          const payload = event.payload ?? {};
          if (typeof payload.deltaS === 'number' && payload.deltaS > 0) {
            return {
              sourceApp: appId,
              sourceDomain: (payload.domain as string) ?? entropyDomains?.[0] ?? 'informational',
              sourceDeltaS: payload.deltaS,
              timestamp: event.timestamp,
              metadata: payload,
            };
          }
          return null;
        },
      };

      interopService.registerAdapter(adapter as never);
      res.status(201).json({ appId, appName, registered: true });
    } catch (err) { next(err); }
  });

  // GET /api/v1/interop/aggregations?householdId=
  router.get(
    '/interop/aggregations',
    requireHouseholdAccess(householdService, { from: 'query', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const { householdId } = req.query as { householdId: string };
        const history = await interopService.getAggregationHistory(householdId);
        res.json({ data: history, total: history.length });
      } catch (err) { next(err); }
    },
  );

  return router;
}
