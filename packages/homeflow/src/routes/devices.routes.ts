/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Device Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DeviceService } from '../services/device.service.js';
import type { RegisterDeviceRequest, IssueCommandRequest } from '../types/index.js';

export function createDeviceRoutes(deviceService: DeviceService): Router {
  const router = Router();

  // POST /api/v1/devices — register a new device
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as RegisterDeviceRequest;
      if (!body.householdId || !body.name || !body.type || !body.manufacturer || !body.model || !body.firmwareVersion) {
        res.status(400).json({ error: 'Missing required fields: householdId, name, type, manufacturer, model, firmwareVersion' });
        return;
      }
      const device = await deviceService.registerDevice(body);
      res.status(201).json(device);
    } catch (err) { next(err); }
  });

  // GET /api/v1/devices?householdId=&type=
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { householdId, type } = req.query as { householdId?: string; type?: string };
      if (!householdId) {
        res.status(400).json({ error: 'Query param householdId is required' });
        return;
      }
      const devices = await deviceService.listDevices(householdId, type);
      res.json({ data: devices, total: devices.length });
    } catch (err) { next(err); }
  });

  // GET /api/v1/devices/:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const device = await deviceService.getDevice(req.params.id);
      if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
      res.json(device);
    } catch (err) { next(err); }
  });

  // PATCH /api/v1/devices/:id
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const device = await deviceService.updateDevice(req.params.id, req.body);
      if (!device) { res.status(404).json({ error: 'Device not found' }); return; }
      res.json(device);
    } catch (err) { next(err); }
  });

  // DELETE /api/v1/devices/:id
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await deviceService.deleteDevice(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Device not found' }); return; }
      res.status(204).send();
    } catch (err) { next(err); }
  });

  // POST /api/v1/devices/:id/commands — issue command
  router.post('/:id/commands', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as IssueCommandRequest;
      if (!body.commandType || !body.issuedBy) {
        res.status(400).json({ error: 'Missing required fields: commandType, issuedBy' });
        return;
      }
      const command = await deviceService.issueCommand(req.params.id, body);
      res.status(201).json(command);
    } catch (err) { next(err); }
  });

  // GET /api/v1/devices/:id/commands — command history
  router.get('/:id/commands', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const commands = await deviceService.getCommandHistory(req.params.id, limit);
      res.json({ data: commands, total: commands.length });
    } catch (err) { next(err); }
  });

  return router;
}
