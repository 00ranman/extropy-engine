/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  /mesh/* — v3.1 observability routes
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  This router is the public surface of the redefined epistemology engine.
 *  Every endpoint reads from an EpistemologySource and returns OBSERVATIONS,
 *  not authoritative truth.
 *
 *  v3.1 commit 1: scaffold only. Each route returns 501 Not Implemented and
 *  lists the source method it will call. Bodies land in commit 2 (consensus,
 *  falsifiability) and commit 3 (sybil).
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { Router, Request, Response } from 'express';
import type { EpistemologySource } from '../../observability/index.js';

export interface MeshRouterDeps {
  source: EpistemologySource;
}

export function createMeshRouter(deps: MeshRouterDeps): Router {
  const router: Router = express.Router();

  router.get('/source', (_req: Request, res: Response) => {
    res.json({ kind: deps.source.kind });
  });

  // Wired in commit 2.
  router.get('/consensus/:claimId', (_req: Request, res: Response) => {
    res.status(501).json({
      error: 'not_implemented',
      planned: 'commit 2',
      sourceMethod: 'getClaimConsensus',
    });
  });

  router.get('/consensus/drift', (_req: Request, res: Response) => {
    res.status(501).json({
      error: 'not_implemented',
      planned: 'commit 2',
      sourceMethod: 'listConsensusDrift',
    });
  });

  router.get('/falsifiability', (_req: Request, res: Response) => {
    res.status(501).json({
      error: 'not_implemented',
      planned: 'commit 2',
      sourceMethod: 'computeFalsifiability',
    });
  });

  // Wired in commit 3.
  router.get('/sybil/rank', (_req: Request, res: Response) => {
    res.status(501).json({
      error: 'not_implemented',
      planned: 'commit 3',
      sourceMethod: 'listValidatorCoEdges + listValidatorDids',
    });
  });

  return router;
}
