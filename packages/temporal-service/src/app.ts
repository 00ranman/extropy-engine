/*
 * Express app factory for the Universal Times service. The factory
 * returns the Express instance plus the clock object so tests can drive
 * tick() directly without spinning real timers.
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { isValidUnit, nowSnapshot, type AnyUnitName } from './universaltimes.js';
import { TemporalClock } from './clock.js';
import type { Subscriber, TemporalStore } from './store.js';

export interface AppOptions {
  store: TemporalStore;
  clock: TemporalClock;
  adminToken?: string;
  version?: string;
}

const startedAt = Date.now();

export function createApp(opts: AppOptions): Express {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'temporal',
      version: opts.version ?? '0.1.0',
      uptime: (Date.now() - startedAt) / 1000,
      subscribers: opts.store.listSubscribers().length,
      retryQueue: opts.store.listRetryQueue().length,
    });
  });

  app.get('/now', (req: Request, res: Response) => {
    const at = req.query.at ? new Date(String(req.query.at)) : new Date();
    if (isNaN(at.getTime())) {
      return res.status(400).json({ error: 'invalid at parameter, expect ISO timestamp' });
    }
    return res.json(nowSnapshot(at));
  });

  app.post('/subscribe', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const subscriberId = typeof body.subscriberId === 'string' ? body.subscriberId : '';
    const callbackUrl = typeof body.callbackUrl === 'string' ? body.callbackUrl : '';
    const unitRaw = typeof body.unit === 'string' ? body.unit : '';
    const hmacSecret = typeof body.hmacSecret === 'string' ? body.hmacSecret : undefined;

    if (!subscriberId) return res.status(400).json({ error: 'subscriberId required' });
    if (!callbackUrl) return res.status(400).json({ error: 'callbackUrl required' });
    if (!isValidUnit(unitRaw)) {
      return res.status(400).json({ error: `invalid unit, expect one of: GQ Wave Tide Spin Current Season Orbit Cycle Epoch Era Age Eon Loop Arc Tick` });
    }
    try {
      // Reject obviously broken URLs early.
      // eslint-disable-next-line no-new
      new URL(callbackUrl);
    } catch {
      return res.status(400).json({ error: 'callbackUrl is not a valid URL' });
    }

    /*
     * Idempotency: if a subscription with the same (subscriberId, unit,
     * callbackUrl) already exists, return the existing id instead of
     * creating a duplicate. HomeFlow restarts call /subscribe on every
     * boot and we do not want to leak rows.
     */
    const existing = opts.store
      .listSubscribers()
      .find(
        (s) =>
          s.subscriberId === subscriberId &&
          s.unit === (unitRaw as AnyUnitName) &&
          s.callbackUrl === callbackUrl,
      );
    if (existing) {
      return res.status(200).json({ subscriptionId: existing.id, deduplicated: true });
    }

    const sub: Subscriber = {
      id: uuidv4(),
      subscriberId,
      callbackUrl,
      unit: unitRaw as AnyUnitName,
      ...(hmacSecret ? { hmacSecret } : {}),
      createdAt: new Date().toISOString(),
    };
    await opts.store.addSubscriber(sub);
    opts.clock.primeLastFired();
    return res.status(201).json({ subscriptionId: sub.id });
  });

  app.delete('/subscribe/:id', async (req: Request, res: Response) => {
    const ok = await opts.store.removeSubscriber(req.params.id);
    return res.status(ok ? 204 : 404).end();
  });

  app.get('/subscribers', (_req: Request, res: Response) => {
    res.json({ subscribers: opts.store.listSubscribers() });
  });

  app.post('/transition/:unit/test', async (req: Request, res: Response) => {
    if (opts.adminToken) {
      const got = req.header('X-Admin-Token');
      if (got !== opts.adminToken) {
        return res.status(401).json({ error: 'admin token required' });
      }
    }
    const unit = req.params.unit;
    if (!isValidUnit(unit)) {
      return res.status(400).json({ error: 'invalid unit' });
    }
    const fired = await opts.clock.fireUnitNow(unit);
    return res.json({ unit, fired });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[temporal] error:', err.message);
    res.status(500).json({ error: err.message });
  });

  return app;
}
