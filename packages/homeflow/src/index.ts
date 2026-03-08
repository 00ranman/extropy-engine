/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — HomeFlow
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  HomeFlow is an IoT-integrated smart home/building management service
 *  that measures thermodynamic entropy reduction from automation actions
 *  and mints XP through the Extropy Engine's verification loop.
 *
 *  Core formula:  XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 *
 *  Architecture:
 *    - Express HTTP server (port 4015)
 *    - PostgreSQL database (devices, households, entropy, claims)
 *    - Redis for event bus pub/sub on `extropy:events`
 *    - Shares @extropy/contracts types
 *    - Full interoperability with all 13+ ecosystem apps
 *
 *  This service:
 *    1. Manages IoT devices (thermostats, sensors, HVAC, lighting, energy monitors)
 *    2. Measures thermodynamic entropy reduction from automation actions
 *    3. Auto-generates claims to the Epistemology Engine when ΔS > 0
 *    4. Responds to SignalFlow task assignments for entropy claim validation
 *    5. Earns XP when automation loops close with verified ΔS > 0
 *    6. Tracks HomeFlow-domain reputation in THERMODYNAMIC domain
 *    7. Creates household DFAOs via Governance/DFAO Registry
 *    8. Manages seasonal automation patterns via Temporal service
 *    9. Mints energy credits and household CT via Token Economy
 *   10. Issues verifiable credentials for certified energy efficiency
 *   11. Records verification loops in the DAG substrate
 *   12. Supports cross-domain entropy aggregation with all ecosystem apps
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { EventType } from '@extropy/contracts';
import type { DomainEvent } from '@extropy/contracts';

// ── Services ────────────────────────────────────────────────────────────────
import { DatabaseService } from './services/database.service.js';
import { EventBusService } from './services/event-bus.service.js';
import { DeviceService } from './services/device.service.js';
import { EntropyService } from './services/entropy.service.js';
import { ClaimService } from './services/claim.service.js';
import { HouseholdService } from './services/household.service.js';

// ── Integrations ────────────────────────────────────────────────────────────
import { GovernanceIntegration } from './integrations/governance.integration.js';
import { TemporalIntegration } from './integrations/temporal.integration.js';
import { TokenIntegration } from './integrations/token.integration.js';
import { CredentialIntegration } from './integrations/credential.integration.js';
import { DAGIntegration } from './integrations/dag.integration.js';
import { ReputationIntegration } from './integrations/reputation.integration.js';

// ── Interop ─────────────────────────────────────────────────────────────────
import { InteropService } from './interop/interop.service.js';

