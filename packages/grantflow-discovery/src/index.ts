/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — GrantFlow Discovery
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  GrantFlow Discovery is the autonomous grant intelligence service of the
 *  Extropy Engine. It continuously discovers relevant grant opportunities from
 *  Grants.gov, matches them against researcher profiles, and manages the full
 *  application submission pipeline.
 *
 *  Core entropy formula:  XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 *
 *  Architecture:
 *    - Express HTTP server (port 4020)
 *    - PostgreSQL database (gf_profiles, gf_opportunities, gf_matches, gf_submissions)
 *    - Redis for event bus pub/sub on `extropy:events`
 *    - Shares @extropy/contracts types
 *    - Full interoperability with all Extropy Engine ecosystem services
 *
 *  This service:
 *    1. Schedules periodic Grants.gov REST API searches (every 6 hours)
 *    2. Matches discovered grants against researcher profiles
 *    3. Auto-generates claims to the Epistemology Engine when grants are found
 *    4. Tracks submission pipeline from discovery → submitted → awarded/declined
 *    5. Prepares S2S XML packages for Grants.gov SOAP submission
 *    6. Earns XP when loops close with verified ΔS > 0
 *    7. Responds to SignalFlow task assignments for INFORMATIONAL/ECONOMIC domains
 *    8. Pre-populates Randall Gossett's researcher profile at startup
 *
 *  XP Events (each opens a verification loop):
 *    - grantflow.grant.discovered     → INFORMATIONAL domain, ΔS ≈ 0.42
 *    - grantflow.grant.matched        → INFORMATIONAL domain, ΔS ≈ 0.28
 *    - grantflow.submission.prepared  → ECONOMIC domain,      ΔS ≈ 0.65
 *    - grantflow.submission.submitted → ECONOMIC domain,      ΔS ≈ 1.20
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { EventType } from '@extropy/contracts';
import type { DomainEvent } from '@extropy/contracts';

// ── Services ─────────────────────────────────────────────────────────────────
import { DatabaseService }  from './services/database.service.js';
import { EventBusService }  from './services/event-bus.service.js';
import { GrantsGovService } from './services/grants-gov.service.js';
import { ProfileService }   from './services/profile.service.js';
import { MatchingService }  from './services/matching.service.js';
import { SubmissionService } from './services/submission.service.js';
import { ClaimService }     from './services/claim.service.js';
import { SchedulerService } from './services/scheduler.service.js';

// ── Routes ───────────────────────────────────────────────────────────────────
import { createProfileRoutes }     from './routes/profiles.routes.js';
import { createOpportunityRoutes, createMatchesRoutes } from './routes/opportunities.routes.js';
import { createSubmissionRoutes }  from './routes/submissions.routes.js';
import { createSchedulerRoutes }   from './routes/scheduler.routes.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PORT                 = parseInt(process.env['PORT'] ?? '4020', 10);
const DATABASE_URL         = process.env['DATABASE_URL']
  ?? 'postgresql://extropy:extropy_dev@localhost:5432/extropy_engine?schema=grantflow_discovery';
const REDIS_URL            = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// Extropy Engine service URLs
const EPISTEMOLOGY_URL     = process.env['EPISTEMOLOGY_URL']     ?? 'http://localhost:4001';
const SIGNALFLOW_URL       = process.env['SIGNALFLOW_URL']       ?? 'http://localhost:4002';
const LOOP_LEDGER_URL      = process.env['LOOP_LEDGER_URL']      ?? 'http://localhost:4003';
const REPUTATION_URL       = process.env['REPUTATION_URL']       ?? 'http://localhost:4004';
const XP_MINT_URL          = process.env['XP_MINT_URL']          ?? 'http://localhost:4005';
const GOVERNANCE_URL       = process.env['GOVERNANCE_URL']        ?? 'http://localhost:4006';
const DFAO_REGISTRY_URL    = process.env['DFAO_REGISTRY_URL']    ?? 'http://localhost:4007';
const TEMPORAL_URL         = process.env['TEMPORAL_URL']         ?? 'http://localhost:4008';
const TOKEN_ECONOMY_URL    = process.env['TOKEN_ECONOMY_URL']    ?? 'http://localhost:4009';
const CREDENTIALS_URL      = process.env['CREDENTIALS_URL']      ?? 'http://localhost:4010';
const DAG_SUBSTRATE_URL    = process.env['DAG_SUBSTRATE_URL']    ?? 'http://localhost:4011';
const GRANTFLOW_PROPOSER_URL = process.env['GRANTFLOW_PROPOSER_URL'] ?? 'http://localhost:4021';

/** The Extropy Engine validator ID associated with this service */
const VALIDATOR_ID = process.env['VALIDATOR_ID'] ?? 'grantflow-discovery-v1';

