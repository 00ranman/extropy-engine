/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Integrations Routes (Governance, Temporal, Tokens, Credentials, DAG)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Runs behind requireSession (mounted in app.ts). Every endpoint that targets a
 *  household verifies the caller is a member. Schedule-by-id routes resolve the
 *  schedule's household first so a caller cannot toggle, execute, or delete
 *  another family's automation.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Response, type NextFunction } from 'express';
import type { GovernanceIntegration } from '../integrations/governance.integration.js';
import type { TemporalIntegration } from '../integrations/temporal.integration.js';
import type { TokenIntegration } from '../integrations/token.integration.js';
import type { CredentialIntegration } from '../integrations/credential.integration.js';
import type { DAGIntegration } from '../integrations/dag.integration.js';
import type { ReputationIntegration } from '../integrations/reputation.integration.js';
import type { HouseholdService } from '../services/household.service.js';
import type { CreateScheduleRequest } from '../types/index.js';
import type { AuthedRequest } from '../auth/auth.middleware.js';
import { requireHouseholdAccess, callerValidatorId } from '../auth/ownership.middleware.js';

export function createIntegrationRoutes(deps: {
  governance: GovernanceIntegration;
  temporal: TemporalIntegration;
  token: TokenIntegration;
  credential: CredentialIntegration;
  dag: DAGIntegration;
  reputation: ReputationIntegration;
  householdService: HouseholdService;
}): Router {
  const router = Router();
  const { householdService } = deps;

  /**
   * Ownership guard for schedule-by-id routes. Resolves the schedule's household
   * and 403s unless the caller is a member.
   */
  function requireScheduleAccess(paramKey = 'id') {
    return async function (req: AuthedRequest, res: Response, next: NextFunction) {
      try {
        const scheduleId = (req.params as Record<string, string>)?.[paramKey];
        if (!scheduleId) { res.status(400).json({ error: `Missing param: ${paramKey}` }); return; }
        const householdId = await deps.temporal.getScheduleHouseholdId(scheduleId);
        if (!householdId) { res.status(404).json({ error: 'Schedule not found' }); return; }
        const household = await householdService.getHousehold(householdId);
        const validatorId = callerValidatorId(req);
        const allowed =
          !!household &&
          !!validatorId &&
          (household.validatorId === validatorId ||
            household.memberValidatorIds.includes(validatorId as never));
        if (!allowed) { res.status(403).json({ error: 'forbidden' }); return; }
        next();
      } catch (err) { next(err as Error); }
    };
  }

  // ── Governance ─────────────────────────────────────────────────────────

  // POST /api/v1/governance/dfao — create household DFAO
  router.post(
    '/governance/dfao',
    requireHouseholdAccess(householdService, { from: 'body', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const { householdId, householdName } = req.body;
        // Founder is the authenticated caller, never a client-supplied value.
        const founderValidatorId = callerValidatorId(req);
        if (!householdId || !householdName || !founderValidatorId) {
          res.status(400).json({ error: 'Missing: householdId, householdName' });
          return;
        }
        const result = await deps.governance.createHouseholdDFAO(householdId, householdName, founderValidatorId);
        res.status(201).json(result);
      } catch (err) { next(err); }
    },
  );

  // POST /api/v1/governance/proposals
  router.post(
    '/governance/proposals',
    requireHouseholdAccess(householdService, { from: 'body', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const { householdId, title, description, changes } = req.body;
        // Proposer is the authenticated caller.
        const proposerId = callerValidatorId(req);
        if (!proposerId) { res.status(401).json({ error: 'unauthorized' }); return; }
        const result = await deps.governance.submitProposal(householdId, proposerId, title, description, changes);
        res.status(201).json(result);
      } catch (err) { next(err); }
    },
  );

  // ── Schedules (Temporal) ───────────────────────────────────────────────

  // POST /api/v1/schedules
  router.post(
    '/schedules',
    requireHouseholdAccess(householdService, { from: 'body', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const body = req.body as CreateScheduleRequest;
        if (!body.householdId || !body.name || !body.type || !body.actions) {
          res.status(400).json({ error: 'Missing: householdId, name, type, actions' });
          return;
        }
        const schedule = await deps.temporal.createSchedule(body);
        res.status(201).json(schedule);
      } catch (err) { next(err); }
    },
  );

  // GET /api/v1/schedules?householdId=
  router.get(
    '/schedules',
    requireHouseholdAccess(householdService, { from: 'query', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const { householdId } = req.query as { householdId: string };
        const schedules = await deps.temporal.listSchedules(householdId);
        res.json({ data: schedules, total: schedules.length });
      } catch (err) { next(err); }
    },
  );

  // PATCH /api/v1/schedules/:id/toggle
  router.patch(
    '/schedules/:id/toggle',
    requireScheduleAccess('id'),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const { enabled } = req.body as { enabled: boolean };
        await deps.temporal.toggleSchedule(req.params.id, enabled);
        res.json({ scheduleId: req.params.id, enabled });
      } catch (err) { next(err); }
    },
  );

  // POST /api/v1/schedules/:id/execute
  router.post(
    '/schedules/:id/execute',
    requireScheduleAccess('id'),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const commandIds = await deps.temporal.executeSchedule(req.params.id);
        res.json({ scheduleId: req.params.id, commandsIssued: commandIds });
      } catch (err) { next(err); }
    },
  );

  // DELETE /api/v1/schedules/:id
  router.delete(
    '/schedules/:id',
    requireScheduleAccess('id'),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const deleted = await deps.temporal.deleteSchedule(req.params.id);
        if (!deleted) { res.status(404).json({ error: 'Schedule not found' }); return; }
        res.status(204).send();
      } catch (err) { next(err); }
    },
  );

  // GET /api/v1/temporal/patterns?householdId=
  router.get(
    '/temporal/patterns',
    requireHouseholdAccess(householdService, { from: 'query', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const { householdId } = req.query as { householdId: string };
        const patterns = await deps.temporal.detectSeasonalPatterns(householdId);
        res.json({ data: patterns, total: patterns.length });
      } catch (err) { next(err); }
    },
  );

  // ── Tokens ─────────────────────────────────────────────────────────────

  // GET /api/v1/tokens/:householdId
  router.get(
    '/tokens/:householdId',
    requireHouseholdAccess(householdService, { from: 'param', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const balances = await deps.token.getTokenBalances(req.params.householdId);
        res.json({ householdId: req.params.householdId, balances });
      } catch (err) { next(err); }
    },
  );

  // GET /api/v1/tokens/:householdId/history
  router.get(
    '/tokens/:householdId/history',
    requireHouseholdAccess(householdService, { from: 'param', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const history = await deps.token.getTokenHistory(req.params.householdId, limit);
        res.json({ data: history, total: history.length });
      } catch (err) { next(err); }
    },
  );

  // ── Credentials ────────────────────────────────────────────────────────

  // GET /api/v1/credentials/:householdId
  router.get(
    '/credentials/:householdId',
    requireHouseholdAccess(householdService, { from: 'param', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const credentials = await deps.credential.getCredentials(req.params.householdId);
        res.json({ data: credentials, total: credentials.length });
      } catch (err) { next(err); }
    },
  );

  // ── Reputation ─────────────────────────────────────────────────────────
  // Reputation is keyed by validator, not household. Leaderboard is aggregate
  // and safe to expose to any authenticated user; a specific validator's record
  // is only returned to that validator.

  // GET /api/v1/reputation/leaderboard
  router.get('/reputation/leaderboard', async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const leaderboard = await deps.reputation.getLeaderboard(limit);
      res.json({ data: leaderboard, total: leaderboard.length });
    } catch (err) { next(err); }
  });

  // GET /api/v1/reputation/:validatorId
  router.get('/reputation/:validatorId', async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      if (callerValidatorId(req) !== req.params.validatorId) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      const reputation = await deps.reputation.getReputation(req.params.validatorId);
      res.json(reputation);
    } catch (err) { next(err); }
  });

  // ── DAG ────────────────────────────────────────────────────────────────

  // GET /api/v1/dag/:householdId
  router.get(
    '/dag/:householdId',
    requireHouseholdAccess(householdService, { from: 'param', key: 'householdId' }),
    async (req: AuthedRequest, res: Response, next: NextFunction) => {
      try {
        const limit = parseInt(req.query.limit as string) || 50;
        const refs = await deps.dag.getDAGReferences(req.params.householdId, limit);
        res.json({ data: refs, total: refs.length });
      } catch (err) { next(err); }
    },
  );

  return router;
}
