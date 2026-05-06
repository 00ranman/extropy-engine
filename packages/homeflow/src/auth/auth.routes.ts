/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow Family Pilot, OAuth Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Endpoints:
 *    GET  /auth/google           start OAuth flow
 *    GET  /auth/google/callback  redirect target after Google consents
 *    POST /auth/logout           clear the session
 *    GET  /auth/me               return current user (or 401)
 *
 *  Google OAuth runs through passport with passport-google-oauth20. If
 *  GOOGLE_CLIENT_ID is not set we mount stub routes that return 503 with a
 *  helpful message; this lets the rest of the API stay testable without
 *  forcing every developer to provision OAuth credentials.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy, type Profile } from 'passport-google-oauth20';
import type { UserService, User } from '../services/user.service.js';
import { requireSession, type AuthedRequest } from './auth.middleware.js';

export interface AuthConfig {
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  baseUrl: string;
  callbackPath?: string;
  successRedirect?: string;
  failureRedirect?: string;
}

export function configurePassport(userService: UserService, config: AuthConfig): boolean {
  if (!config.googleClientId || !config.googleClientSecret) {
    return false;
  }
  const callbackURL = `${config.baseUrl}${config.callbackPath ?? '/auth/google/callback'}`;
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.googleClientId,
        clientSecret: config.googleClientSecret,
        callbackURL,
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: (err: Error | null, user?: User) => void,
      ) => {
        try {
          const email = profile.emails?.[0]?.value ?? '';
          const avatar = profile.photos?.[0]?.value ?? null;
          const user = await userService.upsertFromGoogle({
            googleSub: profile.id,
            email,
            displayName: profile.displayName || email || 'unknown',
            avatarUrl: avatar,
          });
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );

  passport.serializeUser((user: Express.User, done) => {
    done(null, (user as User).id);
  });
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await userService.findById(id);
      done(null, user ?? false);
    } catch (err) {
      done(err as Error);
    }
  });
  return true;
}

export function createAuthRoutes(userService: UserService, config: AuthConfig): Router {
  const router = Router();
  const enabled = configurePassport(userService, config);
  const successRedirect = config.successRedirect ?? '/';
  const failureRedirect = config.failureRedirect ?? '/?login=failed';

  if (!enabled) {
    router.get('/google', (_req: Request, res: Response) => {
      res.status(503).json({
        error: 'google_oauth_disabled',
        message:
          'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars to enable Google sign in',
      });
    });
    router.get('/google/callback', (_req: Request, res: Response) => {
      res.status(503).json({ error: 'google_oauth_disabled' });
    });
  } else {
    router.get(
      '/google',
      passport.authenticate('google', { scope: ['profile', 'email'] }),
    );
    router.get(
      '/google/callback',
      passport.authenticate('google', { failureRedirect }),
      (req: Request, res: Response) => {
        const passportUser = req.user as User | undefined;
        if (passportUser && passportUser.id) {
          (req.session as { userId?: string }).userId = passportUser.id;
        }
        res.redirect(successRedirect);
      },
    );
  }

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
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      did: user.did,
      publicKeyMultibase: user.publicKeyMultibase,
      genesisVertexId: user.genesisVertexId,
      onboarded: !!user.did,
    });
  });

  /**
   * Test only stub. Mounted only when HOMEFLOW_TEST_AUTH=1, lets the integration
   * tests create an authenticated session without round tripping through Google.
   */
  if (process.env.HOMEFLOW_TEST_AUTH === '1') {
    router.post('/_test/login', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = req.body as {
          googleSub?: string;
          email?: string;
          displayName?: string;
        };
        if (!body.googleSub) {
          res.status(400).json({ error: 'googleSub required' });
          return;
        }
        const user = await userService.upsertFromGoogle({
          googleSub: body.googleSub,
          email: body.email ?? `${body.googleSub}@example.com`,
          displayName: body.displayName ?? 'Test User',
          avatarUrl: null,
        });
        (req.session as { userId?: string }).userId = user.id;
        res.json({ ok: true, userId: user.id });
      } catch (err) { next(err); }
    });
  }

  return router;
}
