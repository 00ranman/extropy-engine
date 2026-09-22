/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Opportunities Router
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Routes:
 *    GET    /api/v1/opportunities              — List cached opportunities
 *    GET    /api/v1/opportunities/:id          — Get opportunity detail
 *    POST   /api/v1/opportunities/:id/match    — Compute match score for a profile
 *    GET    /api/v1/matches                    — List all matches above threshold
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { GrantsGovService } from '../services/grants-gov.service.js';
import type { MatchingService } from '../services/matching.service.js';
import type { ProfileService } from '../services/profile.service.js';

export function createOpportunityRoutes(
  grantsGovService: GrantsGovService,
  matchingService:  MatchingService,
  profileService:   ProfileService,
): Router {
  const router = Router();

  // ── GET /api/v1/opportunities ────────────────────────────────────────────

  /**
   * List cached grant opportunities from the local database.
   *
   * Query params:
   *   limit  (default 50, max 200)
   *   offset (default 0)
   *   status (forecasted|posted|closed|archived)
   *
   * Returns: { opportunities: GfOpportunity[], count: number }
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit  = Math.min(parseInt(req.query['limit'] as string ?? '50', 10), 200);
      const offset = parseInt(req.query['offset'] as string ?? '0', 10);
      const status = req.query['status'] as string | undefined;

      const opportunities = await grantsGovService.listOpportunities(
        isNaN(limit) ? 50 : limit,
        isNaN(offset) ? 0 : offset,
        status,
      );

      res.json({ opportunities, count: opportunities.length });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /api/v1/opportunities/:id ────────────────────────────────────────

  /**
   * Get a single opportunity by internal UUID.
   *
   * Returns: GfOpportunity (200) or 404
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const opportunity = await grantsGovService.getOpportunity(req.params['id']);

      if (!opportunity) {
        res.status(404).json({
          error: `Opportunity ${req.params['id']} not found`,
          code:  'NOT_FOUND',
        });
        return;
      }

      res.json(opportunity);
    } catch (err) {
      next(err);
    }
  });

  // ── POST /api/v1/opportunities/:id/match ─────────────────────────────────

  /**
   * Compute (or recompute) the match score between an opportunity and a profile.
   *
   * Body: { profileId: string }
   * Returns: GfMatch (200) or 400/404
   */
  router.post('/:id/match', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { profileId } = req.body as { profileId?: string };

      if (!profileId) {
        res.status(400).json({
          error: 'profileId is required in request body',
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      const opportunity = await grantsGovService.getOpportunity(req.params['id']);
      if (!opportunity) {
        res.status(404).json({
          error: `Opportunity ${req.params['id']} not found`,
          code:  'NOT_FOUND',
        });
        return;
      }

      const profile = await profileService.getProfile(profileId);
      if (!profile) {
        res.status(404).json({
          error: `Profile ${profileId} not found`,
          code:  'NOT_FOUND',
        });
        return;
      }

      // Compute the score (no side effects — just returns the result)
      const scoreResult = matchingService.computeMatchScore(opportunity, profile);

      res.json({
                ...scoreResult,
        opportunityId:   opportunity.id,
        profileId:       profile.id,
        opportunityTitle: opportunity.title,
        profileName:     profile.name,
      });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /api/v1/matches ──────────────────────────────────────────────────

  /**
   * List all grant-profile matches above the minimum score threshold.
   *
   * Query params:
   *   profileId  (optional filter)
   *   minScore   (default 20)
   *   limit      (default 50, max 200)
   *   offset     (default 0)
   *
   * Returns: { matches: GfMatch[], count: number }
   */
  router.get('/matches/all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profileId = req.query['profileId'] as string | undefined;
      const minScore  = parseFloat(req.query['minScore'] as string ?? '20');
      const limit     = Math.min(parseInt(req.query['limit'] as string ?? '50', 10), 200);
      const offset    = parseInt(req.query['offset'] as string ?? '0', 10);

      const matches = await matchingService.listMatches(
        profileId,
        isNaN(minScore) ? 20 : minScore,
        isNaN(limit) ? 50 : limit,
        isNaN(offset) ? 0 : offset,
      );

      res.json({ matches, count: matches.length });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Separate router for /api/v1/matches (mounted at a different prefix).
 * Provides the same matches listing endpoint accessible at the top level.
 */
export function createMatchesRoutes(
  matchingService: MatchingService,
): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profileId = req.query['profileId'] as string | undefined;
      const minScore  = parseFloat(req.query['minScore'] as string ?? '20');
      const limit     = Math.min(parseInt(req.query['limit'] as string ?? '50', 10), 200);
      const offset    = parseInt(req.query['offset'] as string ?? '0', 10);

      const matches = await matchingService.listMatches(
        profileId,
        isNaN(minScore) ? 20 : minScore,
        isNaN(limit) ? 50 : limit,
        isNaN(offset) ? 0 : offset,
      );

      res.json({ matches, count: matches.length });
    } catch (err) {
      next(err);
    }
  });

  router.get('/top/:profileId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(parseInt(req.query['limit'] as string ?? '10', 10), 50);
      const matches = await matchingService.getTopMatches(
        req.params['profileId'],
        isNaN(limit) ? 10 : limit,
      );
      res.json({ matches, count: matches.length });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
