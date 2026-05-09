/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE, HomeFlow service bootstrap
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  HomeFlow is an IoT integrated smart home / building management service that
 *  measures thermodynamic entropy reduction from automation actions and mints
 *  XP through the Extropy Engine's verification loop.
 *
 *  Family Pilot additions (May 2026):
 *    1. Google OAuth login (passport-google-oauth20)
 *    2. Real did:extropy DID generation in the browser, registered server side
 *    3. Per user PSLL with Ed25519 signed entries and chain integrity
 *    4. The cyberpunk frontend is served as static files from this same port
 *  See FAMILY_PILOT.md for end user setup.
 *
 *  Core formula:  XP = R * F * deltaS * (w . E) * log(1/Ts)
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { EventType } from '@extropy/contracts';
import type { DomainEvent } from '@extropy/contracts';

import { DatabaseService } from './services/database.service.js';
import { FileBackedDb, resolveDataDir } from './services/file-db.service.js';
import { EventBusService } from './services/event-bus.service.js';
import { DeviceService } from './services/device.service.js';
import { EntropyService } from './services/entropy.service.js';
import { ClaimService } from './services/claim.service.js';
import { HouseholdService } from './services/household.service.js';
import { UserService } from './services/user.service.js';
import { PSLLService } from './services/psll.service.js';

import { GovernanceIntegration } from './integrations/governance.integration.js';
import { TemporalIntegration } from './integrations/temporal.integration.js';
import { TokenIntegration } from './integrations/token.integration.js';
import { CredentialIntegration } from './integrations/credential.integration.js';
import { DAGIntegration } from './integrations/dag.integration.js';
import { ReputationIntegration } from './integrations/reputation.integration.js';

import { InteropService } from './interop/interop.service.js';

import { createApp, defaultStaticFrontendDir } from './app.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PORT              = parseInt(process.env.PORT ?? '4015', 10);
// DATABASE_URL is now optional. When unset/empty the service runs with a
// file-backed JSON store (see services/file-db.service.ts). Set it to a real
// Postgres connection string to graduate the family pilot to Postgres mode.
const DATABASE_URL      = process.env.DATABASE_URL ?? '';
const REDIS_URL         = process.env.REDIS_URL ?? 'redis://localhost:6379';
const EPISTEMOLOGY_URL  = process.env.EPISTEMOLOGY_URL ?? 'http://localhost:4001';
const SIGNALFLOW_URL    = process.env.SIGNALFLOW_URL ?? 'http://localhost:4002';
const LOOP_LEDGER_URL   = process.env.LOOP_LEDGER_URL ?? 'http://localhost:4003';
const REPUTATION_URL    = process.env.REPUTATION_URL ?? 'http://localhost:4004';
const XP_MINT_URL       = process.env.XP_MINT_URL ?? 'http://localhost:4005';
const GOVERNANCE_URL    = process.env.GOVERNANCE_URL ?? 'http://localhost:4006';
const DFAO_REGISTRY_URL = process.env.DFAO_REGISTRY_URL ?? 'http://localhost:4007';
const TEMPORAL_URL      = process.env.TEMPORAL_URL ?? 'http://127.0.0.1:4002';
const TEMPORAL_HMAC_SECRET = process.env.TEMPORAL_HMAC_SECRET ?? '';
const TOKEN_ECONOMY_URL = process.env.TOKEN_ECONOMY_URL ?? 'http://localhost:4009';
const CREDENTIALS_URL   = process.env.CREDENTIALS_URL ?? 'http://localhost:4010';
const DAG_SUBSTRATE_URL = process.env.DAG_SUBSTRATE_URL ?? 'http://localhost:4011';
const BASE_URL          = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const SESSION_SECRET    = process.env.SESSION_SECRET ?? 'homeflow-dev-only-change-me';

