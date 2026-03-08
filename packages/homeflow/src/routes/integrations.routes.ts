/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Integrations Routes (Governance, Temporal, Tokens, Credentials, DAG)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import type { GovernanceIntegration } from '../integrations/governance.integration.js';
import type { TemporalIntegration } from '../integrations/temporal.integration.js';
import type { TokenIntegration } from '../integrations/token.integration.js';
import type { CredentialIntegration } from '../integrations/credential.integration.js';
import type { DAGIntegration } from '../integrations/dag.integration.js';
import type { ReputationIntegration } from '../integrations/reputation.integration.js';
import type { CreateScheduleRequest } from '../types/index.js';

export function createIntegrationRoutes(deps: {
  governance: GovernanceIntegration;
  temporal: TemporalIntegration;
  token: TokenIntegration;
  credential: CredentialIntegration;
  dag: DAGIntegration;
  reputation: ReputationIntegration;
}): Router {
  const router = Router();

  // ── Governance ─────────────────────────────────────────────────────────

  // POST /api/v1/governance/dfao — create household DFAO
  router.post('/governance/dfao', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { householdId, householdName, founderValidatorId } = req.body;
      if (!householdId || !householdName || !founderValidatorId) {
        res.status(400).json({ error: 'Missing: householdId, householdName, founderValidatorId' });
        return;
      }
      const result = await deps.governance.createHouseholdDFAO(householdId, householdName, founderValidatorId);
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  // POST /api/v1/governance/proposals
  router.post('/governance/proposals', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { householdId, proposerId, title, description, changes } = req.body;
      const result = await deps.governance.submitProposal(householdId, proposerId, title, description, changes);
      res.status(201).json(result);
    } catch (err) { next(err); }
  });

  // ── Schedules (Temporal) ───────────────────────────────────────────────

  // POST /api/v1/schedules
  router.post('/schedules', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreateScheduleRequest;
      if (!body.householdId || !body.name || !body.type || !body.actions) {
        res.status(400).json({ error: 'Missing: householdId, name, type, actions' });
        return;
      }
      const schedule = await deps.temporal.createSchedule(body);
      res.status(201).json(schedule);
    } catch (err) { next(err); }
  });

  // GET /api/v1/schedules?householdId=
  router.get('/schedules', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { householdId } = req.query as { householdId: string };
      if (!householdId) { res.status(400).json({ error: 'Query param householdId required' }); return; }
      const schedules = await deps.temporal.listSchedules(householdId);
      res.json({ data: schedules, total: schedules.length });
    } catch (err) { next(err); }
  });

  // PATCH /api/v1/schedules/:id/toggle
  router.patch('/schedules/:id/toggle', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { enabled } = req.body as { enabled: boolean };
      await deps.temporal.toggleSchedule(req.params.id, enabled);
      res.json({ scheduleId: req.params.id, enabled });
    } catch (err) { next(err); }
  });

  // POST /api/v1/schedules/:id/execute
  router.post('/schedules/:id/execute', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const commandIds = await deps.temporal.executeSchedule(req.params.id);
      res.json({ scheduleId: req.params.id, commandsIssued: commandIds });
    } catch (err) { next(err); }
  });

  // DELETE /api/v1/schedules/:id
  router.delete('/schedules/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await deps.temporal.deleteSchedule(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Schedule not found' }); return; }
      res.status(204).send();
    } catch (err) { next(err); }
  });

  // GET /api/v1/temporal/patterns?householdId=
  router.get('/temporal/patterns', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { householdId } = req.query as { householdId: string };
      if (!householdId) { res.status(400).json({ error: 'Query param householdId required' }); return; }
      const patterns = await deps.temporal.detectSeasonalPatterns(householdId);
      res.json({ data: patterns, total: patterns.length });
    } catch (err) { next(err); }
  });

  // ── Tokens ─────────────────────────────────────────────────────────────

  // GET /api/v1/tokens/:householdId
  router.get('/tokens/:householdId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const balances = await deps.token.getTokenBalances(req.params.householdId);
      res.json({ householdId: req.params.householdId, balances });
    } catch (err) { next(err); }
  });

  // GET /api/v1/tokens/:householdId/history
  router.get('/tokens/:householdId/history', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const history = await deps.token.getTokenHistory(req.params.householdId, limit);
      res.json({ data: history, total: history.length });
    } catch (err) { next(err); }
  });

  // ── Credentials ────────────────────────────────────────────────────────

  // GET /api/v1/credentials/:householdId
  router.get('/credentials/:householdId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const credentials = await deps.credential.getCredentials(req.params.householdId);
      res.json({ data: credentials, total: credentials.length });
    } catch (err) { next(err); }
  });

  // ── Reputation ─────────────────────────────────────────────────────────

  // GET /api/v1/reputation/:validatorId
  router.get('/reputation/:validatorId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reputation = await deps.reputation.getReputation(req.params.validatorId);
      res.json(reputation);
    } catch (err) { next(err); }
  });

  // GET /api/v1/reputation/leaderboard
  router.get('/reputation/leaderboard', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const leaderboard = await deps.reputation.getLeaderboard(limit);
      res.json({ data: leaderboard, total: leaderboard.length });
    } catch (err) { next(err); }
  });

  // ── DAG ────────────────────────────────────────────────────────────────

  // GET /api/v1/dag/:householdId
  router.get('/dag/:householdId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const refs = await deps.dag.getDAGReferences(req.params.householdId, limit);
      res.json({ data: refs, total: refs.length });
    } catch (err) { next(err); }
  });

  return router;
}
