/**
 * @package api-gateway
 * Extropy Engine — Unified API Gateway
 *
 * Single entry point for the dashboard.
 * Reverse-proxies and aggregates all monorepo microservices.
 *
 * The legacy external master-control-hub has been retired; orchestration and
 * aggregation now live in packages/ecosystem.
 *
 * Security posture:
 *   - CORS restricted to an explicit origin allowlist (GATEWAY_ALLOWED_ORIGINS).
 *   - Proxied /api/:service routes sit behind a bearer-token auth gate
 *     (GATEWAY_AUTH_TOKEN). /health, /api/status, and the static dashboard
 *     remain public.
 *   - helmet + a global rate limiter on every request.
 *
 * Gateway listens on :3000.
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { Socket } from 'net';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';

const IS_PROD = process.env.NODE_ENV === 'production';
const app: Express = express();
const PORT = process.env.PORT ?? 3000;

// ── CORS allowlist ────────────────────────────────────────────────────────────
// Comma-separated origins. Required in production; localhost fallback in dev.
const ALLOWED_ORIGINS = (process.env.GATEWAY_ALLOWED_ORIGINS
  || (IS_PROD ? '' : 'http://localhost:3000'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (IS_PROD && ALLOWED_ORIGINS.length === 0) {
  throw new Error('GATEWAY_ALLOWED_ORIGINS must be set in production.');
}

// ── Auth gate token ───────────────────────────────────────────────────────────
const AUTH_TOKEN = process.env.GATEWAY_AUTH_TOKEN || '';
if (IS_PROD && !AUTH_TOKEN) {
  throw new Error('GATEWAY_AUTH_TOKEN must be set in production.');
}

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  }),
);
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  }),
);
app.use(express.json({ limit: '1mb' }));

// ── Service registry ──────────────────────────────────────────────────────────
// Ports align with docker-compose.yml. Keep this map in sync with that file.
const SERVICES: Record<string, string> = {
  homeflow: process.env.HOMEFLOW_URL ?? 'http://localhost:4015',
  'xp-mint': process.env.XP_MINT_URL ?? 'http://localhost:4005',
  signalflow: process.env.SIGNALFLOW_URL ?? 'http://localhost:4002',
  'dag-substrate': process.env.DAG_SUBSTRATE_URL ?? 'http://localhost:4008',
  credentials: process.env.CREDENTIALS_URL ?? 'http://localhost:4013',
  ecosystem: process.env.ECOSYSTEM_URL ?? 'http://localhost:4014',
  governance: process.env.GOVERNANCE_URL ?? 'http://localhost:4010',
  reputation: process.env.REPUTATION_URL ?? 'http://localhost:4004',
  'token-economy': process.env.TOKEN_ECONOMY_URL ?? 'http://localhost:4012',
  temporal: process.env.TEMPORAL_URL ?? 'http://localhost:4011',
  'epistemology-engine': process.env.EPISTEMOLOGY_URL ?? 'http://localhost:4001',
  'loop-ledger': process.env.LOOP_LEDGER_URL ?? 'http://localhost:4003',
  'dfao-registry': process.env.DFAO_REGISTRY_URL ?? 'http://localhost:4009',
};

// ── Public endpoints ──────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', gateway: 'extropy-api-gateway', services: Object.keys(SERVICES) });
});

// Service status aggregation for the dashboard (no upstream data, safe to expose).
app.get('/api/status', async (_req: Request, res: Response) => {
  const statuses = await Promise.allSettled(
    Object.entries(SERVICES).map(async ([name, url]) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const r = await fetch(`${url}/health`, { signal: controller.signal });
        clearTimeout(timeout);
        return { name, status: r.ok ? 'healthy' : 'degraded', url };
      } catch {
        return { name, status: 'unreachable', url };
      }
    }),
  );
  res.json(statuses.map((s) => (s.status === 'fulfilled' ? s.value : { name: 'unknown', status: 'error' })));
});

// ── Auth gate for proxied service traffic ─────────────────────────────────────
// Constant-time-ish bearer check. Applied to every /api/:service/* route below.
function requireGatewayAuth(req: Request, res: Response, next: NextFunction): void {
  // If no token configured (dev convenience only, never in prod), allow through.
  if (!AUTH_TOKEN) {
    if (IS_PROD) {
      res.status(500).json({ error: 'gateway_misconfigured' });
      return;
    }
    next();
    return;
  }
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (provided && provided === AUTH_TOKEN) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}

// ── Dynamic proxy routes: /api/:service/* → service ───────────────────────────
for (const [name, target] of Object.entries(SERVICES)) {
  app.use(
    `/api/${name}`,
    requireGatewayAuth,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: { [`^/api/${name}`]: '' },
      on: {
        error: (err: Error, _req: Request, res: Response | Socket) => {
          console.error(`[API Gateway] proxy error for ${name}:`, err);
          // res can be a raw socket for upgrade requests; only respond on HTTP responses.
          if ('status' in res && typeof res.status === 'function') {
            res.status(502).json({ error: 'gateway_error', service: name });
          } else {
            res.destroy();
          }
        },
      },
    }),
  );
}

// ── Static dashboard ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../../dashboard')));
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../dashboard/index.html'));
});

app.listen(PORT, () => {
  console.log(`[API Gateway] Listening on http://localhost:${PORT}`);
  console.log(`[API Gateway] Dashboard: http://localhost:${PORT}/`);
  console.log(`[API Gateway] Services: ${Object.keys(SERVICES).join(', ')}`);
});

export default app;
