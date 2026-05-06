/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow Family Pilot, PSLL Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *    POST /api/v1/psll/append    append a signed entry
 *    GET  /api/v1/psll/me        list the caller's entries
 *    GET  /api/v1/psll/head      return the caller's last entry (for prevHash)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Response, type NextFunction } from 'express';
import type { UserService } from '../services/user.service.js';
import { PSLLService, PSLLError } from '../services/psll.service.js';
import { requireOnboarded, type AuthedRequest } from '../auth/auth.middleware.js';

export function createPSLLRoutes(
  userService: UserService,
  psllService: PSLLService,
): Router {
  const router = Router();

  router.post(
    '/append',
    requireOnboarded(userService),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const user = req.hfUser!;
        const body = req.body as {
          entry?: unknown;
          signature?: string;
          prevHash?: string;
          seq?: number;
          ts?: number;
        };
        if (body.entry === undefined || body.entry === null) {
          res.status(400).json({ error: 'entry required' });
          return;
        }
        if (!body.signature) {
          res.status(400).json({ error: 'signature required' });
          return;
        }
        if (!body.prevHash) {
          res.status(400).json({ error: 'prevHash required' });
          return;
        }
        if (typeof body.seq !== 'number' || typeof body.ts !== 'number') {
          res.status(400).json({ error: 'seq and ts must be numbers' });
          return;
        }
        const result = await psllService.append(
          { id: user.id, publicKeyHex: user.publicKeyHex },
          {
            entry: body.entry,
            signature: body.signature,
            prevHash: body.prevHash,
            seq: body.seq,
            ts: body.ts,
          },
        );
        res.status(201).json(result);
      } catch (err) {
        if (err instanceof PSLLError) {
          res.status(err.status).json({ error: err.message });
          return;
        }
        next(err);
      }
    },
  );

  router.get(
    '/me',
    requireOnboarded(userService),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const user = req.hfUser!;
        const since = parseInt(String(req.query.since ?? '0'), 10) || 0;
        const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 1000);
        const entries = await psllService.listSince(user.id, since, limit);
        res.json({ entries });
      } catch (err) { next(err); }
    },
  );

  router.get(
    '/head',
    requireOnboarded(userService),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const user = req.hfUser!;
        const head = await psllService.getLastEntry(user.id);
        res.json({
          seq: head?.seq ?? 0,
          hash: head?.hash ?? '0'.repeat(64),
        });
      } catch (err) { next(err); }
    },
  );

  return router;
}
