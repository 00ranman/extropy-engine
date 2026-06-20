/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Entropy & Claims Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  These routes feed the XP and token minting pipeline, so every endpoint runs
 *  behind requireSession (mounted in app.ts) and verifies the caller is a member
 *  of the target household before snapshots, measurements, or claim reads. This
 *  closes the unauthenticated value-creation path flagged in the audit.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Response, type NextFunction } from 'express';
import type { EntropyService } from '../services/entropy.service.js';
import type { ClaimService } from '../services/claim.service.js';
import type { HouseholdService } from '../services/household.service.js';
import type { AuthedRequest } from '../auth/auth.middleware.js';
import { requireHouseholdAccess } from '../auth/ownership.middleware.js';

export function createEntropyRoutes(
  entropyService: EntropyService,
  claimService: ClaimService,
  householdService: HouseholdService,
): Router {
  const router = Router();

  // POST /api/v1/entropy/snapshot — take an entropy snapshot
  router.post(
    '/snapshot',
    requireHouseholdAccess(householdService, { from: 'body', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const { householdId } = req.body as { householdId: string };
        const snapshot = await entropyService.takeSnapshot(householdId);
        res.status(201).json(snapshot);
      } catch (err) { next(err); }
    },
  );

  // POST /api/v1/entropy/measure — measure entropy reduction and auto-generate claim
  router.post(
    '/measure',
    requireHouseholdAccess(householdService, { from: 'body', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const { householdId, causalCommandIds } = req.body as {
          householdId: string;
          causalCommandIds?: string[];
        };

        const reduction = await entropyService.measureReduction(householdId, causalCommandIds);
        if (!reduction) {
          res.json({ message: 'No entropy reduction detected (ΔS ≤ 0 or insufficient snapshots)', deltaS: 0 });
          return;
        }

        // Auto-generate claim if ΔS > 0
        const { claimId, loopId } = await claimService.generateClaimFromReduction(reduction);

        res.status(201).json({
          reduction,
          claim: { claimId, loopId },
          message: `Entropy reduced by ${reduction.deltaS.toFixed(4)} J/K — claim submitted`,
        });
      } catch (err) { next(err); }
    },
  );

  // GET /api/v1/entropy/:householdId/history
  router.get(
    '/:householdId/history',
    requireHouseholdAccess(householdService, { from: 'param', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const history = await entropyService.getReductionHistory(req.params.householdId, limit);
        const cumulative = await entropyService.getCumulativeDeltaS(req.params.householdId);
        res.json({ data: history, total: history.length, cumulativeDeltaS: cumulative });
      } catch (err) { next(err); }
    },
  );

  // GET /api/v1/claims/:householdId
  router.get(
    '/claims/:householdId',
    requireHouseholdAccess(householdService, { from: 'param', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const claims = await claimService.getClaimsHistory(req.params.householdId, limit);
        res.json({ data: claims, total: claims.length });
      } catch (err) { next(err); }
    },
  );

  return router;
}
