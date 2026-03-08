/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — GrantFlow Proposer
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  GrantFlow Proposer is the AI-powered proposal generation and refinement service
 *  within the GrantFlow subsystem of the Extropy Engine.
 *
 *  The Extropy Engine IS the agent writing grant proposals. Each section generated,
 *  refined, or exported is a verifiable entropy reduction event that opens a Loop
 *  and mints XP when the Loop closes with ΔS > 0.
 *
 *  Core formula:  XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 *
 *  Architecture:
 *    - Express HTTP server (port 4021)
 *    - PostgreSQL database (proposals, sections, templates, refinements, claims)
 *    - Redis for event bus pub/sub on `extropy:events`
 *    - Shares @extropy/contracts types with all Extropy Engine services
 *    - Integrates with grantflow-discovery (port 4020) for submission data
 *    - Integrates with academia-bridge (port 4022) for paper uploads
 *
 *  This service:
 *    1. Generates grant proposal sections from templates or OpenAI GPT-4
 *    2. Refines proposals iteratively — each pass is a COGNITIVE ΔS event
 *    3. Manages a reusable template library (7 default templates pre-seeded)
 *    4. Exports proposals as Markdown or plain text for submission packages
 *    5. Emits claims to the Epistemology Engine for each entropy reduction
 *    6. Responds to TASK_ASSIGNED events routed to the cognitive/informational domains
 *    7. Listens for LOOP_CLOSED events to update local claim status and track XP
 *    8. Listens for XP_MINTED_PROVISIONAL events to record XP earned
 *    9. Listens for GRANT_MATCHED events from grantflow-discovery
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { EventType } from '@extropy/contracts';
import type { DomainEvent } from '@extropy/contracts';

// ── Services ────────────────────────────────────────────────────────────────
import { DatabaseService } from './services/database.service.js';
import { EventBusService } from './services/event-bus.service.js';
import { ProposalService } from './services/proposal.service.js';
import { SectionService } from './services/section.service.js';
import { TemplateService } from './services/template.service.js';
import { GenerationService } from './services/generation.service.js';
import { ExportService } from './services/export.service.js';
import { ClaimService } from './services/claim.service.js';

