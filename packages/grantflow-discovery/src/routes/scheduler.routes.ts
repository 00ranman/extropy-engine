/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Scheduler Router
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Routes:
 *    POST   /api/v1/search              — Trigger a manual grant search
 *    GET    /api/v1/search-runs         — Get search execution history
 *    GET    /api/v1/scheduler/status    — Get scheduler status
 *    POST   /api/v1/scheduler/run       — Trigger a full discovery cycle
 *    POST   /api/v1/scheduler/start     — Start the scheduler (if stopped)
 *    POST   /api/v1/scheduler/stop      — Stop the scheduler
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { SchedulerService } from '../services/scheduler.service.js';
import type { GrantsGovService } from '../services/grants-gov.service.js';
import type { GfSearchParams } from '../types/index.js';

export function createSchedulerRoutes(
  schedulerService: SchedulerService,
  grantsGovService: GrantsGovService,
): Router {
  const router = Router();

  // ── POST /api/v1/search ──────────────────────────────────────────────────

  /**
   * Trigger a manual grant search against Grants.gov.
   * Persists discovered opportunities and returns them.
   *
   * Body (optional):
   *   keyword      - Search keyword(s)
   *   oppStatuses  - Pipe-delimited statuses (default: "forecasted|posted")
   *   rows         - Number of results to fetch (default: 25, max: 100)
   *   sortBy       - Sort order (default: "openDate|desc")
   *
   * Returns: { opportunities: GfOpportunity[], count: number }
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = req.body as GfSearchParams;

      // Cap rows to 100 for manual searches
      if (params.rows && params.rows > 100) {
        params.rows = 100;
      }

      const opportunities = await grantsGovService.searchGrants(params);

      // Persist all found opportunities
      const persisted = await Promise.all(
        opportunities.map(opp => grantsGovService.persistOpportunity(opp)),
      );

      res.json({
        opportunities: persisted,
        count:         persisted.length,
        searchedAt:    new Date().toISOString(),
        params,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /api/v1/search-runs ──────────────────────────────────────────────

  /**
   * Get the history of all search runs (scheduled + manual).
   *
   * Query params: limit (default 20, max 100)
   * Returns: { runs: GfSearchRun[], count: number }
   */
  router.get('/runs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(
        parseInt(req.query['limit'] as string ?? '20', 10),
        100,
      );
      const runs = await schedulerService.getSearchHistory(isNaN(limit) ? 20 : limit);
      res.json({ runs, count: runs.length });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /api/v1/scheduler/status ────────────────────────────────────────

  /**
   * Get the current scheduler status.
   *
   * Returns:
   *   active:      boolean — whether the scheduler is running
   *   lastRunAt:   ISO-8601 timestamp of last completed cycle
   *   nextRunAt:   ISO-8601 timestamp of next scheduled cycle
   *   intervalMs:  configured cycle interval in milliseconds
   */
  router.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        active:     schedulerService.isActive(),
        lastRunAt:  schedulerService.getLastRunAt(),
        nextRunAt:  schedulerService.getNextRunAt(),
        timestamp:  new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /api/v1/scheduler/run ───────────────────────────────────────────

  /**
   * Manually trigger a full discovery cycle.
   * Runs the complete search → match → claim pipeline.
   *
   * Body (optional): { keyword?: string }
   * Returns: GfSearchRun
   */
  router.post('/run', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { keyword } = req.body as { keyword?: string };

      console.log('[scheduler-routes] Manual discovery cycle triggered');
      const run = await schedulerService.runDiscoveryCycle(keyword);

      res.json(run);
    } catch (err) {
      next(err);
    }
  });

  // ── POST /api/v1/scheduler/start ────────────────────────────────────────

  /**
   * Start the automated discovery scheduler (if not already running).
   *
   * Returns: { active: true, message: string }
   */
  router.post('/start', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (schedulerService.isActive()) {
        res.json({
          active:  true,
          message: 'Scheduler is already running',
        });
        return;
      }

      schedulerService.start();

      res.json({
        active:  true,
        message: 'Scheduler started',
        nextRunAt: schedulerService.getNextRunAt(),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /api/v1/scheduler/stop ─────────────────────────────────────────

  /**
   * Stop the automated discovery scheduler.
   *
   * Returns: { active: false, message: string }
   */
  router.post('/stop', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (!schedulerService.isActive()) {
        res.json({
          active:  false,
          message: 'Scheduler is not running',
        });
        return;
      }

      schedulerService.stop();

      res.json({
        active:  false,
        message: 'Scheduler stopped',
        lastRunAt: schedulerService.getLastRunAt(),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