// Note: SIGNALFLOW_URL is read for parity with the other service configs.
void SIGNALFLOW_URL;

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HOMEFLOW, Extropy Engine IoT Smart Home Service');
  console.log('═══════════════════════════════════════════════════════════════');

  // Storage adapter: real Postgres when DATABASE_URL is set, otherwise a
  // file-backed JSON store. See services/file-db.service.ts for the rationale
  // (Family Pilot only needs users + PSLL anchors; spec section 3 keeps truth
  // on the user device).
  let db: DatabaseService;
  if (DATABASE_URL && DATABASE_URL.trim().length > 0) {
    db = new DatabaseService(DATABASE_URL);
    await db.initialize();
    console.log('[homeflow] Database initialized (Postgres mode)');
  } else {
    const dataDir = resolveDataDir();
    const fileDb = new FileBackedDb({ dataDir });
    await fileDb.initialize();
    console.log(`[homeflow] Using file-backed store at ${fileDb.path}`);
    db = fileDb as unknown as DatabaseService;
  }

  const eventBus = new EventBusService(REDIS_URL);
  await eventBus.connect();
  console.log('[homeflow] Event bus connected');

  const userService = new UserService(db);
  await userService.ensureSchema();
  const psllService = new PSLLService(db);
  await psllService.ensureSchema();
  console.log('[homeflow] User and PSLL schemas ready');

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

  const governance = new GovernanceIntegration(db, eventBus, {
    governanceUrl: GOVERNANCE_URL,
    dfaoRegistryUrl: DFAO_REGISTRY_URL,
  });
  const temporal = new TemporalIntegration(db, eventBus, {
    temporalUrl: TEMPORAL_URL,
    callbackUrl: `${BASE_URL.replace(/\/$/, '')}/temporal/event`,
    ...(TEMPORAL_HMAC_SECRET ? { hmacSecret: TEMPORAL_HMAC_SECRET } : {}),
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

  const interopService = new InteropService(db, eventBus, entropyService);
  console.log('[homeflow] Interop service initialized with', interopService.listAdapters().length, 'adapters');

  // ── Subscribe to core events ──────────────────────────────────────────

  eventBus.on(EventType.TASK_ASSIGNED, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;
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

  eventBus.on(EventType.LOOP_CLOSED, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;
    const loopId = event.correlationId;
    const deltaS = payload.deltaS as number;

    const { rows } = await db.query(
      'SELECT * FROM hf_claims WHERE loop_id = $1',
      [loopId],
    );

    if (rows.length > 0 && deltaS > 0) {
      const claim = rows[0];
      console.log(`[homeflow] Loop ${loopId} closed with deltaS=${deltaS}, earning XP`);

      await claimService.updateClaimStatus(claim.claim_id, 'verified');

      const household = await householdService.getHousehold(claim.household_id);
      if (household) {
        await token.mintEnergyCredits(household.id, household.validatorId, deltaS, loopId);
        await token.issueHouseholdCT(
          household.id,
          household.validatorId,
          `Loop closed: deltaS=${deltaS.toFixed(4)} J/K`,
          Math.floor(deltaS * 10),
        );
        await reputation.reportSuccess(household.validatorId, loopId, deltaS);
        const cumDeltaS = await entropyService.getCumulativeDeltaS(household.id);
        await credential.checkAndIssueCredentials(household.id, household.validatorId, cumDeltaS);
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

  eventBus.on(EventType.SEASON_STARTED, async (_event: DomainEvent) => {
    console.log('[homeflow] New season started, adjusting automation baselines');
  });

  eventBus.on(EventType.SEASON_ENDED, async (_event: DomainEvent) => {
    console.log('[homeflow] Season ended, archiving entropy data');
  });

  eventBus.on(EventType.REPUTATION_ACCRUED, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;
    if (payload.domain === 'thermodynamic') {
      console.log(`[homeflow] Reputation accrued for ${payload.validatorId}: +${payload.delta}`);
    }
  });

  await temporal.registerForSeasonEvents();

  // ── Build and start the express app ──────────────────────────────────
  const app = createApp({
    db,
    userService,
    psllService,
    householdService,
    deviceService,
    entropyService,
    claimService,
    integrations: { governance, temporal, token, credential, dag, reputation },
    interopService,
    authConfig: {
      googleClientId: process.env.GOOGLE_CLIENT_ID,
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
      baseUrl: BASE_URL,
    },
    sessionSecret: SESSION_SECRET,
    staticFrontendDir: defaultStaticFrontendDir(),
    secureCookies: process.env.SECURE_COOKIES === '1',
    ...(TEMPORAL_HMAC_SECRET ? { temporalHmacSecret: TEMPORAL_HMAC_SECRET } : {}),
  });

  app.listen(PORT, () => {
    console.log(`[homeflow] Listening on port ${PORT}`);
    console.log(`[homeflow] Health: http://localhost:${PORT}/health`);
    console.log(`[homeflow] Web: http://localhost:${PORT}/`);
    console.log(`[homeflow] OAuth: http://localhost:${PORT}/auth/google`);
    console.log('═══════════════════════════════════════════════════════════════');
  });
}

if (process.env.HOMEFLOW_NO_LISTEN !== '1') {
  main().catch(err => {
    console.error('[homeflow] Fatal startup error:', err);
    process.exit(1);
  });
}

export { createApp, defaultStaticFrontendDir };
