// @ts-nocheck
/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  GrantFlow Proposer — Proposals Router
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Express router for the /api/v1/proposals endpoints.
 *  All routes are async and handle errors via the global error handler.
 *
 *  Routes:
 *    POST   /api/v1/proposals                               — create proposal
 *    GET    /api/v1/proposals                               — list proposals
 *    GET    /api/v1/proposals/:id                           — get proposal
 *    PATCH  /api/v1/proposals/:id                           — update proposal
 *    POST   /api/v1/proposals/:id/sections                  — add section
 *    PATCH  /api/v1/proposals/:id/sections/:sectionId       — update section
 *    POST   /api/v1/proposals/:id/generate                  — generate full proposal
 *    POST   /api/v1/proposals/:id/generate/:sectionType     — generate one section
 *    POST   /api/v1/proposals/:id/refine                    — refine a section
 *    GET    /api/v1/proposals/:id/export                    — export proposal
 *    GET    /api/v1/proposals/:id/quality                   — quality report
 *    GET    /api/v1/proposals/:id/claims                    — list claims
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { ProposalService } from '../services/proposal.service.js';
import type { SectionService } from '../services/section.service.js';
import type { GenerationService } from '../services/generation.service.js';
import type { ExportService } from '../services/export.service.js';
import type { ClaimService } from '../services/claim.service.js';
import type { SectionType, GenerationContext } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

const CreateProposalSchema = z.object({
  submissionId:           z.string().min(1),
  opportunityTitle:       z.string().min(1),
  agency:                 z.string().min(1),
  opportunityNumber:      z.string().optional(),
  principalInvestigator:  z.string().optional(),
  requestedAmount:        z.number().positive().optional(),
  proposalDuration:       z.string().optional(),
});

const UpdateProposalSchema = z.object({
  opportunityTitle:       z.string().min(1).optional(),
  agency:                 z.string().min(1).optional(),
  opportunityNumber:      z.string().optional(),
  principalInvestigator:  z.string().optional(),
  requestedAmount:        z.number().positive().optional(),
  proposalDuration:       z.string().optional(),
  status:                 z.enum(['draft', 'generating', 'complete', 'exported']).optional(),
});

const AddSectionSchema = z.object({
  sectionType:    z.enum([
    'EXECUTIVE_SUMMARY', 'PROJECT_NARRATIVE', 'BUDGET_JUSTIFICATION',
    'EVALUATION_PLAN', 'ORGANIZATIONAL_CAPACITY', 'LETTERS_OF_SUPPORT', 'REFERENCES',
  ]),
  content:        z.string().min(1),
  isAiGenerated:  z.boolean().optional(),
});

const UpdateSectionSchema = z.object({
  content: z.string().min(1),
});

const GenerateSchema = z.object({
  context: z.object({
    opportunity: z.object({
      title:                    z.string().optional(),
      agency:                   z.string().optional(),
      opportunityNumber:        z.string().optional(),
      synopsis:                 z.string().optional(),
      objectives:               z.array(z.string()).optional(),
      eligibilityRequirements:  z.string().optional(),
      awardAmount:              z.number().optional(),
      duration:                 z.string().optional(),
      closeDate:                z.string().optional(),
      cfda:                     z.string().optional(),
    }).optional(),
    profile: z.object({
      principalInvestigator:  z.string(),
      institution:            z.string().optional(),
      department:             z.string().optional(),
      expertise:              z.array(z.string()).optional(),
      priorWork:              z.string().optional(),
      publications:           z.array(z.string()).optional(),
      currentProjects:        z.array(z.string()).optional(),
      budget:                 z.number().optional(),
      duration:               z.string().optional(),
    }).optional(),
    instructions: z.string().optional(),
  }).optional(),
  validatorId: z.string().optional(),
});

