/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Profiles Router
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Routes:
 *    POST   /api/v1/profiles           — Create a new researcher profile
 *    GET    /api/v1/profiles           — List all profiles
 *    GET    /api/v1/profiles/:id       — Get a specific profile
 *    PATCH  /api/v1/profiles/:id       — Update a profile
 *    DELETE /api/v1/profiles/:id       — Delete a profile
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ProfileService } from '../services/profile.service.js';
import type { GfProfileCreate, GfProfileUpdate } from '../types/index.js';

export function createProfileRoutes(profileService: ProfileService): Router {
  const router = Router();

  // ── POST /api/v1/profiles ────────────────────────────────────────────────

  /**
   * Create a new researcher profile.
   *
   * Body: GfProfileCreate
   * Returns: GfProfile (201)
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req.body as GfProfileCreate;

      if (!data.name || typeof data.name !== 'string') {
        res.status(400).json({
          error: 'name is required',
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      const profile = await profileService.createProfile({
        name:             data.name,
        email:            data.email,
        keywords:         Array.isArray(data.keywords) ? data.keywords : [],
        domains:          Array.isArray(data.domains) ? data.domains : [],
        pastAwards:       Array.isArray(data.pastAwards) ? data.pastAwards : [],
        expertise:        Array.isArray(data.expertise) ? data.expertise : [],
        minAwardAmount:   data.minAwardAmount,
        maxAwardAmount:   data.maxAwardAmount,
        eligibilityTypes: Array.isArray(data.eligibilityTypes) ? data.eligibilityTypes : [],
      });

      res.status(201).json(profile);
    } catch (err) {
      next(err);
    }
  });

  // ── GET /api/v1/profiles ─────────────────────────────────────────────────

  /**
   * List all researcher profiles with optional pagination.
   *
   * Query params: limit, offset
   * Returns: GfProfile[] (200)
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit  = Math.min(parseInt(req.query['limit'] as string ?? '50', 10), 200);
      const offset = parseInt(req.query['offset'] as string ?? '0', 10);

      const profiles = await profileService.listProfiles(
        isNaN(limit) ? 50 : limit,
        isNaN(offset) ? 0 : offset,
      );

      res.json({ profiles, count: profiles.length });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /api/v1/profiles/:id ─────────────────────────────────────────────

  /**
   * Get a single profile by UUID.
   *
   * Returns: GfProfile (200) or 404
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const profile = await profileService.getProfile(req.params['id']);

      if (!profile) {
        res.status(404).json({
          error: `Profile ${req.params['id']} not found`,
          code:  'NOT_FOUND',
        });
        return;
      }

      res.json(profile);
    } catch (err) {
      next(err);
    }
  });

  // ── PATCH /api/v1/profiles/:id ───────────────────────────────────────────

  /**
   * Partially update a profile.
   *
   * Body: GfProfileUpdate (any subset of profile fields)
   * Returns: Updated GfProfile (200) or 404
   */
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const update = req.body as GfProfileUpdate;
      const updated = await profileService.updateProfile(req.params['id'], update);

      if (!updated) {
        res.status(404).json({
          error: `Profile ${req.params['id']} not found`,
          code:  'NOT_FOUND',
        });
        return;
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // ── DELETE /api/v1/profiles/:id ──────────────────────────────────────────

  /**
   * Delete a profile by UUID.
   *
   * Returns: 204 (deleted) or 404
   */
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await profileService.deleteProfile(req.params['id']);

      if (!deleted) {
        res.status(404).json({
          error: `Profile ${req.params['id']} not found`,
          code:  'NOT_FOUND',
        });
        return;
      }

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
