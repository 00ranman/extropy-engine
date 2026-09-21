/**
 * HomeFlow auth routes — node DID only.
 *
 * Endpoints:
 *   POST /auth/session   open a session from a node-minted DID
 *   POST /auth/logout    clear the session
 *   GET  /auth/me        current user (or 401)
 *
 * No Google Auth. No OAuth. No KYC. Protocol identity is the DID minted when
 * you stand up your own node. Lose it without a backup → start over.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { UserService, User } from '../services/user.service.js';
import { requireSession, type AuthedRequest } from './auth.middleware.js';

export interface AuthConfig {
  /** Kept for bootstrap compatibility; unused (no OAuth). */
  baseUrl: string;
  successRedirect?: string;
  failureRedirect?: string;
}

const DID_RE = /^did:[a-z0-9]+:[A-Za-z0-9._%-]+$/i;

export function createAuthRoutes(userService: UserService, _config: AuthConfig): Router {
  const router = Router();

  /**
   * Open a session from a node-minted DID.
   * Body: { did: string, displayName?: string }
   */
  router.post('/session', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as { did?: string; displayName?: string };
      const did = (body.did ?? '').trim();
      if (!did || !DID_RE.test(did)) {
        res.status(400).json({
          error: 'invalid_did',
          message: 'Provide the DID minted by your own node (did:...). No Google Auth.',
        });
        return;
      }
      const user = await userService.upsertFromDid({
        did,
        displayName: body.displayName?.trim() || did,
      });
      (req.session as { userId?: string }).userId = user.id;
      res.json({
        ok: true,
        userId: user.id,
        did: user.did,
        displayName: user.displayName,
        onboarded: !!user.did,
      });
    } catch (err) {
      next(err);
    }
  });

  // Gone: Google OAuth. Keep 410 so old clients/diagrams fail loudly.
  router.get('/google', (_req: Request, res: Response) => {
    res.status(410).json({
      error: 'google_oauth_removed',
      message:
        'Google Auth was removed. Use POST /auth/session with your node-minted DID.',
    });
  });
  router.get('/google/callback', (_req: Request, res: Response) => {
    res.status(410).json({ error: 'google_oauth_removed' });
  });

  router.post('/logout', (req: Request, res: Response, next: NextFunction) => {
    req.session?.destroy((err) => {
      if (err) return next(err);
      res.json({ ok: true });
    });
  });

  router.get('/me', requireSession(userService), (req: AuthedRequest, res: Response) => {
    const user = req.hfUser as User;
    res.json({
      id: user.id,
      displayName: user.displayName,
      did: user.did,
      publicKeyMultibase: user.publicKeyMultibase,
      genesisVertexId: user.genesisVertexId,
      onboarded: !!user.did,
    });
  });

  /** Test-only stub. Mounted when HOMEFLOW_TEST_AUTH=1. */
  if (process.env.HOMEFLOW_TEST_AUTH === '1') {
    router.post('/_test/login', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body as { did?: string; displayName?: string };
        const did = (body.did ?? '').trim() || `did:extropy:test-${Date.now()}`;
        const user = await userService.upsertFromDid({
          did,
          displayName: body.displayName ?? 'Test User',
        });
        (req.session as { userId?: string }).userId = user.id;
        res.json({ ok: true, userId: user.id, did: user.did });
      } catch (err) {
        next(err);
      }
    });
  }

  return router;
}
