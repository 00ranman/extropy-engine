/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Household & Zone Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  All routes here run behind requireSession (mounted in app.ts) and additionally
 *  enforce per-household ownership. Create routes bind the resource to the
 *  authenticated caller's validator identity (their DID) rather than trusting a
 *  client-supplied validatorId, which previously let anyone claim any household.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Response, type NextFunction } from 'express';
import type { HouseholdService } from '../services/household.service.js';
import type { CreateHouseholdRequest, CreateZoneRequest } from '../types/index.js';
import type { AuthedRequest } from '../auth/auth.middleware.js';
import {
  requireHouseholdAccess,
  requireZoneAccess,
  callerValidatorId,
} from '../auth/ownership.middleware.js';

export function createHouseholdRoutes(householdService: HouseholdService): Router {
  const router = Router();

  // ── Households ─────────────────────────────────────────────────────────

  router.post('/', async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreateHouseholdRequest;
      const validatorId = callerValidatorId(req);
      if (!validatorId) {
        res.status(403).json({ error: 'caller has no validator identity; complete onboarding first' });
        return;
      }
      if (!body.name) {
        res.status(400).json({ error: 'Missing required field: name' });
        return;
      }
      // Ownership is derived from the session, never from the request body.
      const household = await householdService.createHousehold({
        ...body,
        validatorId: validatorId as CreateHouseholdRequest['validatorId'],
      });
      res.status(201).json(household);
    } catch (err) { next(err); }
  });

  router.get(
    '/:id',
    requireHouseholdAccess(householdService, { from: 'param', key: 'id' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const household = await householdService.getHousehold(req.params.id);
        if (!household) { res.status(404).json({ error: 'Household not found' }); return; }
        res.json(household);
      } catch (err) { next(err); }
    },
  );

  router.patch(
    '/:id',
    requireHouseholdAccess(householdService, { from: 'param', key: 'id' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        // validator_id is not a mutable field via this route.
        const updates = { ...req.body };
        delete (updates as Record<string, unknown>).validatorId;
        delete (updates as Record<string, unknown>).memberValidatorIds;
        const household = await householdService.updateHousehold(req.params.id, updates);
        if (!household) { res.status(404).json({ error: 'Household not found' }); return; }
        res.json(household);
      } catch (err) { next(err); }
    },
  );

  router.delete(
    '/:id',
    requireHouseholdAccess(householdService, { from: 'param', key: 'id' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const deleted = await householdService.deleteHousehold(req.params.id);
        if (!deleted) { res.status(404).json({ error: 'Household not found' }); return; }
        res.status(204).send();
      } catch (err) { next(err); }
    },
  );

  return router;
}

export function createZoneRoutes(householdService: HouseholdService): Router {
  const router = Router();

  router.post(
    '/',
    requireHouseholdAccess(householdService, { from: 'body', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const body = req.body as CreateZoneRequest;
        if (!body.householdId || !body.name || body.floor === undefined || body.area_sqft === undefined) {
          res.status(400).json({ error: 'Missing required fields: householdId, name, floor, area_sqft' });
          return;
        }
        const zone = await householdService.createZone(body);
        res.status(201).json(zone);
      } catch (err) { next(err); }
    },
  );

  router.get(
    '/:id',
    requireZoneAccess(householdService, 'id'),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const zone = await householdService.getZone(req.params.id);
        if (!zone) { res.status(404).json({ error: 'Zone not found' }); return; }
        res.json(zone);
      } catch (err) { next(err); }
    },
  );

  router.get(
    '/',
    requireHouseholdAccess(householdService, { from: 'query', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const { householdId } = req.query as { householdId?: string };
        const zones = await householdService.listZones(householdId as string);
        res.json({ data: zones, total: zones.length });
      } catch (err) { next(err); }
    },
  );

  router.patch(
    '/:id/occupancy',
    requireZoneAccess(householdService, 'id'),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const { isOccupied } = req.body as { isOccupied: boolean };
        await householdService.updateZoneOccupancy(req.params.id, isOccupied);
        res.json({ zoneId: req.params.id, isOccupied });
      } catch (err) { next(err); }
    },
  );

  router.delete(
    '/:id',
    requireZoneAccess(householdService, 'id'),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const deleted = await householdService.deleteZone(req.params.id);
        if (!deleted) { res.status(404).json({ error: 'Zone not found' }); return; }
        res.status(204).send();
      } catch (err) { next(err); }
    },
  );

  return router;
}
