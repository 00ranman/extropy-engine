/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Entropy & Claims Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { EntropyService } from '../services/entropy.service.js';
import type { ClaimService } from '../services/claim.service.js';

export function createEntropyRoutes(
  entropyService: EntropyService,
  claimService: ClaimService,
): Router {
  const router = Router();

  // POST /api/v1/entropy/snapshot — take an entropy snapshot
  router.post('/snapshot', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { householdId } = req.body as { householdId: string };
      if (!householdId) {
        res.status(400).json({ error: 'Missing required field: householdId' });
        return;
      }
      const snapshot = await entropyService.takeSnapshot(householdId);
      res.status(201).json(snapshot);
    } catch (err) { next(err); }
  });

  // POST /api/v1/entropy/measure — measure entropy reduction and auto-generate claim
  router.post('/measure', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { householdId, causalCommandIds } = req.body as {
        householdId: string;
        causalCommandIds?: string[];
      };
      if (!householdId) {
        res.status(400).json({ error: 'Missing required field: householdId' });
        return;
      }

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
  });

  // GET /api/v1/entropy/:householdId/history
  router.get('/:householdId/history', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const history = await entropyService.getReductionHistory(req.params.householdId, limit);
      const cumulative = await entropyService.getCumulativeDeltaS(req.params.householdId);
      res.json({ data: history, total: history.length, cumulativeDeltaS: cumulative });
    } catch (err) { next(err); }
  });

  // GET /api/v1/claims/:householdId
  router.get('/claims/:householdId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const claims = await claimService.getClaimsHistory(req.params.householdId, limit);
      res.json({ data: claims, total: claims.length });
    } catch (err) { next(err); }
  });

  return router;
}
