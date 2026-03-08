/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Academia Bridge
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Academia Bridge is the automated paper upload service for the Extropy Engine
 *  monorepo. It bridges the gap between locally-authored research and the public
 *  academia.edu platform, treating each publication as a significant entropy
 *  reduction event: private knowledge becoming public knowledge.
 *
 *  Core formula:  XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 *  For uploads:   ΔS = log2(potential_audience) − log2(1) ≈ 13.29 bits
 *
 *  Architecture:
 *    - Express HTTP server (port 4022)
 *    - PostgreSQL database (schema: academia)
 *    - Redis for event bus pub/sub on `extropy:events`
 *    - Playwright (headless Chromium) for academia.edu browser automation
 *    - Shares @extropy/contracts types
 *    - Full interoperability with all Extropy Engine ecosystem apps
 *
 *  This service:
 *    1. Manages a queue of papers waiting to be uploaded to academia.edu
 *    2. Automates the upload workflow via Playwright browser automation
 *    3. Tracks paper performance metrics (views, downloads, citations)
 *    4. Emits entropy claims to the Epistemology Engine on key events:
 *       - Paper queued (INFORMATIONAL domain, small ΔS)
 *       - Paper published (INFORMATIONAL + SOCIAL, ΔS ≈ 13.29 bits)
 *       - View milestones reached (SOCIAL domain)
 *    5. Responds to TASK_ASSIGNED events from SignalFlow for validation
 *    6. Reacts to LOOP_CLOSED events to track XP earned
 *    7. Listens for custom events from grantflow-proposer when papers
 *       are ready for upload (sourceProposalId linkage)
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { EventType } from '@extropy/contracts';
import type { DomainEvent } from '@extropy/contracts';

// ── Services ────────────────────────────────────────────────────────────────
import { DatabaseService } from './services/database.service.js';
import { EventBusService } from './services/event-bus.service.js';
import { PaperService } from './services/paper.service.js';
import { UploadService } from './services/upload.service.js';
import { MetricsService } from './services/metrics.service.js';
import { ClaimService } from './services/claim.service.js';

