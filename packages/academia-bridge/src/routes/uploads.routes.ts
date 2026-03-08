/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Academia Bridge | Uploads Routes
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Express router for upload history endpoints:
 *
 *  GET /api/v1/uploads        — list all upload attempts
 *  GET /api/v1/uploads/:id    — get a specific upload record
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response } from 'express';
import type { UploadService } from '../services/upload.service.js';

/**
 * Create the uploads router with injected service dependencies.
 *
 * @param uploadService - Upload execution history
 * @returns Express Router
 */
export function createUploadsRoutes(uploadService: UploadService): Router {
  const router = Router();

  // ─────────────────────────────────────────────────────────────────────────
  //  GET /api/v1/uploads — list upload history
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @openapi
   * /api/v1/uploads:
   *   get:
   *     summary: List all upload attempts, most recent first
   *     tags: [Uploads]
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 50
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   *     responses:
   *       200:
   *         description: List of upload records
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 uploads:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/AbUpload'
   *                 count:
   *                   type: integer
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const limit  = req.query.limit  ? parseInt(req.query.limit  as string, 10) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      const uploads = await uploadService.listUploads(limit, offset);
      res.json({ uploads, count: uploads.length });
    } catch (err) {
      console.error('[academia-bridge] GET /uploads error:', err);
      res.status(500).json({ error: 'Failed to list uploads', details: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  GET /api/v1/uploads/:id — get upload details
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @openapi
   * /api/v1/uploads/{id}:
   *   get:
   *     summary: Get a specific upload record by ID
   *     tags: [Uploads]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: Upload record
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AbUpload'
   *       404:
   *         description: Upload not found
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const upload = await uploadService.getUpload(req.params.id);
      if (!upload) {
        res.status(404).json({ error: `Upload ${req.params.id} not found` });
        return;
      }
      res.json(upload);
    } catch (err) {
      console.error(`[academia-bridge] GET /uploads/${req.params.id} error:`, err);
      res.status(500).json({ error: 'Failed to get upload', details: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  GET /api/v1/uploads/session/status — browser session status
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @openapi
   * /api/v1/uploads/session/status:
   *   get:
   *     summary: Check whether academia.edu credentials are configured
   *     tags: [Uploads]
   *     responses:
   *       200:
   *         description: Session status
   */
  router.get('/session/status', async (_req: Request, res: Response) => {
    try {
      const status = uploadService.getSessionStatus();
      res.json(status);
    } catch (err) {
      console.error('[academia-bridge] GET /uploads/session/status error:', err);
      res.status(500).json({ error: 'Failed to get session status', details: String(err) });
    }
  });

  return router;
}
