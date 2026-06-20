/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow Family Pilot, Ownership Middleware
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  requireSession proves who you are. These helpers prove you are allowed to
 *  touch a specific household. Without them any authenticated user could read or
 *  mutate any other family's household just by knowing or guessing its ID.
 *
 *  Ownership model for the pilot:
 *    A user's validator identity is their did:extropy DID. A household is owned by
 *    the validator that created it and is shared with everyone in
 *    member_validator_ids. The household service already encodes this with
 *      WHERE validator_id = $1 OR $1 = ANY(member_validator_ids)
 *    so membership is decided by the caller's DID, never by client-supplied
 *    validatorId values.
 *
 *  These helpers must run after requireSession so req.hfUser is populated.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from './auth.middleware.js';
import type { HouseholdService } from '../services/household.service.js';
import type { DeviceService } from '../services/device.service.js';

/**
 * The caller's validator identity. We use the DID as the stable validator key so
 * ownership cannot be forged through a client-chosen validatorId.
 */
export function callerValidatorId(req: AuthedRequest): string | null {
  return req.hfUser?.did ?? null;
}

/**
 * True when the authenticated caller is the household owner or a listed member.
 */
async function callerOwnsHousehold(
  householdService: HouseholdService,
  req: AuthedRequest,
  householdId: string,
): Promise<boolean> {
  const validatorId = callerValidatorId(req);
  if (!validatorId) return false;
  const household = await householdService.getHousehold(householdId);
  if (!household) return false;
  return (
    household.validatorId === validatorId ||
    household.memberValidatorIds.includes(validatorId as never)
  );
}

/**
 * Guard a route that targets a household. Resolves the household id from the
 * given source and 403s unless the caller is a member. 404s when the household
 * does not exist so we do not leak existence to non-members beyond a generic
 * forbidden where it matters.
 */
export function requireHouseholdAccess(
  householdService: HouseholdService,
  source: { from: 'param' | 'query' | 'body'; key: string },
) {
  return async function (req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const bag =
        source.from === 'param'
          ? (req.params as Record<string, string>)
          : source.from === 'query'
          ? (req.query as Record<string, string>)
          : (req.body as Record<string, string>);
      const householdId = bag?.[source.key];
      if (!householdId) {
        res.status(400).json({ error: `Missing ${source.from} field: ${source.key}` });
        return;
      }
      const household = await householdService.getHousehold(householdId);
      if (!household) {
        res.status(404).json({ error: 'Household not found' });
        return;
      }
      const validatorId = callerValidatorId(req);
      const allowed =
        !!validatorId &&
        (household.validatorId === validatorId ||
          household.memberValidatorIds.includes(validatorId as never));
      if (!allowed) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      next();
    } catch (err) {
      next(err as Error);
    }
  };
}

/**
 * Guard a device-scoped route. Resolves the device, finds its household, and
 * defers to the household membership check.
 */
export function requireDeviceAccess(
  householdService: HouseholdService,
  deviceService: DeviceService,
  paramKey = 'id',
) {
  return async function (req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const deviceId = (req.params as Record<string, string>)?.[paramKey];
      if (!deviceId) {
        res.status(400).json({ error: `Missing param: ${paramKey}` });
        return;
      }
      const device = await deviceService.getDevice(deviceId);
      if (!device) {
        res.status(404).json({ error: 'Device not found' });
        return;
      }
      if (!(await callerOwnsHousehold(householdService, req, device.householdId))) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      next();
    } catch (err) {
      next(err as Error);
    }
  };
}

/**
 * Guard a zone-scoped route. Resolves the zone, finds its household, and defers
 * to the household membership check.
 */
export function requireZoneAccess(householdService: HouseholdService, paramKey = 'id') {
  return async function (req: AuthedRequest, res: Response, next: NextFunction) {
    try {
      const zoneId = (req.params as Record<string, string>)?.[paramKey];
      if (!zoneId) {
        res.status(400).json({ error: `Missing param: ${paramKey}` });
        return;
      }
      const zone = await householdService.getZone(zoneId);
      if (!zone) {
        res.status(404).json({ error: 'Zone not found' });
        return;
      }
      if (!(await callerOwnsHousehold(householdService, req, zone.householdId))) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      next();
    } catch (err) {
      next(err as Error);
    }
  };
}
