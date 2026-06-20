/**
 * ===============================================================================
 *  Shared HTTP Security Helpers
 * ===============================================================================
 *
 *  Centralizes baseline hardening so every Express service gets the same
 *  protections: security headers (helmet), request rate limiting, a bounded
 *  JSON body parser, and an error handler that never leaks internals to clients.
 *
 *  Usage in a service factory:
 *
 *    import express from 'express';
 *    import { applyBaseSecurity, sanitizedErrorHandler } from '@extropy/contracts';
 *
 *    const app = express();
 *    applyBaseSecurity(app);          // helmet + rate limit + bounded json
 *    // ... mount routes ...
 *    app.use(sanitizedErrorHandler);  // last, after routes
 */

import type { Express, Request, Response, NextFunction, RequestHandler, ErrorRequestHandler } from 'express';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const IS_PROD = process.env.NODE_ENV === 'production';

export interface BaseSecurityOptions {
  /** Max JSON body size. Default '1mb'. */
  jsonLimit?: string;
  /** Rate limit window in milliseconds. Default 60_000 (1 minute). */
  rateWindowMs?: number;
  /** Max requests per window per IP. Default 300. */
  rateMax?: number;
  /** Trust the first proxy hop (needed behind the gateway). Default true. */
  trustProxy?: boolean;
  /** Skip mounting express.json(). Set true if the service needs a custom body parser. */
  skipJson?: boolean;
}

/**
 * Build a standalone rate limiter so individual routes (for example auth
 * endpoints) can apply a stricter budget than the global default.
 */
export function makeRateLimiter(windowMs: number, max: number): RequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'rate_limited' },
  });
}

/**
 * Apply baseline security middleware to an Express app. Call this immediately
 * after creating the app and before mounting routes.
 */
export function applyBaseSecurity(app: Express, opts: BaseSecurityOptions = {}): void {
  const {
    jsonLimit = '1mb',
    rateWindowMs = 60_000,
    rateMax = 300,
    trustProxy = true,
    skipJson = false,
  } = opts;

  if (trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(makeRateLimiter(rateWindowMs, rateMax));

  if (!skipJson) {
    app.use(express.json({ limit: jsonLimit }));
  }
}

/**
 * Error handler that logs the full error server-side but returns a generic
 * payload to the client. Mount this last, after all routes.
 */
export const sanitizedErrorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  console.error('Unhandled request error:', err);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ error: 'internal_error' });
};

/**
 * Convenience wrapper for a single route handler that funnels thrown errors
 * into the sanitized handler without leaking details.
 */
export function safeHandler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export { IS_PROD as SECURITY_IS_PROD };
