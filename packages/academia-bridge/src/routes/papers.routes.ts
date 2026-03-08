/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Academia Bridge | Papers Routes
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Express router for paper management endpoints:
 *
 *  POST   /api/v1/papers              — queue paper for upload
 *  GET    /api/v1/papers              — list papers (with optional status filter)
 *  GET    /api/v1/papers/:id          — get paper details
 *  PATCH  /api/v1/papers/:id          — update paper metadata
 *  DELETE /api/v1/papers/:id          — remove paper from queue
 *  POST   /api/v1/papers/:id/upload   — trigger upload to academia.edu
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response } from 'express';
import type { PaperService } from '../services/paper.service.js';
import type { UploadService } from '../services/upload.service.js';
import type { ClaimService } from '../services/claim.service.js';
import type { AbPaper, ListPapersFilters } from '../types/index.js';

/**
 * Create the papers router with injected service dependencies.
 *
 * @param paperService  - Paper queue management
 * @param uploadService - Academia.edu upload automation
 * @param claimService  - Entropy claim generation
 * @returns Express Router
 */
export function createPapersRoutes(
  paperService: PaperService,
  uploadService: UploadService,
  claimService: ClaimService,
): Router {
  const router = Router();

  // ─────────────────────────────────────────────────────────────────────────
  //  POST /api/v1/papers — queue a paper for upload
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @openapi
   * /api/v1/papers:
   *   post:
   *     summary: Queue a paper for upload to academia.edu
   *     tags: [Papers]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreatePaperDto'
   *     responses:
   *       201:
   *         description: Paper queued successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AbPaper'
   *       400:
   *         description: Validation error
   *       500:
   *         description: Internal server error
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const paper = await paperService.queuePaper(req.body);

      // Fire-and-forget: emit queue claim (non-blocking)
      claimService.emitQueueClaim(paper).catch(err =>
        console.error('[academia-bridge] Queue claim emission failed:', err),
      );

      res.status(201).json(paper);
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        res.status(400).json({ error: 'Validation error', details: String(err) });
      } else {
        console.error('[academia-bridge] POST /papers error:', err);
        res.status(500).json({ error: 'Failed to queue paper', details: String(err) });
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  GET /api/v1/papers — list papers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @openapi
   * /api/v1/papers:
   *   get:
   *     summary: List papers with optional filtering
   *     tags: [Papers]
   *     parameters:
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [queued, uploading, uploaded, failed]
   *       - in: query
   *         name: sourceProposalId
   *         schema:
   *           type: string
   *           format: uuid
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
   *         description: List of papers
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const filters: ListPapersFilters = {};

      if (req.query.status) {
        const validStatuses = ['queued', 'uploading', 'uploaded', 'failed'] as const;
        const status = req.query.status as string;
        if (!validStatuses.includes(status as AbPaper['status'])) {
          res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
          return;
        }
        filters.status = status as AbPaper['status'];
      }

      if (req.query.sourceProposalId) {
        filters.sourceProposalId = req.query.sourceProposalId as string;
      }

      if (req.query.limit) {
        filters.limit = parseInt(req.query.limit as string, 10);
      }

      if (req.query.offset) {
        filters.offset = parseInt(req.query.offset as string, 10);
      }

      const papers = await paperService.listPapers(filters);
      res.json({ papers, count: papers.length });
    } catch (err) {
      console.error('[academia-bridge] GET /papers error:', err);
      res.status(500).json({ error: 'Failed to list papers', details: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  GET /api/v1/papers/:id — get paper details
  // ─────────────────────────────────────────────────────────────────────────

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const paper = await paperService.getPaper(req.params.id);
      if (!paper) {
        res.status(404).json({ error: `Paper ${req.params.id} not found` });
        return;
      }
      res.json(paper);
    } catch (err) {
      console.error(`[academia-bridge] GET /papers/${req.params.id} error:`, err);
      res.status(500).json({ error: 'Failed to get paper', details: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  PATCH /api/v1/papers/:id — update paper metadata
  // ─────────────────────────────────────────────────────────────────────────

  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const paper = await paperService.updatePaper(req.params.id, req.body);
      if (!paper) {
        res.status(404).json({ error: `Paper ${req.params.id} not found` });
        return;
      }
      res.json(paper);
    } catch (err) {
      console.error(`[academia-bridge] PATCH /papers/${req.params.id} error:`, err);
      res.status(500).json({ error: 'Failed to update paper', details: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  DELETE /api/v1/papers/:id — remove paper from queue
  // ─────────────────────────────────────────────────────────────────────────

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const deleted = await paperService.deletePaper(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: `Paper ${req.params.id} not found` });
        return;
      }
      res.status(204).send();
    } catch (err) {
      if (err instanceof Error && err.message.includes('Cannot delete')) {
        res.status(409).json({ error: err.message });
        return;
      }
      console.error(`[academia-bridge] DELETE /papers/${req.params.id} error:`, err);
      res.status(500).json({ error: 'Failed to delete paper', details: String(err) });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  POST /api/v1/papers/:id/upload — trigger upload to academia.edu
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Trigger the Playwright browser automation to upload the paper.
   * This is a long-running operation (30-120 seconds). The response is
   * returned synchronously with the result when the upload completes.
   *
   * For production use, consider wrapping this in an async job queue.
   */
  router.post('/:id/upload', async (req: Request, res: Response) => {
    try {
      const paper = await paperService.getPaper(req.params.id);
      if (!paper) {
        res.status(404).json({ error: `Paper ${req.params.id} not found` });
        return;
      }

      if (paper.status === 'uploading') {
        res.status(409).json({ error: 'Upload already in progress for this paper' });
        return;
      }

      // Execute upload (synchronous — may take 30-120 seconds)
      const result = await uploadService.uploadPaper(req.params.id);

      if (result.success && result.academiaUrl) {
        // Emit upload claim — paper is now public
        const updatedPaper = await paperService.getPaper(req.params.id);
        if (updatedPaper && result.uploadId) {
          const upload = await uploadService.getUpload(result.uploadId);
          if (upload) {
            claimService.emitUploadClaim(updatedPaper, upload).catch(err =>
              console.error('[academia-bridge] Upload claim emission failed:', err),
            );
          }
        }

        res.json({
          success:     true,
          uploadId:    result.uploadId,
          academiaUrl: result.academiaUrl,
          retryCount:  result.retryCount,
        });
      } else {
        res.status(500).json({
          success:      false,
          uploadId:     result.uploadId,
          errorMessage: result.errorMessage,
          retryCount:   result.retryCount,
        });
      }
    } catch (err) {
      console.error(`[academia-bridge] POST /papers/${req.params.id}/upload error:`, err);
      res.status(500).json({ error: 'Upload failed', details: String(err) });
    }
  });

  return router;
}