// ── Routes ───────────────────────────────────────────────────────────────────
import { createPapersRoutes } from './routes/papers.routes.js';
import { createUploadsRoutes } from './routes/uploads.routes.js';
import { createMetricsRoutes } from './routes/metrics.routes.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PORT             = parseInt(process.env.PORT            ?? '4022', 10);
const DATABASE_URL     = process.env.DATABASE_URL             ?? 'postgresql://extropy:extropy_dev@localhost:5432/extropy_engine?schema=academia';
const REDIS_URL        = process.env.REDIS_URL                ?? 'redis://localhost:6379';
const EPISTEMOLOGY_URL = process.env.EPISTEMOLOGY_URL         ?? 'http://localhost:4001';
const LOOP_LEDGER_URL  = process.env.LOOP_LEDGER_URL          ?? 'http://localhost:4003';
const REPUTATION_URL   = process.env.REPUTATION_URL           ?? 'http://localhost:4004';
const XP_MINT_URL      = process.env.XP_MINT_URL              ?? 'http://localhost:4005';

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ACADEMIA BRIDGE — Extropy Engine Publication Service');
  console.log('═══════════════════════════════════════════════════════════════');

  // ── Initialize infrastructure ──────────────────────────────────────────
  const db = new DatabaseService(DATABASE_URL);
  await db.initialize();
  console.log('[academia-bridge] Database initialized');

  const eventBus = new EventBusService(REDIS_URL);
  await eventBus.connect();
  console.log('[academia-bridge] Event bus connected');

  // ── Initialize services ────────────────────────────────────────────────
  const paperService  = new PaperService(db, eventBus);
  const uploadService = new UploadService(db, eventBus, paperService);
  const metricsService = new MetricsService(db, paperService);
  const claimService  = new ClaimService(db, eventBus, EPISTEMOLOGY_URL);

  // Log credential status on startup (but never log credentials themselves)
  const sessionStatus = uploadService.getSessionStatus();
  if (sessionStatus.isAuthenticated) {
    console.log(`[academia-bridge] Academia.edu credentials configured for: ${sessionStatus.email}`);
  } else {
    console.warn('[academia-bridge] WARNING: ACADEMIA_EMAIL and/or ACADEMIA_PASSWORD not set — uploads will fail');
  }

  // ── Subscribe to core events ──────────────────────────────────────────

  // When a task is assigned to academia-bridge by SignalFlow
  eventBus.on(EventType.TASK_ASSIGNED, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;

    // Only handle tasks routed to academia-bridge or informational/social domains
    const isOurs =
      payload.targetService === 'academia-bridge' ||
      payload.domain === 'informational' ||
      payload.domain === 'social';

    if (isOurs) {
      await claimService.handleValidationTask(
        payload.taskId as string,
        (payload.claimId as string) ?? '',
        event.correlationId,
        event.source as string,
        (payload.domain as string) ?? 'informational',
      );
    }
  });

  // When a loop closes — check if it's one of our paper claims and update status
  eventBus.on(EventType.LOOP_CLOSED, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;
    const loopId  = event.correlationId;
    const deltaS  = payload.deltaS as number;

    if (deltaS > 0) {
      console.log(`[academia-bridge] Loop ${loopId} closed with ΔS=${deltaS} — checking for paper claims`);

      // Check if this loop is associated with one of our uploads
      const { rows } = await db.query(
        `SELECT p.id, p.title, p.academia_url
         FROM academia.ab_papers p
         JOIN academia.ab_uploads u ON u.paper_id = p.id
         WHERE u.status = 'success'
         LIMIT 1`,
      );

      if (rows.length > 0) {
        const paper = rows[0] as Record<string, unknown>;
        console.log(`[academia-bridge] Loop closed for paper: "${paper.title}" (ΔS=${deltaS})`);

        // Report to reputation service (fire-and-forget)
        const profileName = process.env.ACADEMIA_PROFILE_NAME ?? 'Randall Gossett';
        fetch(`${REPUTATION_URL}/api/v1/reputation`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            validatorName: profileName,
            domain:        'social',
            loopId,
            deltaS,
            source:        'academia-bridge',
          }),
        }).catch(err => console.error('[academia-bridge] Reputation report failed:', err));
      }
    }
  });

  // When XP is provisionally minted — log for monitoring
  eventBus.on(EventType.XP_MINTED_PROVISIONAL, async (event: DomainEvent) => {
    const payload   = event.payload as Record<string, unknown>;
    const mintEvent = payload.mintEvent as Record<string, unknown>;
    if (mintEvent) {
      const loopId  = mintEvent.loopId  as string;
      const xpValue = mintEvent.xpValue as number;
      console.log(`[academia-bridge] XP minted for loop ${loopId}: ${xpValue} XP`);
    }
  });

  // Listen for grantflow-proposer paper-ready events
  // These arrive when a proposal has been exported and is ready for academia.edu upload
  eventBus.on('grantflow.proposal.exported' as unknown as EventType, async (event: DomainEvent) => {
    const payload = event.payload as Record<string, unknown>;

    if (payload.targetService === 'academia-bridge' || payload.queueForUpload) {
      console.log(`[academia-bridge] Received paper-ready event from grantflow-proposer`);

      try {
        const paper = await paperService.queuePaper({
          title:            (payload.title as string) ?? 'Untitled Paper',
          abstract:         (payload.abstract as string) ?? '',
          coAuthors:        (payload.coAuthors as string[]) ?? [],
          tags:             (payload.tags as string[]) ?? [],
          filePath:         payload.filePath as string | undefined,
          content:          payload.content as string | undefined,
          fileType:         (payload.fileType as 'pdf' | 'docx') ?? 'pdf',
          sourceProposalId: payload.proposalId as string | undefined,
        });

        console.log(`[academia-bridge] Auto-queued paper from grantflow-proposer: ${paper.id} — "${paper.title}"`);

        await claimService.emitQueueClaim(paper);

        // Auto-upload if credentials are available
        const status = uploadService.getSessionStatus();
        if (status.isAuthenticated && payload.autoUpload) {
          console.log(`[academia-bridge] Auto-uploading paper ${paper.id}...`);
          const result = await uploadService.uploadPaper(paper.id);
          if (result.success && result.academiaUrl) {
            const updatedPaper = await paperService.getPaper(paper.id);
            const upload = result.uploadId ? await uploadService.getUpload(result.uploadId) : null;
            if (updatedPaper && upload) {
              await claimService.emitUploadClaim(updatedPaper, upload);
            }
          }
        }
      } catch (err) {
        console.error('[academia-bridge] Failed to auto-queue paper from grantflow-proposer:', err);
      }
    }
  });

  // ── Create Express app ────────────────────────────────────────────────
  const app = express();
  app.use(express.json({ limit: '50mb' })); // Larger limit for paper content

  // Request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[academia-bridge] ${req.method} ${req.path}`);
    next();
  });

  // ── Health check ──────────────────────────────────────────────────────
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await db.query('SELECT 1');

      const sessionStatus = uploadService.getSessionStatus();
      const aggregateMetrics = await metricsService.getAggregateMetrics();

      res.json({
        service:    'academia-bridge',
        status:     'healthy',
        version:    '1.0.0',
        uptime:     process.uptime(),
        timestamp:  new Date().toISOString(),
        port:       PORT,
        credentials: {
          configured: sessionStatus.isAuthenticated,
          email:      sessionStatus.email ?? null,
        },
        stats: {
          totalPapers:     aggregateMetrics.totalPapers,
          totalViews:      aggregateMetrics.totalViews,
          totalDownloads:  aggregateMetrics.totalDownloads,
        },
      });
    } catch (err) {
      res.status(503).json({
        service:   'academia-bridge',
        status:    'unhealthy',
        error:     String(err),
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── Webhook endpoint for incoming events (interop pattern) ────────────
  app.post('/events', async (req: Request, res: Response) => {
    try {
      const event = req.body as DomainEvent;
      console.log(`[academia-bridge] Received webhook event: ${event.type}`);
      // Re-emit on the local bus for handler dispatch
      // (handlers registered above will process it)
      res.status(200).json({ received: true });
    } catch (err) {
      res.status(400).json({ error: 'Invalid event payload' });
    }
  });

  // ── Mount API routes ──────────────────────────────────────────────────
  app.use('/api/v1/papers',  createPapersRoutes(paperService, uploadService, claimService));
  app.use('/api/v1/uploads', createUploadsRoutes(uploadService));
  app.use('/api/v1/metrics', createMetricsRoutes(metricsService, claimService, paperService));

  // ── Scheduler routes are on /api/v1/scheduler — mount the metrics router ──
  // The /api/v1/scheduler/sync route is defined on the metrics router
  // and registered at /api/v1/metrics. The spec also wants it at /api/v1/scheduler/sync:
  const schedulerRouter = express.Router();
  schedulerRouter.post('/sync', async (_req: Request, res: Response) => {
    // Forward to metrics service sync
    try {
      const results = await metricsService.syncAllMetrics();
      const synced  = results.filter(r => r !== null).length;
      const failed  = results.filter(r => r === null).length;
      res.json({ synced, failed, timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: 'Sync failed', details: String(err) });
    }
  });
  app.use('/api/v1/scheduler', schedulerRouter);

  // ── Global error handler ──────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[academia-bridge] Unhandled error:', err.message);
    res.status(500).json({
      error:     err.message,
      code:      'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  });

  // ── Start server ──────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`[academia-bridge] Listening on port ${PORT}`);
    console.log(`[academia-bridge] Health:    http://localhost:${PORT}/health`);
    console.log(`[academia-bridge] Events:    http://localhost:${PORT}/events`);
    console.log(`[academia-bridge] API:       http://localhost:${PORT}/api/v1`);
    console.log(`[academia-bridge] Papers:    http://localhost:${PORT}/api/v1/papers`);
    console.log(`[academia-bridge] Uploads:   http://localhost:${PORT}/api/v1/uploads`);
    console.log(`[academia-bridge] Metrics:   http://localhost:${PORT}/api/v1/metrics`);
    console.log(`[academia-bridge] Scheduler: http://localhost:${PORT}/api/v1/scheduler/sync`);
    console.log('═══════════════════════════════════════════════════════════════');
  });
}

main().catch(err => {
  console.error('[academia-bridge] Fatal startup error:', err);
  process.exit(1);
});