// ── Routes ──────────────────────────────────────────────────────────────────
import { createProposalsRoutes } from './routes/proposals.routes.js';
import { createTemplatesRoutes } from './routes/templates.routes.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PORT                    = parseInt(process.env.PORT              ?? '4021', 10);
const DATABASE_URL            = process.env.DATABASE_URL               ?? 'postgresql://extropy:extropy_dev@localhost:5432/extropy_engine?schema=proposer';
const REDIS_URL               = process.env.REDIS_URL                  ?? 'redis://localhost:6379';
const EPISTEMOLOGY_URL        = process.env.EPISTEMOLOGY_URL           ?? 'http://localhost:4001';
const LOOP_LEDGER_URL         = process.env.LOOP_LEDGER_URL            ?? 'http://localhost:4003';
const REPUTATION_URL          = process.env.REPUTATION_URL             ?? 'http://localhost:4004';
const XP_MINT_URL             = process.env.XP_MINT_URL                ?? 'http://localhost:4005';
const GRANTFLOW_DISCOVERY_URL = process.env.GRANTFLOW_DISCOVERY_URL    ?? 'http://localhost:4020';
const ACADEMIA_BRIDGE_URL     = process.env.ACADEMIA_BRIDGE_URL        ?? 'http://localhost:4022';

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  GRANTFLOW PROPOSER — Extropy Engine AI Proposal Service');
  console.log('═══════════════════════════════════════════════════════════════');

  // ── Initialize infrastructure ────────────────────────────────────────────
  const db = new DatabaseService(DATABASE_URL);
  await db.initialize();
  console.log('[proposer] Database initialized');

  const eventBus = new EventBusService(REDIS_URL, db);
  await eventBus.connect();
  console.log('[proposer] Event bus connected');

  // ── Initialize services ──────────────────────────────────────────────────
  const proposalService   = new ProposalService(db, eventBus);
  const sectionService    = new SectionService(db, eventBus);
  const templateService   = new TemplateService(db);
  const exportService     = new ExportService(proposalService, sectionService);
  const generationService = new GenerationService(db, sectionService, templateService, proposalService);
  const claimService      = new ClaimService(db, eventBus, EPISTEMOLOGY_URL, LOOP_LEDGER_URL);

  // Initialize claim table
  await claimService.initTable();
  console.log('[proposer] Claim table initialized');

  // Seed default templates (idempotent)
  await templateService.seedDefaultTemplates();
  console.log('[proposer] Default templates seeded');

  // ── Subscribe to core events ─────────────────────────────────────────────

  /**
   * TASK_ASSIGNED (COGNITIVE domain)
   * When SignalFlow routes a validation task to grantflow-proposer,
   * process the claim validation using local proposal quality data.
   */
  eventBus.on(EventType.TASK_ASSIGNED, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;

    // Only handle tasks routed to grantflow-proposer or cognitive/informational domains
    if (
      payload.targetService === 'grantflow-proposer' ||
      payload.domain === 'cognitive' ||
      payload.domain === 'informational'
    ) {
      await claimService.handleValidationTask(
        payload.taskId  as string,
        payload.claimId as string ?? '',
        event.correlationId,
        event.source    as string,
        (payload.domain as string) ?? 'cognitive',
      );
    }
  });

  /**
   * LOOP_CLOSED
   * When a Loop closes, check if it corresponds to one of our claims.
   * If ΔS > 0, update local claim status.
   */
  eventBus.on(EventType.LOOP_CLOSED, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;
    const loopId  = event.correlationId;
    const deltaS  = payload.deltaS as number;

    // Look up the local claim
    const claim = await claimService.getClaimByLoopId(loopId).catch(() => null);

    if (claim && deltaS > 0) {
      console.log(`[proposer] Loop ${loopId} closed with ΔS=${deltaS} for claim "${claim.statement}"`);
      await claimService.updateClaimStatus(claim.claim_id, 'verified');

      // Notify reputation service about successful entropy reduction
      try {
        await fetch(`${REPUTATION_URL}/api/v1/accrue`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            validatorId: 'grantflow-proposer',
            domain:      claim.domain,
            loopId,
            deltaS,
          }),
          signal: AbortSignal.timeout(5_000),
        });
      } catch (err) {
        console.warn('[proposer] Failed to notify reputation service:', (err as Error).message);
      }
    }
  });

  /**
   * XP_MINTED_PROVISIONAL
   * When XP is provisionally minted for a loop, record the XP value
   * against the local claim.
   */
  eventBus.on(EventType.XP_MINTED_PROVISIONAL, async (event: DomainEvent) => {
    const payload   = event.payload as Record<string, unknown>;
    const mintEvent = payload.mintEvent as Record<string, unknown>;

    if (mintEvent) {
      const loopId  = mintEvent.loopId  as string;
      const xpValue = mintEvent.xpValue as number;

      const claim = await claimService.getClaimByLoopId(loopId).catch(() => null);
      if (claim) {
        await claimService.updateClaimStatus(claim.claim_id, 'xp_minted', xpValue);
        console.log(`[proposer] XP minted for loop ${loopId}: ${xpValue} XP — "${claim.statement}"`);
      }
    }
  });

  /**
   * Custom event from grantflow-discovery: GRANT_MATCHED
   * When a grant is matched to a researcher profile, automatically
   * create a proposal stub and begin generation.
   *
   * This event is published on the `grantflow.grant.matched` event type
   * (emitted by grantflow-discovery as a custom event over Redis).
   */
  eventBus.on('grantflow.grant.matched' as EventType, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;
    const match   = payload.match as Record<string, unknown> | undefined;
    const opp     = payload.opportunity as Record<string, unknown> | undefined;
    const profile = payload.profile as Record<string, unknown> | undefined;

    if (!match || !opp) {
      console.warn('[proposer] Received grantflow.grant.matched without match/opportunity data');
      return;
    }

    console.log(`[proposer] Grant matched event received for opportunity: ${opp.title as string}`);

    try {
      // Create a proposal stub
      const proposal = await proposalService.createProposal({
        submissionId:      (match.submissionId ?? match.id) as string,
        opportunityTitle:  opp.title  as string,
        agency:            opp.agency as string,
        opportunityNumber: opp.opportunityNumber as string | undefined,
        principalInvestigator: profile?.principalInvestigator as string | undefined,
        requestedAmount:   opp.awardAmount as number | undefined,
        proposalDuration:  opp.duration   as string | undefined,
      });

      console.log(`[proposer] Auto-created proposal ${proposal.id} for matched grant`);

      // Emit draft claim
      await claimService.emitDraftClaim(proposal, 'grantflow-proposer');

      // Optionally trigger auto-generation if profile data is available
      if (profile?.principalInvestigator) {
        const context = {
          opportunity: {
            title:   opp.title   as string,
            agency:  opp.agency  as string,
            synopsis: opp.synopsis as string | undefined,
            awardAmount: opp.awardAmount as number | undefined,
            duration: opp.duration as string | undefined,
          },
          profile: {
            principalInvestigator: profile.principalInvestigator as string,
            institution:  profile.institution  as string | undefined,
            expertise:    profile.expertise    as string[] | undefined,
            priorWork:    profile.priorWork    as string | undefined,
          },
        };

        // Generate in background — do not await
        generationService.generateFullProposal(proposal.id, context).catch(err =>
          console.error(`[proposer] Auto-generation failed for proposal ${proposal.id}:`, err),
        );
      }
    } catch (err) {
      console.error('[proposer] Failed to process grantflow.grant.matched event:', err);
    }
  });

  // Register webhook back to ourselves for Epistemology events
  // (so loop closed events reach us via HTTP as well as Redis)
  eventBus.registerWebhook(EventType.LOOP_CLOSED, `http://localhost:${PORT}/events`);

  // ── Create Express app ───────────────────────────────────────────────────
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[proposer] ${req.method} ${req.path}`);
    next();
  });

  // ── Health check ─────────────────────────────────────────────────────────
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await db.query('SELECT 1');
      res.json({
        service:   'grantflow-proposer',
        status:    'healthy',
        version:   '1.0.0',
        uptime:    process.uptime(),
        timestamp: new Date().toISOString(),
        port:      PORT,
        config: {
          hasOpenAI:        !!process.env.OPENAI_API_KEY,
          epistemologyUrl:  EPISTEMOLOGY_URL,
          loopLedgerUrl:    LOOP_LEDGER_URL,
          discoveryUrl:     GRANTFLOW_DISCOVERY_URL,
          academiaBridgeUrl: ACADEMIA_BRIDGE_URL,
        },
      });
    } catch (err) {
      res.status(503).json({
        service: 'grantflow-proposer',
        status:  'unhealthy',
        error:   String(err),
      });
    }
  });

  // ── Events webhook (for Epistemology Engine → this service callbacks) ─────
  app.post('/events', async (req: Request, res: Response) => {
    try {
      const event = req.body as DomainEvent;
      if (!event || !event.type) {
        res.status(400).json({ error: 'Invalid event payload' });
        return;
      }

      console.log(`[proposer] Received webhook event: ${event.type}`);

      // Handle LOOP_CLOSED via webhook
      if (event.type === EventType.LOOP_CLOSED) {
        const payload = event.payload as Record<string, unknown>;
        const deltaS  = payload.deltaS as number;
        const loopId  = event.correlationId;

        const claim = await claimService.getClaimByLoopId(loopId).catch(() => null);
        if (claim && deltaS > 0) {
          await claimService.updateClaimStatus(claim.claim_id, 'verified');
          console.log(`[proposer] Webhook: Loop ${loopId} verified with ΔS=${deltaS}`);
        }
      }

      res.json({ received: true, eventType: event.type });
    } catch (err) {
      console.error('[proposer] Webhook error:', err);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // ── Mount API routes ──────────────────────────────────────────────────────
  app.use('/api/v1/proposals', createProposalsRoutes(
    proposalService,
    sectionService,
    generationService,
    exportService,
    claimService,
  ));

  app.use('/api/v1/templates', createTemplatesRoutes(templateService));

  // ── Service info endpoint ─────────────────────────────────────────────────
  app.get('/api/v1/info', (_req: Request, res: Response) => {
    res.json({
      service:        'grantflow-proposer',
      version:        '1.0.0',
      description:    'AI-powered grant proposal generation and refinement',
      port:           PORT,
      entropyDomains: ['cognitive', 'informational'],
      endpoints: {
        health:    `http://localhost:${PORT}/health`,
        events:    `http://localhost:${PORT}/events`,
        proposals: `http://localhost:${PORT}/api/v1/proposals`,
        templates: `http://localhost:${PORT}/api/v1/templates`,
      },
      integrations: {
        epistemology:   EPISTEMOLOGY_URL,
        loopLedger:     LOOP_LEDGER_URL,
        reputation:     REPUTATION_URL,
        xpMint:         XP_MINT_URL,
        discovery:      GRANTFLOW_DISCOVERY_URL,
        academiaBridge: ACADEMIA_BRIDGE_URL,
      },
    });
  });

  // ── Global error handler ──────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[proposer] Error:', err.message);
    res.status(500).json({
      error:     err.message,
      code:      'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (): Promise<void> => {
    console.log('[proposer] Shutting down gracefully...');
    await eventBus.disconnect();
    await db.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  // ── Start server ──────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`[proposer] Listening on port ${PORT}`);
    console.log(`[proposer] Health:    http://localhost:${PORT}/health`);
    console.log(`[proposer] Events:    http://localhost:${PORT}/events`);
    console.log(`[proposer] API:       http://localhost:${PORT}/api/v1`);
    console.log(`[proposer] Proposals: http://localhost:${PORT}/api/v1/proposals`);
    console.log(`[proposer] Templates: http://localhost:${PORT}/api/v1/templates`);
    console.log(`[proposer] OpenAI:    ${process.env.OPENAI_API_KEY ? 'ENABLED' : 'disabled (template mode)'}`);
    console.log('═══════════════════════════════════════════════════════════════');
  });
}

main().catch(err => {
  console.error('[proposer] Fatal startup error:', err);
  process.exit(1);
});
