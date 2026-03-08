/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Submissions Router
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Routes:
 *    POST   /api/v1/submissions            — Create a submission pipeline entry
 *    GET    /api/v1/submissions            — List submissions (with filters)
 *    GET    /api/v1/submissions/:id        — Get a single submission
 *    PATCH  /api/v1/submissions/:id        — Update submission status
 *    POST   /api/v1/submissions/:id/submit — Trigger S2S submission to Grants.gov
 *    POST   /api/v1/submissions/:id/prepare — Prepare S2S XML package
 *    POST   /api/v1/submissions/:id/propose — Request proposal generation
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { SubmissionService } from '../services/submission.service.js';
import type { GrantsGovService } from '../services/grants-gov.service.js';
import type { ClaimService } from '../services/claim.service.js';
import type { GfSubmissionStatus, GfSubmissionFilters } from '../types/index.js';

export function createSubmissionRoutes(
  submissionService: SubmissionService,
  grantsGovService:  GrantsGovService,
  claimService:      ClaimService,
): Router {
  const router = Router();

  // ── POST /api/v1/submissions ─────────────────────────────────────────────

  /**
   * Create a new submission pipeline entry.
   *
   * Body: { opportunityId: string, profileId: string, notes?: string }
   * Returns: GfSubmission (201)
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { opportunityId, profileId, notes } = req.body as {
        opportunityId?: string;
        profileId?: string;
        notes?: string;
      };

      if (!opportunityId || !profileId) {
        res.status(400).json({
          error: 'opportunityId and profileId are required',
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      const submission = await submissionService.createSubmission({
        opportunityId,
        profileId,
        notes,
      });

      res.status(201).json(submission);
    } catch (err) {
      next(err);
    }
  });

  // ── GET /api/v1/submissions ──────────────────────────────────────────────

  /**
   * List submissions with optional filtering.
   *
   * Query params: profileId, opportunityId, status, limit, offset
   * Returns: { submissions: GfSubmission[], count: number }
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters: GfSubmissionFilters = {};

      if (req.query['profileId'])     filters.profileId     = req.query['profileId'] as string;
      if (req.query['opportunityId']) filters.opportunityId = req.query['opportunityId'] as string;
      if (req.query['status']) {
        const raw = req.query['status'] as string;
        filters.status = raw.includes(',')
          ? (raw.split(',') as GfSubmissionStatus[])
          : raw as GfSubmissionStatus;
      }

      const limit  = parseInt(req.query['limit'] as string ?? '50', 10);
      const offset = parseInt(req.query['offset'] as string ?? '0', 10);

      filters.limit  = isNaN(limit)  ? 50 : Math.min(limit, 200);
      filters.offset = isNaN(offset) ? 0 : offset;

      const submissions = await submissionService.getSubmissions(filters);
      res.json({ submissions, count: submissions.length });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /api/v1/submissions/:id ──────────────────────────────────────────

  /**
   * Get a single submission by UUID.
   *
   * Returns: GfSubmission (200) or 404
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const submission = await submissionService.getSubmission(req.params['id']);

      if (!submission) {
        res.status(404).json({
          error: `Submission ${req.params['id']} not found`,
          code:  'NOT_FOUND',
        });
        return;
      }

      res.json(submission);
    } catch (err) {
      next(err);
    }
  });

  // ── PATCH /api/v1/submissions/:id ────────────────────────────────────────

  /**
   * Update submission status in the pipeline.
   *
   * Body: { status: GfSubmissionStatus, notes?: string, actorId?: string }
   * Returns: Updated GfSubmission (200) or 400/404
   */
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, notes, actorId } = req.body as {
        status?: GfSubmissionStatus;
        notes?: string;
        actorId?: string;
      };

      if (!status) {
        res.status(400).json({
          error: 'status is required',
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      const validStatuses: GfSubmissionStatus[] = [
        'discovered', 'researching', 'drafting', 'review',
        'submitted', 'awarded', 'declined', 'withdrawn',
      ];

      if (!validStatuses.includes(status)) {
        res.status(400).json({
          error: `Invalid status "${status}". Must be one of: ${validStatuses.join(', ')}`,
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      const submission = await submissionService.updateStatus(
        req.params['id'],
        status,
        notes,
        actorId,
      );

      res.json(submission);
    } catch (err) {
      if ((err as Error).message.includes('Invalid status transition') ||
          (err as Error).message.includes('not found')) {
        res.status(400).json({
          error: (err as Error).message,
          code:  'INVALID_TRANSITION',
        });
        return;
      }
      next(err);
    }
  });

  // ── POST /api/v1/submissions/:id/prepare ────────────────────────────────

  /**
   * Prepare an S2S XML package for Grants.gov submission.
   *
   * Returns: { xml: string, submissionId: string } (200)
   */
  router.post('/:id/prepare', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const xml = await submissionService.prepareS2SPackage(req.params['id']);

      res.json({
        submissionId: req.params['id'],
        xml,
        preparedAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /api/v1/submissions/:id/propose ────────────────────────────────

  /**
   * Request proposal generation from grantflow-proposer.
   *
   * Returns: { proposalId: string } (200)
   */
  router.post('/:id/propose', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const proposalId = await submissionService.requestProposalGeneration(req.params['id']);

      res.json({
        submissionId: req.params['id'],
        proposalId,
        requestedAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /api/v1/submissions/:id/submit ─────────────────────────────────

  /**
   * Trigger S2S submission to Grants.gov.
   * Requires GRANTS_GOV_S2S_USER and GRANTS_GOV_S2S_PASS environment variables.
   *
   * Returns: { trackingNumber: string, submittedAt: string } (200) or 503
   */
  router.post('/:id/submit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const s2sUser = process.env['GRANTS_GOV_S2S_USER'];
      const s2sPass = process.env['GRANTS_GOV_S2S_PASS'];

      if (!s2sUser || !s2sPass) {
        res.status(503).json({
          error: 'S2S credentials not configured. Set GRANTS_GOV_S2S_USER and GRANTS_GOV_S2S_PASS.',
          code:  'CREDENTIALS_NOT_CONFIGURED',
        });
        return;
      }

      const submission = await submissionService.getSubmission(req.params['id']);
      if (!submission) {
        res.status(404).json({
          error: `Submission ${req.params['id']} not found`,
          code:  'NOT_FOUND',
        });
        return;
      }

      // Ensure we have an S2S package
      let xml = submission.s2sPackageXml;
      if (!xml) {
        xml = await submissionService.prepareS2SPackage(req.params['id']);
      }

      // Submit via S2S SOAP
      const { trackingNumber, submittedAt } = await grantsGovService.submitApplication(
        xml,
        { username: s2sUser, password: s2sPass, certPath: process.env['GRANTS_GOV_CERT_PATH'] },
      );

      // Update submission status and record tracking number
      await submissionService.setTrackingNumber(req.params['id'], trackingNumber);
      const updated = await submissionService.updateStatus(
        req.params['id'],
        'submitted',
        `Submitted via S2S — tracking: ${trackingNumber}`,
      );

      // Emit submission claim
      await claimService.emitSubmissionClaim({ ...updated, grantsGovTrackingNumber: trackingNumber });

      res.json({ trackingNumber, submittedAt, submission: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