// ── Routes ──────────────────────────────────────────────────────────────────
import { createDeviceRoutes } from './routes/devices.routes.js';
import { createHouseholdRoutes, createZoneRoutes } from './routes/households.routes.js';
import { createEntropyRoutes } from './routes/entropy.routes.js';
import { createIntegrationRoutes } from './routes/integrations.routes.js';
import { createInteropRoutes } from './routes/interop.routes.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PORT              = parseInt(process.env.PORT ?? '4015', 10);
const DATABASE_URL      = process.env.DATABASE_URL ?? 'postgresql://extropy:extropy_dev@localhost:5432/extropy_engine?schema=homeflow';
const REDIS_URL         = process.env.REDIS_URL ?? 'redis://localhost:6379';
const EPISTEMOLOGY_URL  = process.env.EPISTEMOLOGY_URL ?? 'http://localhost:4001';
const SIGNALFLOW_URL    = process.env.SIGNALFLOW_URL ?? 'http://localhost:4002';
const LOOP_LEDGER_URL   = process.env.LOOP_LEDGER_URL ?? 'http://localhost:4003';
const REPUTATION_URL    = process.env.REPUTATION_URL ?? 'http://localhost:4004';
const XP_MINT_URL       = process.env.XP_MINT_URL ?? 'http://localhost:4005';
const GOVERNANCE_URL    = process.env.GOVERNANCE_URL ?? 'http://localhost:4006';
const DFAO_REGISTRY_URL = process.env.DFAO_REGISTRY_URL ?? 'http://localhost:4007';
const TEMPORAL_URL      = process.env.TEMPORAL_URL ?? 'http://localhost:4008';
const TOKEN_ECONOMY_URL = process.env.TOKEN_ECONOMY_URL ?? 'http://localhost:4009';
const CREDENTIALS_URL   = process.env.CREDENTIALS_URL ?? 'http://localhost:4010';
const DAG_SUBSTRATE_URL = process.env.DAG_SUBSTRATE_URL ?? 'http://localhost:4011';

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HOMEFLOW — Extropy Engine IoT Smart Home Service');
  console.log('═══════════════════════════════════════════════════════════════');

  // ── Initialize infrastructure ──────────────────────────────────────────
  const db = new DatabaseService(DATABASE_URL);
  await db.initialize();
  console.log('[homeflow] Database initialized');

  const eventBus = new EventBusService(REDIS_URL);
  await eventBus.connect();
  console.log('[homeflow] Event bus connected');

  // ── Initialize services ────────────────────────────────────────────────
  const householdService = new HouseholdService(db, eventBus);
  const deviceService = new DeviceService(db, eventBus);
  const entropyService = new EntropyService(db, eventBus, {
    epistemologyUrl: EPISTEMOLOGY_URL,
    loopLedgerUrl: LOOP_LEDGER_URL,
  });
  const claimService = new ClaimService(db, eventBus, entropyService, {
    epistemologyUrl: EPISTEMOLOGY_URL,
    loopLedgerUrl: LOOP_LEDGER_URL,
  });

  // ── Initialize integrations ────────────────────────────────────────────
  const governance = new GovernanceIntegration(db, eventBus, {
    governanceUrl: GOVERNANCE_URL,
    dfaoRegistryUrl: DFAO_REGISTRY_URL,
  });
  const temporal = new TemporalIntegration(db, eventBus, {
    temporalUrl: TEMPORAL_URL,
  });
  const token = new TokenIntegration(db, eventBus, {
    tokenEconomyUrl: TOKEN_ECONOMY_URL,
    xpMintUrl: XP_MINT_URL,
  });
  const credential = new CredentialIntegration(db, eventBus, {
    credentialsUrl: CREDENTIALS_URL,
  });
  const dag = new DAGIntegration(db, eventBus, {
    dagSubstrateUrl: DAG_SUBSTRATE_URL,
  });
  const reputation = new ReputationIntegration(eventBus, {
    reputationUrl: REPUTATION_URL,
  });

  // ── Initialize interop ────────────────────────────────────────────────
  const interopService = new InteropService(db, eventBus, entropyService);
  console.log('[homeflow] Interop service initialized with', interopService.listAdapters().length, 'adapters');

  // ── Subscribe to core events ──────────────────────────────────────────

  // When a task is assigned to HomeFlow by SignalFlow
  eventBus.on(EventType.TASK_ASSIGNED, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;
    // Only handle tasks routed to homeflow-domain validators
    if (payload.targetService === 'homeflow' || payload.domain === 'thermodynamic') {
      await claimService.handleValidationTask(
        payload.taskId as string,
        payload.claimId as string ?? '',
        event.correlationId,
        event.source as string,
        (payload.domain as string) ?? 'thermodynamic',
      );
    }
  });

  // When a loop closes — check if it's one of ours and earn XP
  eventBus.on(EventType.LOOP_CLOSED, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;
    const loopId = event.correlationId;
    const deltaS = payload.deltaS as number;

    // Check if this loop belongs to a HomeFlow claim
    const { rows } = await db.query(
      'SELECT * FROM hf_claims WHERE loop_id = $1',
      [loopId],
    );

    if (rows.length > 0 && deltaS > 0) {
      const claim = rows[0];
      console.log(`[homeflow] Loop ${loopId} closed with ΔS=${deltaS} — earning XP`);

      // Update local claim status
      await claimService.updateClaimStatus(claim.claim_id, 'verified');

      // Get household info
      const household = await householdService.getHousehold(claim.household_id);
      if (household) {
        // Mint energy credits
        await token.mintEnergyCredits(household.id, household.validatorId, deltaS, loopId);

        // Issue household CT
        await token.issueHouseholdCT(
          household.id,
          household.validatorId,
          `Loop closed: ΔS=${deltaS.toFixed(4)} J/K`,
          Math.floor(deltaS * 10),
        );

        // Report reputation
        await reputation.reportSuccess(household.validatorId, loopId, deltaS);

        // Check for credential upgrades
        const cumDeltaS = await entropyService.getCumulativeDeltaS(household.id);
        await credential.checkAndIssueCredentials(household.id, household.validatorId, cumDeltaS);

        // Record in DAG
        await dag.recordVertex(
          household.id,
          'loop_close',
          { loopId, deltaS, claimId: claim.claim_id },
          loopId,
          'loop',
          household.dfaoId ?? undefined,
        );
      }
    }
  });

  // When XP is provisionally minted — update local tracking
  eventBus.on(EventType.XP_MINTED_PROVISIONAL, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;
    const mintEvent = payload.mintEvent as Record<string, unknown>;
    if (mintEvent) {
      const loopId = mintEvent.loopId as string;
      const xpValue = mintEvent.xpValue as number;
      const { rows } = await db.query('SELECT claim_id FROM hf_claims WHERE loop_id = $1', [loopId]);
      if (rows.length > 0) {
        await claimService.updateClaimStatus(rows[0].claim_id, 'xp_minted', xpValue);
        console.log(`[homeflow] XP minted for loop ${loopId}: ${xpValue}`);
      }
    }
  });

  // Season events — adjust automation schedules
  eventBus.on(EventType.SEASON_STARTED, async (event: DomainEvent) => {
    console.log(`[homeflow] New season started — adjusting automation baselines`);
  });

  eventBus.on(EventType.SEASON_ENDED, async (event: DomainEvent) => {
    console.log(`[homeflow] Season ended — archiving entropy data`);
  });

  // Reputation events
  eventBus.on(EventType.REPUTATION_ACCRUED, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;
    if (payload.domain === 'thermodynamic') {
      console.log(`[homeflow] Reputation accrued for ${payload.validatorId}: +${payload.delta}`);
    }
  });

  // Register for Temporal season events
  await temporal.registerForSeasonEvents();

  // ── Create Express app ────────────────────────────────────────────────
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[homeflow] ${req.method} ${req.path}`);
    next();
  });

  // ── Health check ──────────────────────────────────────────────────────
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await db.query('SELECT 1');
      res.json({
        service: 'homeflow',
        status: 'healthy',
        version: '1.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        port: PORT,
        adapters: interopService.listAdapters().length,
      });
    } catch (err) {
      res.status(503).json({
        service: 'homeflow',
        status: 'unhealthy',
        error: String(err),
      });
    }
  });

  // ── Mount interop webhook at root (before API prefix) ─────────────────
  const interopRouter = createInteropRoutes(interopService);
  app.use('/', interopRouter); // mounts /events at root

  // ── Mount API routes ──────────────────────────────────────────────────
  app.use('/api/v1/households', createHouseholdRoutes(householdService));
  app.use('/api/v1/zones', createZoneRoutes(householdService));
  app.use('/api/v1/devices', createDeviceRoutes(deviceService));
  app.use('/api/v1/entropy', createEntropyRoutes(entropyService, claimService));
  app.use('/api/v1', createIntegrationRoutes({
    governance, temporal, token, credential, dag, reputation,
  }));
  app.use('/api/v1', interopRouter); // also mounts /api/v1/interop/*

  // ── Global error handler ──────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[homeflow] Error:', err.message);
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  });

  // ── Start server ──────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`[homeflow] Listening on port ${PORT}`);
    console.log(`[homeflow] Health: http://localhost:${PORT}/health`);
    console.log(`[homeflow] Events webhook: http://localhost:${PORT}/events`);
    console.log(`[homeflow] API: http://localhost:${PORT}/api/v1`);
    console.log(`[homeflow] Interop manifest: http://localhost:${PORT}/api/v1/interop/manifest`);
    console.log('═══════════════════════════════════════════════════════════════');
  });
}

main().catch(err => {
  console.error('[homeflow] Fatal startup error:', err);
  process.exit(1);
});
