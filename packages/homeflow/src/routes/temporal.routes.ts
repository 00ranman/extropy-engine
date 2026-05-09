/*
 * HomeFlow temporal callback route.
 *
 * Receives HTTP POST callbacks from the Universal Times service
 * (@extropy/temporal-service) on Season transitions. When a shared
 * HMAC secret is configured the request must carry an
 * X-Temporal-Signature header with sha256=<hex> matching the body.
 *
 * The raw request body is captured by the verify hook on the global
 * express.json() parser in app.ts.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { TemporalIntegration } from '../integrations/temporal.integration.js';

export function createTemporalEventRoute(
  temporal: TemporalIntegration,
  hmacSecret: string | undefined,
): Router {
  const router = Router();

  router.post(
    '/temporal/event',
    async (req: Request & { rawBody?: Buffer }, res: Response, next: NextFunction) => {
      try {
        if (hmacSecret) {
          const got = req.header('X-Temporal-Signature') ?? '';
          if (!req.rawBody || !got.startsWith('sha256=')) {
            res.status(401).json({ error: 'missing or malformed signature' });
            return;
          }
          const expected =
            'sha256=' + createHmac('sha256', hmacSecret).update(req.rawBody).digest('hex');
          const a = Buffer.from(got);
          const b = Buffer.from(expected);
          if (a.length !== b.length || !timingSafeEqual(a, b)) {
            res.status(401).json({ error: 'invalid signature' });
            return;
          }
        }
        const body = req.body as {
          unit?: string;
          oldValue?: number;
          newValue?: number;
          timestamp?: string;
        };
        if (!body || typeof body.unit !== 'string') {
          res.status(400).json({ error: 'unit required' });
          return;
        }
        await temporal.handleTemporalEvent({
          unit: body.unit,
          oldValue: body.oldValue ?? 0,
          newValue: body.newValue ?? 0,
          ...(body.timestamp ? { timestamp: body.timestamp } : {}),
        });
        res.status(200).json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