/** Discovery scheduler interval (ms). Default: 6 hours */
const DISCOVERY_INTERVAL_MS = parseInt(
  process.env['DISCOVERY_INTERVAL_MS'] ?? String(6 * 60 * 60 * 1_000),
  10,
);

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  GRANTFLOW DISCOVERY — Extropy Engine Autonomous Grant Service');
  console.log('═══════════════════════════════════════════════════════════════');

  // ── Initialize infrastructure ─────────────────────────────────────────────
  const db = new DatabaseService(DATABASE_URL);
  await db.initialize();
  console.log('[grantflow-discovery] Database initialized');

  const eventBus = new EventBusService(REDIS_URL);
  await eventBus.connect();
  console.log('[grantflow-discovery] Event bus connected');

  // ── Initialize services ───────────────────────────────────────────────────
  const grantsGovService  = new GrantsGovService(db);
  const profileService    = new ProfileService(db);
  const matchingService   = new MatchingService(db);
  const submissionService = new SubmissionService(db, GRANTFLOW_PROPOSER_URL);
  const claimService      = new ClaimService(db, eventBus, {
    epistemologyUrl: EPISTEMOLOGY_URL,
    loopLedgerUrl:   LOOP_LEDGER_URL,
    validatorId:     VALIDATOR_ID,
  });
  const schedulerService = new SchedulerService(
    db,
    grantsGovService,
    profileService,
    matchingService,
    claimService,
    DISCOVERY_INTERVAL_MS,
  );

  console.log('[grantflow-discovery] All services initialized');

  // ── Seed default researcher profile ──────────────────────────────────────
  const defaultProfile = await profileService.ensureDefaultProfile();
  console.log(
    `[grantflow-discovery] Default profile ready — id=${defaultProfile.id} name="${defaultProfile.name}"`,
  );

  // ── Subscribe to core events ──────────────────────────────────────────────

  /**
   * TASK_ASSIGNED — Handle tasks routed to GrantFlow by SignalFlow.
   * Handles INFORMATIONAL and ECONOMIC domain tasks.
   */
  eventBus.on(EventType.TASK_ASSIGNED, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;
    const targetService = payload.targetService as string | undefined;
    const domain        = payload.domain as string | undefined;

    if (
      targetService === 'grantflow-discovery' ||
      domain === 'informational' ||
      domain === 'economic'
    ) {
      console.log(
        `[grantflow-discovery] Task assigned — taskId=${payload.taskId} domain=${domain}`,
      );

      // Acknowledge task and run matching if a profile/opportunity is referenced
      const opportunityId = payload.opportunityId as string | undefined;
      const profileId     = payload.profileId as string | undefined;

      if (opportunityId && profileId) {
        try {
          const opp     = await grantsGovService.getOpportunity(opportunityId);
          const profile = await profileService.getProfile(profileId);

          if (opp && profile) {
            const match = await matchingService.matchOpportunityToProfile(opp, profile);
            if (match) {
              await claimService.emitMatchClaim(match);
            }
          }
        } catch (err) {
          console.error('[grantflow-discovery] Task handling error:', err);
        }
      }
    }
  });

  /**
   * LOOP_CLOSED — Update local claim status and handle XP.
   */
  eventBus.on(EventType.LOOP_CLOSED, async (event: DomainEvent) => {
    await claimService.handleLoopClosed(event);

    const payload = event.payload as Record<string, unknown>;
    const deltaS  = payload.deltaS as number ?? 0;
    const loopId  = event.correlationId;

    if (deltaS > 0) {
      console.log(
        `[grantflow-discovery] Loop ${loopId} closed with ΔS=${deltaS}`,
      );
    }
  });

  /**
   * XP_MINTED_PROVISIONAL — Record XP mint against the claim.
   */
  eventBus.on(EventType.XP_MINTED_PROVISIONAL, async (event: DomainEvent) => {
    await claimService.handleXpMinted(event);
  });

  // ── Start the discovery scheduler ─────────────────────────────────────────
  schedulerService.start();
  console.log('[grantflow-discovery] Discovery scheduler started');

  // ── Create Express app ────────────────────────────────────────────────────
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[grantflow-discovery] ${req.method} ${req.path}`);
    next();
  });

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await db.query('SELECT 1');

      res.json({
        service:    'grantflow-discovery',
        status:     'healthy',
        version:    '1.0.0',
        uptime:     process.uptime(),
        timestamp:  new Date().toISOString(),
        port:       PORT,
        scheduler: {
          active:    schedulerService.isActive(),
          lastRunAt: schedulerService.getLastRunAt(),
          nextRunAt: schedulerService.getNextRunAt(),
        },
        services: {
          epistemologyUrl:      EPISTEMOLOGY_URL,
          signalflowUrl:        SIGNALFLOW_URL,
          loopLedgerUrl:        LOOP_LEDGER_URL,
          grantflowProposerUrl: GRANTFLOW_PROPOSER_URL,
        },
      });
    } catch (err) {
      res.status(503).json({
        service: 'grantflow-discovery',
        status:  'unhealthy',
        error:   String(err),
      });
    }
  });

  // ── Mount API routes ──────────────────────────────────────────────────────

  // Profiles
  app.use('/api/v1/profiles', createProfileRoutes(profileService));

  // Opportunities + Matches
  app.use(
    '/api/v1/opportunities',
    createOpportunityRoutes(grantsGovService, matchingService, profileService),
  );
  app.use('/api/v1/matches', createMatchesRoutes(matchingService));

  // Submissions
  app.use(
    '/api/v1/submissions',
    createSubmissionRoutes(submissionService, grantsGovService, claimService),
  );

  // Search + Scheduler
  app.use('/api/v1/search', createSchedulerRoutes(schedulerService, grantsGovService));
  app.use('/api/v1/search-runs', async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET') {
      try {
        const limit = Math.min(parseInt(req.query['limit'] as string ?? '20', 10), 100);
        const runs  = await schedulerService.getSearchHistory(isNaN(limit) ? 20 : limit);
        res.json({ runs, count: runs.length });
      } catch (err) { next(err); }
    } else {
      next();
    }
  });
  app.use('/api/v1/scheduler', createSchedulerRoutes(schedulerService, grantsGovService));

  // ── Interop events webhook ────────────────────────────────────────────────
  app.post('/events', async (req: Request, res: Response) => {
    try {
      const event = req.body as DomainEvent;

      if (!event?.type) {
        res.status(400).json({ error: 'Invalid event payload' });
        return;
      }

      // Route to appropriate handler
      switch (event.type) {
        case EventType.LOOP_CLOSED:
          await claimService.handleLoopClosed(event);
          break;
        case EventType.XP_MINTED_PROVISIONAL:
          await claimService.handleXpMinted(event);
          break;
        default:
          break;
      }

      res.json({ received: true, eventType: event.type, timestamp: new Date().toISOString() });
    } catch (err) {
      console.error('[grantflow-discovery] Webhook error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Service info endpoint ─────────────────────────────────────────────────
  app.get('/api/v1/info', (_req: Request, res: Response) => {
    res.json({
      service:      'grantflow-discovery',
      version:      '1.0.0',
      port:         PORT,
      entropyDomains: ['informational', 'economic'],
      endpoints: [
        'GET  /health',
        'POST /events',
        'GET  /api/v1/info',
        'POST /api/v1/profiles',
        'GET  /api/v1/profiles',
        'GET  /api/v1/profiles/:id',
        'PATCH /api/v1/profiles/:id',
        'DELETE /api/v1/profiles/:id',
        'GET  /api/v1/opportunities',
        'GET  /api/v1/opportunities/:id',
        'POST /api/v1/opportunities/:id/match',
        'GET  /api/v1/matches',
        'GET  /api/v1/matches/top/:profileId',
        'POST /api/v1/submissions',
        'GET  /api/v1/submissions',
        'GET  /api/v1/submissions/:id',
        'PATCH /api/v1/submissions/:id',
        'POST /api/v1/submissions/:id/prepare',
        'POST /api/v1/submissions/:id/propose',
        'POST /api/v1/submissions/:id/submit',
        'POST /api/v1/search',
        'GET  /api/v1/search-runs',
        'GET  /api/v1/scheduler/status',
        'POST /api/v1/scheduler/run',
        'POST /api/v1/scheduler/start',
        'POST /api/v1/scheduler/stop',
      ],
      externalDependencies: {
        grantsGovRest: 'https://api.grants.gov/v2',
        grantsGovSoap: 'https://apply07.grants.gov/grantsws/services/v2/ApplicantWebServicesSoapPort',
      },
    });
  });

  // ── Global error handler ──────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[grantflow-discovery] Error:', err.message);
    res.status(500).json({
      error:     err.message,
      code:      'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  });

  // ── Start server ──────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`[grantflow-discovery] Listening on port ${PORT}`);
    console.log(`[grantflow-discovery] Health:    http://localhost:${PORT}/health`);
    console.log(`[grantflow-discovery] Events:    http://localhost:${PORT}/events`);
    console.log(`[grantflow-discovery] API:       http://localhost:${PORT}/api/v1`);
    console.log(`[grantflow-discovery] Info:      http://localhost:${PORT}/api/v1/info`);
    console.log('═══════════════════════════════════════════════════════════════');
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[grantflow-discovery] SIGTERM received — shutting down gracefully');
    schedulerService.stop();
    await eventBus.disconnect();
    await db.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[grantflow-discovery] SIGINT received — shutting down gracefully');
    schedulerService.stop();
    await eventBus.disconnect();
    await db.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[grantflow-discovery] Fatal startup error:', err);
  process.exit(1);
});