const RefineSchema = z.object({
  sectionId:    z.string().min(1),
  instructions: z.string().min(1),
  validatorId:  z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
//  Route Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the proposals router with all dependencies injected.
 */
export function createProposalsRoutes(
  proposalService:   ProposalService,
  sectionService:    SectionService,
  generationService: GenerationService,
  exportService:     ExportService,
  claimService:      ClaimService,
): Router {
  const router = Router();

  // ── POST /proposals — Create a new proposal ────────────────────────────────
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateProposalSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      const proposal = await proposalService.createProposal(parsed.data);

      // Emit draft claim
      const validatorId = (req.headers['x-validator-id'] as string) ?? 'grantflow-proposer';
      await claimService.emitDraftClaim(proposal, validatorId).catch(err =>
        console.warn('[proposer:routes] Draft claim failed:', err),
      );

      res.status(201).json({ proposal });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /proposals — List proposals ───────────────────────────────────────
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = {
        submissionId: req.query.submissionId as string | undefined,
        status:       req.query.status as string | undefined,
        agency:       req.query.agency as string | undefined,
        limit:        req.query.limit  ? parseInt(req.query.limit  as string, 10) : undefined,
        offset:       req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      };

      const proposals = await proposalService.listProposals(filters);
      res.json({ proposals, count: proposals.length });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /proposals/:id — Get proposal with sections ──────────────────────
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const proposal = await proposalService.getProposal(req.params.id);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found', id: req.params.id });
        return;
      }
      res.json({ proposal });
    } catch (err) {
      next(err);
    }
  });

  // ── PATCH /proposals/:id — Update proposal metadata ──────────────────────
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UpdateProposalSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      const proposal = await proposalService.updateProposal(req.params.id, parsed.data);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found', id: req.params.id });
        return;
      }
      res.json({ proposal });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /proposals/:id/sections — Add a section ──────────────────────────
  router.post('/:id/sections', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = AddSectionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      // Validate proposal exists
      const proposal = await proposalService.getProposal(req.params.id);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found', id: req.params.id });
        return;
      }

      const section = await sectionService.addSection(req.params.id, parsed.data);

      // Score the section
      const score = generationService.computeQualityScore(
        section.content, section.sectionType,
      );
      await sectionService.setQualityScore(section.id, score);
      section.qualityScore = score;

      // Update proposal quality
      await proposalService.recomputeQualityScore(req.params.id);

      // Emit section claim
      const validatorId = (req.headers['x-validator-id'] as string) ?? 'grantflow-proposer';
      const updatedProposal = await proposalService.getProposal(req.params.id);
      if (updatedProposal) {
        await claimService.emitSectionClaim(updatedProposal, section, validatorId).catch(err =>
          console.warn('[proposer:routes] Section claim failed:', err),
        );
      }

      res.status(201).json({ section });
    } catch (err) {
      next(err);
    }
  });

  // ── PATCH /proposals/:id/sections/:sectionId — Update section ────────────
  router.patch('/:id/sections/:sectionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = UpdateSectionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      const section = await sectionService.updateSection(
        req.params.id,
        req.params.sectionId,
        parsed.data,
      );
      if (!section) {
        res.status(404).json({ error: 'Section not found', sectionId: req.params.sectionId });
        return;
      }

      // Re-score
      const score = generationService.computeQualityScore(section.content, section.sectionType);
      await sectionService.setQualityScore(section.id, score);
      section.qualityScore = score;

      await proposalService.recomputeQualityScore(req.params.id);

      res.json({ section });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /proposals/:id/generate — Generate full proposal ─────────────────
  router.post('/:id/generate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = GenerateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      const proposal = await proposalService.getProposal(req.params.id);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found', id: req.params.id });
        return;
      }

      // Build context, merging proposal data with provided context
      const context: GenerationContext = {
        opportunity: {
          title:   proposal.opportunityTitle,
          agency:  proposal.agency,
          opportunityNumber: proposal.opportunityNumber,
          ...(parsed.data.context?.opportunity ?? {}),
        },
        profile: parsed.data.context?.profile,
        instructions: parsed.data.context?.instructions,
      };

      // Generate asynchronously — respond immediately, generation runs in background
      const validatorId = (req.headers['x-validator-id'] as string) ?? parsed.data.validatorId ?? 'grantflow-proposer';

      // Fire-and-forget the generation
      generationService.generateFullProposal(req.params.id, context).then(async (sections) => {
        // Emit section claims for each generated section
        const updatedProposal = await proposalService.getProposal(req.params.id);
        if (updatedProposal) {
          for (const section of sections) {
            await claimService.emitSectionClaim(updatedProposal, section, validatorId)
              .catch(err => console.warn('[proposer:routes] Section claim failed:', err));
          }
        }
      }).catch(err => console.error('[proposer:routes] Generation failed:', err));

      res.status(202).json({
        message: 'Proposal generation started',
        proposalId: req.params.id,
        status: 'generating',
      });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /proposals/:id/generate/:sectionType — Generate one section ───────
  router.post('/:id/generate/:sectionType', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sectionType = req.params.sectionType.toUpperCase() as SectionType;
      const validSectionTypes = [
        'EXECUTIVE_SUMMARY', 'PROJECT_NARRATIVE', 'BUDGET_JUSTIFICATION',
        'EVALUATION_PLAN', 'ORGANIZATIONAL_CAPACITY', 'LETTERS_OF_SUPPORT', 'REFERENCES',
      ];

      if (!validSectionTypes.includes(sectionType)) {
        res.status(400).json({ error: 'Invalid section type', validTypes: validSectionTypes });
        return;
      }

      const parsed = GenerateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      const proposal = await proposalService.getProposal(req.params.id);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found', id: req.params.id });
        return;
      }

      const context: GenerationContext = {
        opportunity: {
          title:  proposal.opportunityTitle,
          agency: proposal.agency,
          opportunityNumber: proposal.opportunityNumber,
          ...(parsed.data.context?.opportunity ?? {}),
        },
        profile:      parsed.data.context?.profile,
        instructions: parsed.data.context?.instructions,
      };

      const section = await generationService.generateSection(req.params.id, sectionType, context);

      const validatorId = (req.headers['x-validator-id'] as string) ?? 'grantflow-proposer';
      await claimService.emitSectionClaim(proposal, section, validatorId).catch(err =>
        console.warn('[proposer:routes] Section claim failed:', err),
      );

      res.status(201).json({ section });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /proposals/:id/refine — Refine a section ─────────────────────────
  router.post('/:id/refine', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = RefineSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      const proposal = await proposalService.getProposal(req.params.id);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found', id: req.params.id });
        return;
      }

      const refinement = await generationService.refineSection(
        req.params.id,
        parsed.data.sectionId,
        parsed.data.instructions,
      );

      const validatorId = (req.headers['x-validator-id'] as string) ?? parsed.data.validatorId ?? 'grantflow-proposer';

      // Emit refinement claim
      await claimService.emitRefinementClaim(proposal, refinement, validatorId).catch(err =>
        console.warn('[proposer:routes] Refinement claim failed:', err),
      );

      // Return updated proposal
      const updatedProposal = await proposalService.getProposal(req.params.id);
      res.json({ refinement, proposal: updatedProposal });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /proposals/:id/export — Export proposal ───────────────────────────
  router.get('/:id/export', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const format = (req.query.format as string) ?? 'markdown';

      if (format !== 'markdown' && format !== 'text') {
        res.status(400).json({ error: 'Invalid format. Use: markdown or text' });
        return;
      }

      const proposal = await proposalService.getProposal(req.params.id);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found', id: req.params.id });
        return;
      }

      let content: string;
      let contentType: string;
      let filename: string;

      if (format === 'markdown') {
        content     = await exportService.exportToMarkdown(req.params.id);
        contentType = 'text/markdown';
        filename    = `proposal-${req.params.id.slice(0, 8)}.md`;
      } else {
        content     = await exportService.exportToText(req.params.id);
        contentType = 'text/plain';
        filename    = `proposal-${req.params.id.slice(0, 8)}.txt`;
      }

      // Update proposal status to exported
      await proposalService.setStatus(req.params.id, 'exported');

      // Emit export claim
      const validatorId = (req.headers['x-validator-id'] as string) ?? 'grantflow-proposer';
      const exported = await proposalService.getProposal(req.params.id);
      if (exported) {
        await claimService.emitExportClaim(exported, validatorId).catch(err =>
          console.warn('[proposer:routes] Export claim failed:', err),
        );
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (err) {
      next(err);
    }
  });

  // ── GET /proposals/:id/quality — Quality report ───────────────────────────
  router.get('/:id/quality', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const proposal = await proposalService.getProposal(req.params.id);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found', id: req.params.id });
        return;
      }

      const report = await generationService.computeProposalQuality(req.params.id);
      res.json({ proposalId: req.params.id, report });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /proposals/:id/claims — List claims ───────────────────────────────
  router.get('/:id/claims', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const claims = await claimService.getClaimsForProposal(req.params.id);
      res.json({ claims, count: claims.length });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /proposals/:id/sections/:sectionId/refinements — Refinement history
  router.get('/:id/sections/:sectionId/refinements', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refinements = await generationService.getRefinements(
        req.params.id,
        req.params.sectionId,
      );
      res.json({ refinements, count: refinements.length });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
