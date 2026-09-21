/**
 * HomeFlow auth middleware — session + DID onboarding gates.
 *
 * Session stores only the internal user id. No OAuth tokens. No Google subject.
 */

import type { Request, Response, NextFunction } from 'express';
import type { UserService, User } from '../services/user.service.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

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
