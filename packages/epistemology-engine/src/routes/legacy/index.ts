/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  /legacy/* — v3.0 backwards-compatible surface
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  The v3.0 endpoints (claim submit, sub-claim atomization, Bayesian update)
 *  live in `src/index.ts` today. They are kept verbatim through v3.1.x for
 *  backwards compatibility.
 *
 *  This file is a placeholder. In commit 2, we lift those handlers OUT of
 *  index.ts and into legacy-claim.ts / legacy-subclaim.ts here, then mount
 *  them on the existing root paths via `app.use(createLegacyRouter(...))`
 *  with NO path prefix. The legacy URLs do not change. Internally, we now
 *  see a clean separation between v3.0 and v3.1 surfaces.
 *
 *  Commit 1 keeps the original handlers in place to avoid breaking the
 *  build-and-test loop while the observability scaffold lands.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { Router } from 'express';

export function createLegacyRouter(): Router {
  const router: Router = express.Router();
  // Empty in commit 1. v3.0 handlers move here in commit 2.
  return router;
}
