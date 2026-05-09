/**
 * @module routes
 * Express router for the @extropy/ethics HTTP service.
 *
 * Endpoints:
 *   GET  /health          — liveness probe
 *   GET  /principles      — list all registered ethical principles
 *   POST /evaluate        — validate an ActionContext; persists audit record
 *   GET  /audit           — query the audit log (optional ?agentId=&limit=)
 */
import { Router, Request, Response, NextFunction } from 'express';
import { EthicsValidator } from './validator';
import { CORE_PRINCIPLES } from './principles';
import { insertAuditRecord, queryAuditLog } from './db';

export const router: Router = Router();

/** GET /health */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', package: '@extropy/ethics', timestamp: new Date().toISOString() });
});

/** GET /principles */
router.get('/principles', (_req: Request, res: Response) => {
  res.json({ principles: CORE_PRINCIPLES, count: CORE_PRINCIPLES.length });
});

/**
 * POST /evaluate
 * Body: { action: string; agentId: string; metadata?: Record<string, unknown> }
 * Response: ValidationResult + audit record id
 */
router.post(
  '/evaluate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { action, agentId, metadata } = req.body as {
        action?: string;
        agentId?: string;
        metadata?: Record<string, unknown>;
      };

      if (!action || typeof action !== 'string') {
        res.status(400).json({ error: '`action` (string) is required' });
        return;
      }
      if (!agentId || typeof agentId !== 'string') {
        res.status(400).json({ error: '`agentId` (string) is required' });
        return;
      }

      const context = { action, agentId, metadata };
      const validator = new EthicsValidator();
      const result = validator.validate(context);

      let auditId: string | null = null;
      try {
        auditId = await insertAuditRecord(context, result);
      } catch {
        // Non-fatal: DB may not be configured in all environments
      }

      res.status(result.passed ? 200 : 422).json({ ...result, auditId });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /audit
 * Query params: agentId? (string), limit? (integer, default 50)
 */
router.get(
  '/audit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
      const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
      const limit = isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 500);

      const records = await queryAuditLog(limit, agentId);
      res.json({ records, count: records.length });
    } catch (err) {
      next(err);
    }
  }
);
