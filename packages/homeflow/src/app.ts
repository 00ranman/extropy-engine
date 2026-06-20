/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow, Express App Factory
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Splits the express app construction out of the bootstrap so integration
 *  tests can mount it against an in memory or test database without spawning
 *  the full service. The bootstrap in src/index.ts wires real infrastructure
 *  and calls createApp once everything is connected.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import path from 'node:path';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import session from 'express-session';
import passport from 'passport';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import type { DatabaseService } from './services/database.service.js';
import type { UserService } from './services/user.service.js';
import type { PSLLService } from './services/psll.service.js';
import type { HouseholdService } from './services/household.service.js';
import type { DeviceService } from './services/device.service.js';
import type { EntropyService } from './services/entropy.service.js';
import type { ClaimService } from './services/claim.service.js';
import type { GovernanceIntegration } from './integrations/governance.integration.js';
import type { TemporalIntegration } from './integrations/temporal.integration.js';
import type { TokenIntegration } from './integrations/token.integration.js';
import type { CredentialIntegration } from './integrations/credential.integration.js';
import type { DAGIntegration } from './integrations/dag.integration.js';
import type { ReputationIntegration } from './integrations/reputation.integration.js';
import type { InteropService } from './interop/interop.service.js';

import { createAuthRoutes, type AuthConfig } from './auth/auth.routes.js';
import { requireSession } from './auth/auth.middleware.js';
import { createIdentityRoutes, GenesisAnchor, type DAGAnchor } from './routes/identity.routes.js';
import { createPSLLRoutes } from './routes/psll.routes.js';
import { createDeviceRoutes } from './routes/devices.routes.js';
import { createHouseholdRoutes, createZoneRoutes } from './routes/households.routes.js';
import { createEntropyRoutes } from './routes/entropy.routes.js';
import { createIntegrationRoutes } from './routes/integrations.routes.js';
import { createInteropRoutes, createInteropIngressRoutes } from './routes/interop.routes.js';
import { createTemporalEventRoute } from './routes/temporal.routes.js';

export interface AppDeps {
  db: DatabaseService;
  userService: UserService;
  psllService: PSLLService;
  householdService: HouseholdService;
  deviceService: DeviceService;
  entropyService: EntropyService;
  claimService: ClaimService;
  integrations: {
    governance: GovernanceIntegration;
    temporal: TemporalIntegration;
    token: TokenIntegration;
    credential: CredentialIntegration;
    dag: DAGIntegration;
    reputation: ReputationIntegration;
  };
  interopService: InteropService;
  authConfig: AuthConfig;
  sessionSecret: string;
  /** Optional override, primarily for tests. */
  dagAnchor?: DAGAnchor;
  /** Absolute path to the static frontend directory. Omit to skip mounting. */
  staticFrontendDir?: string | null;
  /** When true, set cookie.secure on the session cookie. */
  secureCookies?: boolean;
  /** Optional HMAC secret shared with the temporal service for callback verification. */
  temporalHmacSecret?: string;
}

/**
 * Locate the frontend directory relative to the homeflow package root.
 * Works whether the service runs from src (tsx dev mode) or from dist (prod).
 * The HOMEFLOW_FRONTEND_DIR env var overrides for Docker / custom layouts.
 */
