/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Household & Zone Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { HouseholdService } from '../services/household.service.js';
import type { CreateHouseholdRequest, CreateZoneRequest } from '../types/index.js';

export function createHouseholdRoutes(householdService: HouseholdService): Router {
  const router = Router();

  // ── Households ─────────────────────────────────────────────────────────

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreateHouseholdRequest;
      if (!body.name || !body.validatorId) {
        res.status(400).json({ error: 'Missing required fields: name, validatorId' });
        return;
      }
      const household = await householdService.createHousehold(body);
      res.status(201).json(household);
    } catch (err) { next(err); }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const household = await householdService.getHousehold(req.params.id);
      if (!household) { res.status(404).json({ error: 'Household not found' }); return; }
      res.json(household);
    } catch (err) { next(err); }
  });

  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const household = await householdService.updateHousehold(req.params.id, req.body);
      if (!household) { res.status(404).json({ error: 'Household not found' }); return; }
      res.json(household);
    } catch (err) { next(err); }
  });

  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await householdService.deleteHousehold(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Household not found' }); return; }
      res.status(204).send();
    } catch (err) { next(err); }
  });

  return router;
}

export function createZoneRoutes(householdService: HouseholdService): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreateZoneRequest;
      if (!body.householdId || !body.name || body.floor === undefined || body.area_sqft === undefined) {
        res.status(400).json({ error: 'Missing required fields: householdId, name, floor, area_sqft' });
        return;
      }
      const zone = await householdService.createZone(body);
      res.status(201).json(zone);
    } catch (err) { next(err); }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const zone = await householdService.getZone(req.params.id);
      if (!zone) { res.status(404).json({ error: 'Zone not found' }); return; }
      res.json(zone);
    } catch (err) { next(err); }
  });

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { householdId } = req.query as { householdId?: string };
      if (!householdId) { res.status(400).json({ error: 'Query param householdId is required' }); return; }
      const zones = await householdService.listZones(householdId);
      res.json({ data: zones, total: zones.length });
    } catch (err) { next(err); }
  });

  router.patch('/:id/occupancy', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { isOccupied } = req.body as { isOccupied: boolean };
      await householdService.updateZoneOccupancy(req.params.id, isOccupied);
      res.json({ zoneId: req.params.id, isOccupied });
    } catch (err) { next(err); }
  });

  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await householdService.deleteZone(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Zone not found' }); return; }
      res.status(204).send();
    } catch (err) { next(err); }
  });

  return router;
}
