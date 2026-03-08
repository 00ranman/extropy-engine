/**
 * @package api-gateway
 * Extropy Engine — Unified API Gateway
 *
 * Single entry point for the dashboard and master-control-hub.
 * Reverse-proxies and aggregates all monorepo microservices:
 *
 * Service Port Map:
 *   homeflow       → :4000
 *   xp-mint        → :4001
 *   signalflow     → :4002
 *   dag-substrate  → :4003
 *   credentials    → :4004
 *   ecosystem      → :4005
 *   governance     → :4006
 *   reputation     → :4007
 *   token-economy  → :4008
 *   temporal       → :4009
 *   contracts      → :4010
 *
 * Gateway listens on :3000
 * Dashboard served at /
 * master-control-hub connected via /hub/*
 */

import express, { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import path from 'path';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

// Service registry
const SERVICES: Record<string, string> = {
  homeflow: process.env.HOMEFLOW_URL ?? 'http://localhost:4000',
  'xp-mint': process.env.XP_MINT_URL ?? 'http://localhost:4001',
  signalflow: process.env.SIGNALFLOW_URL ?? 'http://localhost:4002',
  'dag-substrate': process.env.DAG_SUBSTRATE_URL ?? 'http://localhost:4003',
  credentials: process.env.CREDENTIALS_URL ?? 'http://localhost:4004',
  ecosystem: process.env.ECOSYSTEM_URL ?? 'http://localhost:4005',
  governance: process.env.GOVERNANCE_URL ?? 'http://localhost:4006',
  reputation: process.env.REPUTATION_URL ?? 'http://localhost:4007',
  'token-economy': process.env.TOKEN_ECONOMY_URL ?? 'http://localhost:4008',
  temporal: process.env.TEMPORAL_URL ?? 'http://localhost:4009',
  contracts: process.env.CONTRACTS_URL ?? 'http://localhost:4010',
  // master-control-hub (Python Flask, external)
  hub: process.env.MASTER_CONTROL_HUB_URL ?? 'http://localhost:5000',
};

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', gateway: 'extropy-api-gateway', services: Object.keys(SERVICES) });
});

// Service status aggregation for the dashboard
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
    })
  );
  res.json(statuses.map((s) => (s.status === 'fulfilled' ? s.value : { name: 'unknown', status: 'error' })));
});

// Dynamic proxy routes: /api/:service/* → service
for (const [name, target] of Object.entries(SERVICES)) {
  app.use(
    `/api/${name}`,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathRewrite: { [`^/api/${name}`]: '' },
      on: {
        error: (err: Error, _req: Request, res: Response) => {
          (res as Response).status(502).json({ error: `Gateway error for ${name}: ${err.message}` });
        },
      },
    })
  );
}

// Serve the dashboard static files
app.use(express.static(path.join(__dirname, '../../dashboard')));
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../dashboard/index.html'));
});

app.listen(PORT, () => {
  console.log(`[API Gateway] Listening on http://localhost:${PORT}`);
  console.log(`[API Gateway] Dashboard: http://localhost:${PORT}/`);
  console.log(`[API Gateway] master-control-hub: http://localhost:${PORT}/api/hub/`);
  console.log(`[API Gateway] Services: ${Object.keys(SERVICES).join(', ')}`);
});

export default app;