export function defaultStaticFrontendDir(): string {
  if (process.env.HOMEFLOW_FRONTEND_DIR) {
    return process.env.HOMEFLOW_FRONTEND_DIR;
  }
  // packages/homeflow/{src,dist}/app.{ts,js}, walk up to repo root.
  return path.resolve(__dirname, '..', '..', '..', 'frontends', 'homeflow-ui');
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  // Trust the first proxy hop so secure cookies and client IP based rate
  // limiting work correctly behind Cloudflare Tunnel / a reverse proxy.
  app.set('trust proxy', 1);

  // Baseline security headers (clickjacking, MIME sniffing, etc.). CSP is left
  // off here because the PWA frontend is served from the same origin and a
  // tight policy needs per-asset tuning; enable it deliberately later.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Global rate limit. Generous enough for a family pilot, low enough to blunt
  // brute force and abuse. Tighter limits are applied to auth and to the
  // write-heavy entropy and schedule surfaces below.
  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  app.use(globalLimiter);

  app.use(
    express.json({
      limit: '1mb',
      // Capture raw body so HMAC verification on /temporal/event can
      // recompute the signature byte-for-byte over the original payload.
      verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
  );

  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[homeflow] ${req.method} ${req.path}`);
    }
    next();
  });

  app.use(
    session({
      name: 'hf.sid',
      secret: deps.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true, // refresh the cookie maxAge on activity
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        // In production always require HTTPS for the session cookie. The
        // secureCookies flag can still force it on in other environments.
        secure: deps.secureCookies || process.env.NODE_ENV === 'production',
        // Shorter lifetime than the previous 30 days narrows the window if a
        // cookie leaks. rolling:true keeps active users signed in.
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  // Stricter limiter for authentication endpoints.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await deps.db.query('SELECT 1');
      res.json({
        service: 'homeflow',
        status: 'healthy',
        version: '1.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        adapters: deps.interopService.listAdapters().length,
      });
    } catch (err) {
      // Log detail server side; do not leak DB/connection errors to callers.
      console.error('[homeflow] health check failed:', err);
      res.status(503).json({
        service: 'homeflow',
        status: 'unhealthy',
      });
    }
  });

  app.use('/auth', authLimiter, createAuthRoutes(deps.userService, deps.authConfig));

  const dagAnchor: DAGAnchor =
    deps.dagAnchor ??
    new GenesisAnchor(
      process.env.DAG_SUBSTRATE_URL ?? 'http://localhost:4011',
      (text, params) => deps.db.query(text, params as unknown[]),
    );

  app.use('/', createTemporalEventRoute(deps.integrations.temporal, deps.temporalHmacSecret));

  app.use('/api/v1/identity', createIdentityRoutes(deps.userService, dagAnchor));
  app.use('/api/v1/psll', createPSLLRoutes(deps.userService, deps.psllService));

  // Every remaining /api/v1 surface requires an authenticated session. The
  // route factories below additionally enforce per-household ownership so a
  // signed-in user cannot read or mutate another family's data.
  const auth = requireSession(deps.userService);

  // Public service-to-service ingress (no session). Secret-gated in production.
  app.use('/', createInteropIngressRoutes(deps.interopService));

  // Authenticated interop management surface.
  const interopRouter = createInteropRoutes(deps.interopService, deps.householdService);
  app.use(
    '/api/v1/households',
    auth,
    createHouseholdRoutes(deps.householdService),
  );
  app.use(
    '/api/v1/zones',
    auth,
    createZoneRoutes(deps.householdService),
  );
  app.use(
    '/api/v1/devices',
    auth,
    createDeviceRoutes(deps.deviceService, deps.householdService),
  );
  app.use(
    '/api/v1/entropy',
    auth,
    createEntropyRoutes(deps.entropyService, deps.claimService, deps.householdService),
  );
  app.use(
    '/api/v1',
    auth,
    createIntegrationRoutes({
      governance: deps.integrations.governance,
      temporal: deps.integrations.temporal,
      token: deps.integrations.token,
      credential: deps.integrations.credential,
      dag: deps.integrations.dag,
      reputation: deps.integrations.reputation,
      householdService: deps.householdService,
    }),
  );
  app.use('/api/v1', auth, interopRouter);

  if (deps.staticFrontendDir !== null && deps.staticFrontendDir !== undefined) {
    const frontendDir = deps.staticFrontendDir;
    // Explicit MIME type for the PWA manifest. express.static does not
    // recognize .webmanifest by default and will fall back to octet-stream,
    // which iOS and Chrome reject when registering the manifest.
    app.get('/manifest.webmanifest', (_req: Request, res: Response) => {
      res.type('application/manifest+json');
      res.sendFile(path.join(frontendDir, 'manifest.webmanifest'));
    });
    app.use(express.static(frontendDir, { index: 'index.html' }));
    app.get('/', (_req: Request, res: Response) => {
      res.sendFile(path.join(frontendDir, 'index.html'));
    });
  }

  // Centralized error handler. Logs the full error server side, returns a
  // generic message to the client so internal details (DB errors, hostnames,
  // stack-derived text) are never leaked.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[homeflow] Error:', err);
    res.status(500).json({
      error: 'internal_error',
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
