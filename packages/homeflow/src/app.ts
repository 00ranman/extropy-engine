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
import { createIdentityRoutes, GenesisAnchor, type DAGAnchor } from './routes/identity.routes.js';
import { createPSLLRoutes } from './routes/psll.routes.js';
import { createDeviceRoutes } from './routes/devices.routes.js';
import { createHouseholdRoutes, createZoneRoutes } from './routes/households.routes.js';
import { createEntropyRoutes } from './routes/entropy.routes.js';
import { createIntegrationRoutes } from './routes/integrations.routes.js';
import { createInteropRoutes } from './routes/interop.routes.js';
import { createTemporalEventRoute } from './routes/temporal.routes.js';
import { createFamilyRoutes } from './routes/family.routes.js';
import type { FamilyStore } from './services/family-store.service.js';

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
  /** Optional family pilot file-backed store. When provided, /api/family is mounted. */
  familyStore?: FamilyStore;
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
  /** Base URL of the temporal service. Used to proxy /now-public from the UI. */
  temporalUrl?: string;
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

  app.use(
    express.json({
      limit: '10mb',
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
      secret: deps.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: !!deps.secureCookies,
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

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
      res.status(503).json({
        service: 'homeflow',
        status: 'unhealthy',
        error: String(err),
      });
    }
  });

  app.use('/auth', createAuthRoutes(deps.userService, deps.authConfig));

  const dagAnchor: DAGAnchor =
    deps.dagAnchor ??
    new GenesisAnchor(
      process.env.DAG_SUBSTRATE_URL ?? 'http://localhost:4011',
      (text, params) => deps.db.query(text, params as unknown[]),
    );

  app.use('/', createTemporalEventRoute(deps.integrations.temporal, deps.temporalHmacSecret, deps.temporalUrl));

  app.use('/api/v1/identity', createIdentityRoutes(deps.userService, dagAnchor));
  app.use('/api/v1/psll', createPSLLRoutes(deps.userService, deps.psllService));

  const interopRouter = createInteropRoutes(deps.interopService);
  app.use('/', interopRouter);
  app.use('/api/v1/households', createHouseholdRoutes(deps.householdService));
  app.use('/api/v1/zones', createZoneRoutes(deps.householdService));
  app.use('/api/v1/devices', createDeviceRoutes(deps.deviceService));
  app.use('/api/v1/entropy', createEntropyRoutes(deps.entropyService, deps.claimService));
  app.use(
    '/api/v1',
    createIntegrationRoutes({
      governance: deps.integrations.governance,
      temporal: deps.integrations.temporal,
      token: deps.integrations.token,
      credential: deps.integrations.credential,
      dag: deps.integrations.dag,
      reputation: deps.integrations.reputation,
    }),
  );
  app.use('/api/v1', interopRouter);

  if (deps.familyStore) {
    app.use('/api/family', createFamilyRoutes(deps.userService, deps.familyStore));
  }

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

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[homeflow] Error:', err.message);
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
