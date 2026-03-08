/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Academia Bridge | Metrics Routes
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Express router for metrics endpoints:
 *
 *  GET  /api/v1/metrics              — aggregate metrics across all papers
 *  GET  /api/v1/metrics/:paperId     — paper-specific metrics
 *  POST /api/v1/scheduler/sync       — trigger full metrics sync for all papers
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response } from 'express';
import type { MetricsService } from '../services/metrics.service.js';
import type { ClaimService } from '../services/claim.service.js';
import type { PaperService } from '../services/paper.service.js';

// View milestone thresholds — emit a claim when a paper crosses these levels
const VIEW_MILESTONES = [100, 500, 1_000, 5_000, 10_000, 50_000, 100_000];

/**
 * Create the metrics router with injected service dependencies.
 *
 * @param metricsService - Metrics scraping and caching
 * @param claimService   - Entropy claim generation for milestones
 * @param paperService   - Paper lookups (for milestone claim context)
 * @returns Express Router
 */
export function createMetricsRoutes(
  metricsService: MetricsService,
  claimService: ClaimService,
  paperService: PaperService,
): Router {
  const router = Router();

  // ─────────────────────────────────────────────────────────────────────────
  //  GET /api/v1/metrics — aggregate metrics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @openapi
   * /api/v1/metrics:
   *   get:
   *     summary: Get aggregate metrics across all uploaded papers
   *     tags: [Metrics]
   *     responses:
   *       200:
   *         description: Aggregate metrics
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AggregateMetrics'
   */
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const metrics = await metricsService.getAggregateMetrics();
      res.json(metrics);
    } catch (err) {
      console.error('[academia-bridge] GET /metrics error:', err);
      res.status(500).json({ error: 'Failed to get aggregate metrics', details: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  GET /api/v1/metrics/:paperId — paper-specific metrics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @openapi
   * /api/v1/metrics/{paperId}:
   *   get:
   *     summary: Get cached metrics for a specific paper
   *     tags: [Metrics]
   *     parameters:
   *       - in: path
   *         name: paperId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: Paper metrics
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AbMetrics'
   *       404:
   *         description: No metrics found for this paper
   */
  router.get('/:paperId', async (req: Request, res: Response) => {
    try {
      const metrics = await metricsService.getMetrics(req.params.paperId);
      if (!metrics) {
        res.status(404).json({
          error:   `No metrics found for paper ${req.params.paperId}`,
          hint:    'Metrics are synced from academia.edu. Trigger a sync first.',
        });
        return;
      }
      res.json(metrics);
    } catch (err) {
      console.error(`[academia-bridge] GET /metrics/${req.params.paperId} error:`, err);
      res.status(500).json({ error: 'Failed to get metrics', details: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  POST /api/v1/scheduler/sync — trigger metrics sync for all papers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @openapi
   * /api/v1/scheduler/sync:
   *   post:
   *     summary: Trigger a metrics sync for all uploaded papers
   *     description: >
   *       Scrapes view/download counts from academia.edu for every uploaded paper.
   *       This is a long-running operation (several seconds per paper).
   *       Checks for view milestones and emits Extropy claims for any reached.
   *     tags: [Scheduler]
   *     responses:
   *       200:
   *         description: Sync results
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 synced:
   *                   type: integer
   *                 failed:
   *                   type: integer
   *                 milestonesCrossed:
   *                   type: integer
   */
  router.post('/sync', async (_req: Request, res: Response) => {
    try {
      console.log('[academia-bridge] Starting scheduled metrics sync...');

      // Get pre-sync metrics snapshot for milestone detection
      const papers = await paperService.listPapers({ status: 'uploaded' });
      const preSyncViews: Map<string, number> = new Map();
      for (const paper of papers) {
        const existing = await metricsService.getMetrics(paper.id);
        if (existing) {
          preSyncViews.set(paper.id, existing.views);
        }
      }

      // Run full sync
      const results = await metricsService.syncAllMetrics();

      const synced  = results.filter(r => r !== null).length;
      const failed  = results.filter(r => r === null).length;

      // Detect milestone crossings and emit claims
      let milestonesCrossed = 0;
      for (const metrics of results) {
        if (!metrics) continue;

        const prevViews = preSyncViews.get(metrics.paperId) ?? 0;
        const newViews  = metrics.views;

        for (const milestone of VIEW_MILESTONES) {
          if (prevViews < milestone && newViews >= milestone) {
            milestonesCrossed++;
            const paper = await paperService.getPaper(metrics.paperId);
            if (paper) {
              claimService.emitViewMilestoneClaim(paper, milestone).catch(err =>
                console.error('[academia-bridge] Milestone claim failed:', err),
              );
            }
          }
        }
      }

      console.log(`[academia-bridge] Sync complete: ${synced} synced, ${failed} failed, ${milestonesCrossed} milestones crossed`);

      res.json({ synced, failed, milestonesCrossed });
    } catch (err) {
      console.error('[academia-bridge] POST /scheduler/sync error:', err);
      res.status(500).json({ error: 'Sync failed', details: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  POST /api/v1/metrics/:paperId/sync — sync single paper
  // ─────────────────────────────────────────────────────────────────────────

  router.post('/:paperId/sync', async (req: Request, res: Response) => {
    try {
      const prevMetrics = await metricsService.getMetrics(req.params.paperId);
      const prevViews   = prevMetrics?.views ?? 0;

      const metrics = await metricsService.syncMetrics(req.params.paperId);
      if (!metrics) {
        res.status(404).json({
          error: `Paper ${req.params.paperId} not found or has no academia URL`,
        });
        return;
      }

      // Check for milestone crossing
      let milestoneCrossed: number | null = null;
      for (const milestone of VIEW_MILESTONES) {
        if (prevViews < milestone && metrics.views >= milestone) {
          milestoneCrossed = milestone;
          const paper = await paperService.getPaper(req.params.paperId);
          if (paper) {
            claimService.emitViewMilestoneClaim(paper, milestone).catch(err =>
              console.error('[academia-bridge] Milestone claim failed:', err),
            );
          }
          break; // Only emit one milestone per sync
        }
      }

      res.json({ metrics, milestoneCrossed });
    } catch (err) {
      console.error(`[academia-bridge] POST /metrics/${req.params.paperId}/sync error:`, err);
      res.status(500).json({ error: 'Sync failed', details: String(err) });
    }
  });

  return router;
}
