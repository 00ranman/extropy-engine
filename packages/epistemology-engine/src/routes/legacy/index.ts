/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  /legacy — v3.0 backwards-compatible surface
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  These are the v3.0 endpoints, lifted from the original src/index.ts. URLs
 *  do not change: the router is mounted at the root so callers continue to
 *  hit POST /claims, GET /claims/:id, etc.
 *
 *  v3.1 status: kept verbatim for backwards compatibility through v3.1.x.
 *  Deprecation target is v3.2 once /mesh observability is fully wired and
 *  the personal-AI decomposition path is the canonical write surface.
 *
 *  One v3.1 hook lives here: every truth_score transition appends a row to
 *  bayesian_history, which is what the /mesh/falsifiability and
 *  /mesh/consensus/drift endpoints read.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { Router, Request, Response, NextFunction } from 'express';
import type { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

import {
  ClaimStatus,
  SubClaimStatus,
  EventType,
  type Claim,
  type ClaimId,
  type LoopId,
  type SubClaim,
  type SubClaimId,
  type ValidatorId,
  type MeasurementId,
  type EntropyDomain,
  type BayesianPrior,
} from '@extropy/contracts';

import {
  initBayesianPrior,
  updateBayesianPrior,
} from '../../bayesian.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Local request/response shapes
// ─────────────────────────────────────────────────────────────────────────────

interface SubmitClaimRequest {
  loopId: string;
  statement: string;
  domain: string;
  submitterId: string;
  initialPrior?: number;
}

interface SubmitClaimResponse {
  claim: Claim;
  estimatedSubClaims: number;
  estimatedValidationTimeSeconds: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Router factory dependencies
// ─────────────────────────────────────────────────────────────────────────────

export interface LegacyRouterDeps {
  db: Pool;
  publishEvent: <T>(type: string, aggregateId: string, data: T) => Promise<void>;
  /** Truth score threshold above which a fully-resolved claim is VERIFIED. */
  verifiedThreshold: number;
  /** Aggregator over sub-claim posterior means. Either logodds or geometric. */
  aggregateTruthScore: (
    parts: ReadonlyArray<{ probability: number; weight: number }>,
  ) => number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Router factory
// ─────────────────────────────────────────────────────────────────────────────

export function createLegacyRouter(deps: LegacyRouterDeps): Router {
  const { db, publishEvent, verifiedThreshold, aggregateTruthScore } = deps;
  const router: Router = express.Router();

  // ── POST /claims — submit a new claim ──────────────────────────────────
  router.post('/claims', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as SubmitClaimRequest;

      if (!body.loopId || !body.statement || !body.domain || !body.submitterId) {
        res.status(400).json({
          error: 'Missing required fields: loopId, statement, domain, submitterId',
        });
        return;
      }

      const godelReason = detectGodelBoundary(body.statement);

      const claimId = uuidv4() as ClaimId;
      const now = new Date().toISOString();

      const claim: Claim = {
        id: claimId,
        loopId: body.loopId as LoopId,
        statement: body.statement,
        domain: body.domain as EntropyDomain,
        submitterId: body.submitterId as ValidatorId,
        status: godelReason ? ClaimStatus.UNDECIDABLE : ClaimStatus.SUBMITTED,
        bayesianPrior: initBayesianPrior(body.initialPrior ?? 0.5),
        subClaimIds: [],
        truthScore: body.initialPrior ?? 0.5,
        createdAt: now,
        updatedAt: now,
        undecidableReason: godelReason ?? undefined,
      };

      await db.query(
        `INSERT INTO claims
           (id, loop_id, statement, domain, submitter_id, status,
            bayesian_prior, sub_claim_ids, truth_score, created_at, updated_at, undecidable_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          claim.id,
          claim.loopId,
          claim.statement,
          claim.domain,
          claim.submitterId,
          claim.status,
          JSON.stringify(claim.bayesianPrior),
          claim.subClaimIds,
          claim.truthScore,
          claim.createdAt,
          claim.updatedAt,
          claim.undecidableReason ?? null,
        ],
      );

      // First history row: prior is null because nothing came before.
      await appendBayesianHistory(db, claim.id, claim.domain, null, claim.truthScore, claim.status);

      if (godelReason) {
        await publishEvent(EventType.CLAIM_SUBMITTED, claimId, {
          claimId,
          loopId: claim.loopId,
          domain: claim.domain,
          statement: claim.statement,
        });
        const response: SubmitClaimResponse = {
          claim,
          estimatedSubClaims: 0,
          estimatedValidationTimeSeconds: 0,
        };
        res.status(201).json(response);
        return;
      }

      const subClaimDrafts = decomposeClaimToSubClaims(claim);
      const subClaimIds: SubClaimId[] = [];

      for (const draft of subClaimDrafts) {
        const scId = uuidv4() as SubClaimId;
        subClaimIds.push(scId);
        await db.query(
          `INSERT INTO sub_claims
             (id, claim_id, loop_id, statement, domain, status, bayesian_prior,
              measurement_ids, assigned_validator_ids, weight, depends_on, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            scId,
            draft.claimId,
            draft.loopId,
            draft.statement,
            draft.domain,
            draft.status,
            JSON.stringify(draft.bayesianPrior),
            draft.measurementIds,
            draft.assignedValidatorIds,
            draft.weight,
            draft.dependsOn,
            draft.createdAt,
          ],
        );
      }

      await db.query(
        `UPDATE claims SET sub_claim_ids=$1, status=$2, updated_at=NOW() WHERE id=$3`,
        [subClaimIds, ClaimStatus.DECOMPOSED, claimId],
      );

      await publishEvent(EventType.CLAIM_SUBMITTED, claimId, {
        claimId,
        loopId: claim.loopId,
        domain: claim.domain,
        statement: claim.statement,
      });
      await publishEvent(EventType.CLAIM_DECOMPOSED, claimId, {
        claimId,
        loopId: claim.loopId,
        subClaimIds,
        estimatedValidationTimeSeconds: subClaimDrafts.length * 30,
      });

      const response: SubmitClaimResponse = {
        claim: { ...claim, status: ClaimStatus.DECOMPOSED, subClaimIds },
        estimatedSubClaims: subClaimDrafts.length,
        estimatedValidationTimeSeconds: subClaimDrafts.length * 30,
      };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  });

  // ── GET /claims/:id ────────────────────────────────────────────────────
  router.get('/claims/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await db.query('SELECT * FROM claims WHERE id = $1', [req.params.id]);
      if (rows.length === 0) {
        res.status(404).json({ error: 'Claim not found' });
        return;
      }
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  // ── GET /claims/:id/sub-claims ─────────────────────────────────────────
  router.get('/claims/:id/sub-claims', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await db.query(
        'SELECT * FROM sub_claims WHERE claim_id = $1 ORDER BY created_at',
        [req.params.id],
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  // ── PATCH /sub-claims/:id/evidence ─────────────────────────────────────
  router.patch(
    '/sub-claims/:id/evidence',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Body shape (v3.1): { measurementId, evidenceConfidence: number in [0,1] }
        // Body shape (v3.0 legacy, still accepted): { measurementId, likelihood, counterLikelihood }
        const { measurementId, evidenceConfidence, likelihood, counterLikelihood } = req.body as {
          measurementId: MeasurementId;
          evidenceConfidence?: number;
          likelihood?: number;
          counterLikelihood?: number;
        };

        const { rows } = await db.query('SELECT * FROM sub_claims WHERE id = $1', [
          req.params.id,
        ]);
        if (rows.length === 0) {
          res.status(404).json({ error: 'SubClaim not found' });
          return;
        }

        let confidence: number;
        if (typeof evidenceConfidence === 'number') {
          confidence = evidenceConfidence;
        } else if (typeof likelihood === 'number' && typeof counterLikelihood === 'number') {
          const total = likelihood + counterLikelihood;
          confidence = total === 0 ? 0.5 : likelihood / total;
        } else {
          res.status(400).json({
            error:
              'Provide either evidenceConfidence (preferred) or both likelihood and counterLikelihood (legacy)',
          });
          return;
        }

        const sc = rows[0];
        const updatedPrior = updateBayesianPrior(
          sc.bayesian_prior as BayesianPrior,
          measurementId,
          confidence,
        );

        await db.query(
          `UPDATE sub_claims
             SET bayesian_prior=$1,
                 measurement_ids=array_append(measurement_ids, $2),
                 updated_at=NOW()
           WHERE id=$3`,
          [JSON.stringify(updatedPrior), measurementId, req.params.id],
        );

        res.json({ subClaimId: req.params.id, updatedPrior });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── PATCH /sub-claims/:id/resolve ──────────────────────────────────────
  router.patch(
    '/sub-claims/:id/resolve',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { verdict, confidence, justification, validationDurationSeconds } = req.body;
        const newStatus =
          verdict === 'confirmed'
            ? SubClaimStatus.VERIFIED
            : verdict === 'denied'
              ? SubClaimStatus.FALSIFIED
              : SubClaimStatus.UNDECIDABLE;

        const { rows: scRows } = await db.query('SELECT * FROM sub_claims WHERE id=$1', [
          req.params.id,
        ]);
        if (scRows.length === 0) {
          res.status(404).json({ error: 'SubClaim not found' });
          return;
        }

        await db.query(`UPDATE sub_claims SET status=$1, resolved_at=NOW() WHERE id=$2`, [
          newStatus,
          req.params.id,
        ]);

        // Propagate to parent claim: recompute composite truth score.
        const claimId = scRows[0].claim_id;
        const { rows: allSc } = await db.query('SELECT * FROM sub_claims WHERE claim_id=$1', [
          claimId,
        ]);

        const truthScore = aggregateTruthScore(
          allSc.map((sc: { weight: number; bayesian_prior: BayesianPrior }) => {
            const p = sc.bayesian_prior;
            const probability =
              typeof p.alpha === 'number' && typeof p.beta === 'number'
                ? p.alpha / (p.alpha + p.beta)
                : (p.posteriorProbability ?? 0.5);
            return { probability, weight: sc.weight };
          }),
        );

        const allResolved = allSc.every((sc: { status: string }) =>
          [SubClaimStatus.VERIFIED, SubClaimStatus.FALSIFIED, SubClaimStatus.UNDECIDABLE].includes(
            sc.status as SubClaimStatus,
          ),
        );

        const claimStatus = allResolved
          ? truthScore >= verifiedThreshold
            ? ClaimStatus.VERIFIED
            : ClaimStatus.FALSIFIED
          : ClaimStatus.DECOMPOSED;

        // Read previous truth_score so the history row carries a real delta.
        const { rows: prevRows } = await db.query(
          'SELECT truth_score, domain FROM claims WHERE id=$1',
          [claimId],
        );
        const previousScore: number | null =
          prevRows.length > 0 ? Number(prevRows[0].truth_score) : null;
        const claimDomain: string =
          prevRows.length > 0 ? String(prevRows[0].domain) : 'cognitive';

        await db.query(
          `UPDATE claims SET truth_score=$1, status=$2, updated_at=NOW() WHERE id=$3`,
          [truthScore, claimStatus, claimId],
        );

        await appendBayesianHistory(
          db,
          claimId as ClaimId,
          claimDomain,
          previousScore,
          truthScore,
          claimStatus,
        );

        if (allResolved) {
          await publishEvent(EventType.CLAIM_EVALUATED, claimId, {
            claimId,
            loopId: scRows[0].loop_id,
            truthScore,
            status: claimStatus,
          });
        }

        await publishEvent(EventType.SUBCLAIM_UPDATED, req.params.id, {
          subClaimId: req.params.id,
          claimId,
          loopId: scRows[0].loop_id,
          status: newStatus,
          result: {
            verdict,
            confidence,
            evidenceMeasurementIds: [],
            justification,
            validationDurationSeconds,
          },
        });

        res.json({
          subClaimId: req.params.id,
          status: newStatus,
          claimTruthScore: truthScore,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── GET /loops/:loopId/claims ──────────────────────────────────────────
  router.get('/loops/:loopId/claims', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await db.query('SELECT * FROM claims WHERE loop_id=$1', [
        req.params.loopId,
      ]);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function appendBayesianHistory(
  db: Pool,
  claimId: ClaimId,
  domain: string,
  previousScore: number | null,
  currentScore: number,
  status: string,
): Promise<void> {
  await db.query(
    `INSERT INTO bayesian_history (claim_id, domain, previous_score, current_score, status)
     VALUES ($1, $2, $3, $4, $5)`,
    [claimId, domain, previousScore, currentScore, status],
  );
}

/**
 * Decomposes a top-level claim into atomic sub-claims.
 * Deterministic rule-based decomposition (production uses an LLM at the edge).
 */
function decomposeClaimToSubClaims(claim: Claim): Array<Omit<SubClaim, 'id'>> {
  const base: Array<Omit<SubClaim, 'id'>> = [
    {
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The entropy reduction claimed in "${claim.statement}" is measurable and quantifiable`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.7),
      measurementIds: [],
      assignedValidatorIds: [],
      weight: 0.3,
      dependsOn: [],
      createdAt: new Date().toISOString(),
    },
    {
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `There is a direct causal link between the action and the outcome in "${claim.statement}"`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.6),
      measurementIds: [],
      assignedValidatorIds: [],
      weight: 0.4,
      dependsOn: [],
      createdAt: new Date().toISOString(),
    },
  ];

  const domainSpecific: Array<Omit<SubClaim, 'id'>> = [];

  if (claim.domain === 'code') {
    domainSpecific.push({
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The implementation described in "${claim.statement}" is technically correct and functions as claimed`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.65),
      measurementIds: [],
      assignedValidatorIds: [],
      weight: 0.2,
      dependsOn: [],
      createdAt: new Date().toISOString(),
    });
  }

  if (claim.domain === 'cognitive') {
    domainSpecific.push({
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The cognitive effect claimed in "${claim.statement}" is reproducible under similar conditions`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.55),
      measurementIds: [],
      assignedValidatorIds: [],
      weight: 0.2,
      dependsOn: [],
      createdAt: new Date().toISOString(),
    });
  }

  if (/\d/.test(claim.statement)) {
    domainSpecific.push({
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The numeric magnitude stated in "${claim.statement}" is accurate within ±5%`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.6),
      measurementIds: [],
      assignedValidatorIds: [],
      weight: 0.1,
      dependsOn: [],
      createdAt: new Date().toISOString(),
    });
  }

  // Renormalize weights.
  const all = [...base, ...domainSpecific];
  const totalWeight = all.reduce((s, sc) => s + sc.weight, 0);
  return all.map((sc) => ({ ...sc, weight: sc.weight / totalWeight }));
}

/**
 * Detects if a claim is self-referential or otherwise undecidable.
 * Gödel boundary detection — very simplified.
 */
function detectGodelBoundary(statement: string): string | null {
  const lower = statement.toLowerCase();
  const selfRefPatterns = [
    'this claim',
    'this statement',
    'itself',
    'self-referential',
    'cannot be verified',
    'is unprovable',
    'is undecidable',
  ];
  for (const pattern of selfRefPatterns) {
    if (lower.includes(pattern)) {
      return `Gödel boundary detected: claim contains self-referential pattern "${pattern}"`;
    }
  }
  return null;
}
