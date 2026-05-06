/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow Family Pilot, Auth Middleware
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Two gates:
 *    requireSession  401 unless session.userId is set
 *    requireOnboarded  also 403 unless the user has completed DID onboarding
 *
 *  The session shape is intentionally tiny: only the internal user id, so we
 *  never store the Google access token or raw key material on the server.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { Request, Response, NextFunction } from 'express';
import type { UserService, User } from '../services/user.service.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User {
      id: string;
      googleSub: string;
      email: string;
      displayName: string;
      avatarUrl: string | null;
      did: string | null;
      publicKeyMultibase: string | null;
      publicKeyHex: string | null;
      vcJwt: string | null;
      genesisVertexId: string | null;
      createdAt: number;
      onboardedAt: number | null;
    }
  }
}

/**
 * Local request type augmented with the homeflow user. Avoids redeclaring the
 * global Express.User to keep passport's typings happy.
 */
export type AuthedRequest = Request & { hfUser?: User };

export function requireSession(userService: UserService) {
  return async function (req: AuthedRequest, res: Response, next: NextFunction) {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }
    const user = await userService.findById(userId);
    if (!user) {
      res.status(401).json({ error: 'session_user_not_found' });
      return;
    }
    req.hfUser = user;
    next();
  };
}

export function requireOnboarded(userService: UserService) {
  const session = requireSession(userService);
  return async function (req: AuthedRequest, res: Response, next: NextFunction) {
    let sessionPassed = false;
    await session(req, res, (err?: unknown) => {
      if (err) {
        next(err as Error);
        return;
      }
      sessionPassed = true;
    });
    if (!sessionPassed) return;
    if (!req.hfUser?.did) {
      res.status(403).json({ error: 'not_onboarded' });
      return;
    }
    next();
  };
}
