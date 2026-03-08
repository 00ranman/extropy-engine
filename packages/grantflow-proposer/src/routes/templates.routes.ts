/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  GrantFlow Proposer — Templates Router
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Express router for the /api/v1/templates endpoints.
 *
 *  Routes:
 *    GET  /api/v1/templates          — list all templates (optional ?sectionType=)
 *    POST /api/v1/templates          — create a template
 *    GET  /api/v1/templates/:id      — get a template by ID
 *    GET  /api/v1/templates/default/:sectionType — get the default template for a type
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { TemplateService } from '../services/template.service.js';
import type { SectionType } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

const VALID_SECTION_TYPES = [
  'EXECUTIVE_SUMMARY', 'PROJECT_NARRATIVE', 'BUDGET_JUSTIFICATION',
  'EVALUATION_PLAN', 'ORGANIZATIONAL_CAPACITY', 'LETTERS_OF_SUPPORT', 'REFERENCES',
] as const;

const CreateTemplateSchema = z.object({
  name:        z.string().min(1).max(255),
  sectionType: z.enum(VALID_SECTION_TYPES),
  content:     z.string().min(1),
  isDefault:   z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
//  Route Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the templates router with the template service injected.
 */
export function createTemplatesRoutes(templateService: TemplateService): Router {
  const router = Router();

  // ── GET /templates — List all templates ───────────────────────────────────
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sectionType = req.query.sectionType as SectionType | undefined;

      if (sectionType && !VALID_SECTION_TYPES.includes(sectionType as typeof VALID_SECTION_TYPES[number])) {
        res.status(400).json({
          error:      'Invalid sectionType',
          validTypes: VALID_SECTION_TYPES,
        });
        return;
      }

      const templates = await templateService.listTemplates(sectionType);
      res.json({ templates, count: templates.length });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /templates — Create a template ───────────────────────────────────
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = CreateTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', details: parsed.error.issues });
        return;
      }

      const template = await templateService.createTemplate(parsed.data);
      res.status(201).json({ template });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /templates/default/:sectionType — Get default template ────────────
  // Note: This route MUST come before /:id to avoid sectionType being treated as an ID
  router.get('/default/:sectionType', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sectionType = req.params.sectionType.toUpperCase() as SectionType;

      if (!VALID_SECTION_TYPES.includes(sectionType as typeof VALID_SECTION_TYPES[number])) {
        res.status(400).json({
          error:      'Invalid sectionType',
          validTypes: VALID_SECTION_TYPES,
        });
        return;
      }

      const template = await templateService.getDefaultTemplate(sectionType);
      if (!template) {
        res.status(404).json({ error: 'No default template found', sectionType });
        return;
      }

      res.json({ template });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /templates/:id — Get a template by ID ─────────────────────────────
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const template = await templateService.getTemplate(req.params.id);
      if (!template) {
        res.status(404).json({ error: 'Template not found', id: req.params.id });
        return;
      }
      res.json({ template });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
