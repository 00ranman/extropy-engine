/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Device Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Runs behind requireSession (mounted in app.ts). Device-scoped routes resolve
 *  the device's household and verify the caller is a member before any read,
 *  mutation, or command issuance. Household-scoped routes (register, list) verify
 *  membership of the target household.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Response, type NextFunction } from 'express';
import type { DeviceService } from '../services/device.service.js';
import type { HouseholdService } from '../services/household.service.js';
import type { RegisterDeviceRequest, IssueCommandRequest } from '../types/index.js';
import type { AuthedRequest } from '../auth/auth.middleware.js';
import {
  requireHouseholdAccess,
  requireDeviceAccess,
} from '../auth/ownership.middleware.js';

export function createDeviceRoutes(
  deviceService: DeviceService,
  householdService: HouseholdService,
): Router {
  const router = Router();

  // POST /api/v1/devices — register a new device
  router.post(
    '/',
    requireHouseholdAccess(householdService, { from: 'body', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const body = req.body as RegisterDeviceRequest;
        if (!body.householdId || !body.name || !body.type || !body.manufacturer || !body.model || !body.firmwareVersion) {
          res.status(400).json({ error: 'Missing required fields: householdId, name, type, manufacturer, model, firmwareVersion' });
          return;
        }
        const device = await deviceService.registerDevice(body);
        res.status(201).json(device);
      } catch (err) { next(err); }
    },
  );

  // GET /api/v1/devices?householdId=&type=
  router.get(
    '/',
    requireHouseholdAccess(householdService, { from: 'query', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const { householdId, type } = req.query as { householdId?: string; type?: string };
        const devices = await deviceService.listDevices(householdId as string, type);
        res.json({ data: devices, total: devices.length });
      } catch (err) { next(err); }
    },
  );

  // GET /api/v1/devices/:id
  router.get(
    '/:id',
    requireDeviceAccess(householdService, deviceService, 'id'),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const device = await deviceService.getDevice(req.params.id);
        if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
        res.json(device);
      } catch (err) { next(err); }
    },
  );

  // PATCH /api/v1/devices/:id
  router.patch(
    '/:id',
    requireDeviceAccess(householdService, deviceService, 'id'),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        // householdId is not reassignable through this route.
        const updates = { ...req.body };
        delete (updates as Record<string, unknown>).householdId;
        const device = await deviceService.updateDevice(req.params.id, updates);
        if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
        res.json(device);
      } catch (err) { next(err); }
    },
  );

  // DELETE /api/v1/devices/:id
  router.delete(
    '/:id',
    requireDeviceAccess(householdService, deviceService, 'id'),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const deleted = await deviceService.deleteDevice(req.params.id);
        if (!deleted) { res.status(404).json({ error: 'Device not found' }); return; }
        res.status(204).send();
      } catch (err) { next(err); }
    },
  );

  // POST /api/v1/devices/:id/commands — issue command
  router.post(
    '/:id/commands',
    requireDeviceAccess(householdService, deviceService, 'id'),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const body = req.body as IssueCommandRequest;
        if (!body.commandType || !body.issuedBy) {
          res.status(400).json({ error: 'Missing required fields: commandType, issuedBy' });
          return;
        }
        const command = await deviceService.issueCommand(req.params.id, body);
        res.status(201).json(command);
      } catch (err) { next(err); }
    },
  );

  // GET /api/v1/devices/:id/commands — command history
  router.get(
    '/:id/commands',
    requireDeviceAccess(householdService, deviceService, 'id'),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const commands = await deviceService.getCommandHistory(req.params.id, limit);
        res.json({ data: commands, total: commands.length });
      } catch (err) { next(err); }
    },
  );

  return router;
}
