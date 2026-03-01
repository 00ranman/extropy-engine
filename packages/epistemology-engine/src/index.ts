/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Epistemology Engine
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  The Epistemology Engine is responsible for:
 *    1. Receiving claims submitted by users/agents
 *    2. Decomposing claims into atomic, verifiable sub-claims (DAG)
 *    3. Maintaining Bayesian priors for each claim and sub-claim
 *    4. Detecting Gödel boundaries (self-referential / undecidable claims)
 *    5. Publishing events to the event bus for downstream services
 *    6. Providing the truth score for loop closure decisions
 *
 *  Architecture:
 *    - Express HTTP server (port 3002)
 *    - PostgreSQL database (claims + sub-claims)
 *    - Redis for event bus pub/sub
 *    - Shares @extropy/contracts types
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';

import type {
  Claim,
  SubClaim,
  ClaimId,
  SubClaimId,
  LoopId,
  ValidatorId,
  MeasurementId,
  EntropyDomain,
  BayesianPrior,
  BayesianUpdate,
  SubmitClaimRequest,
  SubmitClaimResponse,
  DomainEvent,
} from '@extropy/contracts';

import {
  ClaimStatus,
  SubClaimStatus,
  EVENT_TYPES,
} from '@extropy/contracts';

// ─────────────────────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PORT     = parseInt(process.env.PORT     ?? '3002', 10);
const DB_URL   = process.env.DATABASE_URL      ?? 'postgresql://postgres:postgres@localhost:5433/epistemology';
const REDIS_URL = process.env.REDIS_URL        ?? 'redis://localhost:6379';

// ─────────────────────────────────────────────────────────────────────────────
//  Database
// ─────────────────────────────────────────────────────────────────────────────

const db = new Pool({ connectionString: DB_URL });

async function initDb(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS claims (
      id             TEXT PRIMARY KEY,
      loop_id        TEXT NOT NULL,
      statement      TEXT NOT NULL,
      domain         TEXT NOT NULL,
      submitter_id   TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'submitted',
      bayesian_prior JSONB NOT NULL,
      sub_claim_ids  TEXT[] NOT NULL DEFAULT '{}',
      truth_score    FLOAT NOT NULL DEFAULT 0.5,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      undecidable_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS sub_claims (
      id                      TEXT PRIMARY KEY,
      claim_id                TEXT NOT NULL REFERENCES claims(id),
      loop_id                 TEXT NOT NULL,
      statement               TEXT NOT NULL,
      domain                  TEXT NOT NULL,
      status                  TEXT NOT NULL DEFAULT 'pending',
      bayesian_prior          JSONB NOT NULL,
      measurement_ids         TEXT[] NOT NULL DEFAULT '{}',
      assigned_validator_ids  TEXT[] NOT NULL DEFAULT '{}',
      weight                  FLOAT NOT NULL DEFAULT 1.0,
      depends_on              TEXT[] NOT NULL DEFAULT '{}',
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at             TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_claims_loop_id   ON claims(loop_id);
    CREATE INDEX IF NOT EXISTS idx_claims_status    ON claims(status);
    CREATE INDEX IF NOT EXISTS idx_subclaims_claim  ON sub_claims(claim_id);
    CREATE INDEX IF NOT EXISTS idx_subclaims_loop   ON sub_claims(loop_id);
    CREATE INDEX IF NOT EXISTS idx_subclaims_status ON sub_claims(status);
  `);
  console.log('[epistemology-engine] Database schema ready');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Redis Event Bus
// ─────────────────────────────────────────────────────────────────────────────

const redis = createClient({ url: REDIS_URL });

async function publishEvent<T>(type: string, aggregateId: string, data: T): Promise<void> {
  const event: DomainEvent<T> = {
    eventId: uuidv4(),
    aggregateId,
    type,
    data,
    occurredAt: new Date().toISOString(),
    source: 'epistemology-engine',
    schemaVersion: 1,
  };
  await redis.publish('extropy:events', JSON.stringify(event));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Bayesian Math
// ─────────────────────────────────────────────────────────────────────────────

function computePosterior(prior: number, likelihood: number, counterLikelihood: number): number {
  // Bayes: P(H|E) = P(E|H)·P(H) / [P(E|H)·P(H) + P(E|¬H)·P(¬H)]
  const numerator   = likelihood * prior;
  const denominator = numerator + counterLikelihood * (1 - prior);
  return denominator === 0 ? prior : numerator / denominator;
}

function initBayesianPrior(initialProbability = 0.5): BayesianPrior {
  return {
    priorProbability:    initialProbability,
    likelihood:          0.8,  // default: evidence is 4x more likely if claim is true
    counterLikelihood:   0.2,
    posteriorProbability: initialProbability,
    updateCount:         0,
    confidenceInterval:  [Math.max(0, initialProbability - 0.2), Math.min(1, initialProbability + 0.2)],
    updateHistory:       [],
  };
}

function updateBayesianPrior(
  prior: BayesianPrior,
  evidenceId: MeasurementId | SubClaimId,
  newLikelihood?: number,
  newCounterLikelihood?: number,
): BayesianPrior {
  const likelihood        = newLikelihood        ?? prior.likelihood;
  const counterLikelihood = newCounterLikelihood ?? prior.counterLikelihood;
  const posterior         = computePosterior(prior.posteriorProbability, likelihood, counterLikelihood);

  const update: BayesianUpdate = {
    timestamp:       new Date().toISOString(),
    evidenceId,
    priorBefore:     prior.posteriorProbability,
    posteriorAfter:  posterior,
    likelihoodRatio: likelihood / counterLikelihood,
  };

  const ci = 1.96 * Math.sqrt(posterior * (1 - posterior) / Math.max(1, prior.updateCount + 1));

  return {
    ...prior,
    priorProbability:    prior.posteriorProbability,
    likelihood,
    counterLikelihood,
    posteriorProbability: posterior,
    updateCount:         prior.updateCount + 1,
    confidenceInterval:  [Math.max(0, posterior - ci), Math.min(1, posterior + ci)],
    updateHistory:       [...prior.updateHistory, update],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Claim Decomposition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decomposes a top-level claim into atomic sub-claims.
 *
 * In production this would call an LLM to do semantic decomposition.
 * Here we use a deterministic rule-based decomposition for correctness.
 *
 * Rules:
 *   - Every claim gets a "measurability" sub-claim (can we measure ΔS?)
 *   - Every claim gets a "causality" sub-claim (does the action cause the effect?)
 *   - CODE domain claims get a "correctness" sub-claim (does the code do what it says?)
 *   - COGNITIVE domain claims get a "reproducibility" sub-claim
 *   - Claims with numbers get a "magnitude" sub-claim (is the magnitude correct?)
 */
function decomposeClaimToSubClaims(
  claim: Claim,
): Array<Omit<SubClaim, 'id'>> {
  const base = [
    {
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The entropy reduction claimed in "${claim.statement}" is measurable and quantifiable`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.7),
      measurementIds: [] as MeasurementId[],
      assignedValidatorIds: [] as ValidatorId[],
      weight: 0.3,
      dependsOn: [] as SubClaimId[],
      createdAt: new Date().toISOString(),
    },
    {
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `There is a direct causal link between the action and the outcome in "${claim.statement}"`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.6),
      measurementIds: [] as MeasurementId[],
      assignedValidatorIds: [] as ValidatorId[],
      weight: 0.4,
      dependsOn: [] as SubClaimId[],
      createdAt: new Date().toISOString(),
    },
  ];

  const domain_specific: Array<Omit<SubClaim, 'id'>> = [];

  if (claim.domain === 'code') {
    domain_specific.push({
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The implementation described in "${claim.statement}" is technically correct and functions as claimed`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.65),
      measurementIds: [] as MeasurementId[],
      assignedValidatorIds: [] as ValidatorId[],
      weight: 0.2,
      dependsOn: [] as SubClaimId[],
      createdAt: new Date().toISOString(),
    });
  }

  if (claim.domain === 'cognitive') {
    domain_specific.push({
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The cognitive effect claimed in "${claim.statement}" is reproducible under similar conditions`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.55),
      measurementIds: [] as MeasurementId[],
      assignedValidatorIds: [] as ValidatorId[],
      weight: 0.2,
      dependsOn: [] as SubClaimId[],
      createdAt: new Date().toISOString(),
    });
  }

  // Numeric magnitude sub-claim
  if (/\d/.test(claim.statement)) {
    domain_specific.push({
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The numeric magnitude stated in "${claim.statement}" is accurate within ±5%`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.6),
      measurementIds: [] as MeasurementId[],
      assignedValidatorIds: [] as ValidatorId[],
      weight: 0.1,
      dependsOn: [] as SubClaimId[],
      createdAt: new Date().toISOString(),
    });
  }

  // Renormalize weights
  const all = [...base, ...domain_specific];
  const totalWeight = all.reduce((s, sc) => s + sc.weight, 0);
  return all.map(sc => ({ ...sc, weight: sc.weight / totalWeight }));
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

// ─────────────────────────────────────────────────────────────────────────────
//  Express App
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req: Request, res: Response) => {
  try {
    await db.query('SELECT 1');
    res.json({ service: 'epistemology-engine', status: 'healthy', version: '1.0.0', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ service: 'epistemology-engine', status: 'unhealthy', error: String(err) });
  }
});

// ── POST /claims — submit a new claim ─────────────────────────────────────────
app.post('/claims', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as SubmitClaimRequest;

    if (!body.loopId || !body.statement || !body.domain || !body.submitterId) {
      res.status(400).json({ error: 'Missing required fields: loopId, statement, domain, submitterId' });
      return;
    }

    // Gödel boundary check
    const godelReason = detectGodelBoundary(body.statement);

    const claimId = uuidv4() as ClaimId;
    const now     = new Date().toISOString();

    const claim: Claim = {
      id:            claimId,
      loopId:        body.loopId as LoopId,
      statement:     body.statement,
      domain:        body.domain as EntropyDomain,
      submitterId:   body.submitterId as ValidatorId,
      status:        godelReason ? ClaimStatus.UNDECIDABLE : ClaimStatus.SUBMITTED,
      bayesianPrior: initBayesianPrior(body.initialPrior ?? 0.5),
      subClaimIds:   [],
      truthScore:    body.initialPrior ?? 0.5,
      createdAt:     now,
      updatedAt:     now,
      undecidableReason: godelReason ?? undefined,
    };

    // Persist claim
    await db.query(
      `INSERT INTO claims
         (id, loop_id, statement, domain, submitter_id, status,
          bayesian_prior, sub_claim_ids, truth_score, created_at, updated_at, undecidable_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        claim.id, claim.loopId, claim.statement, claim.domain,
        claim.submitterId, claim.status, JSON.stringify(claim.bayesianPrior),
        claim.subClaimIds, claim.truthScore, claim.createdAt, claim.updatedAt,
        claim.undecidableReason ?? null,
      ],
    );

    if (godelReason) {
      await publishEvent(EVENT_TYPES.CLAIM_SUBMITTED, claimId, {
        claimId, loopId: claim.loopId, domain: claim.domain, statement: claim.statement,
      });
      res.status(201).json({ claim, estimatedSubClaims: 0, estimatedValidationTimeSeconds: 0 } as SubmitClaimResponse);
      return;
    }

    // Decompose into sub-claims
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
          scId, draft.claimId, draft.loopId, draft.statement, draft.domain,
          draft.status, JSON.stringify(draft.bayesianPrior), draft.measurementIds,
          draft.assignedValidatorIds, draft.weight, draft.dependsOn, draft.createdAt,
        ],
      );
    }

    // Update claim with sub-claim IDs and status
    await db.query(
      `UPDATE claims SET sub_claim_ids=$1, status=$2, updated_at=NOW() WHERE id=$3`,
      [subClaimIds, ClaimStatus.DECOMPOSED, claimId],
    );

    // Publish events
    await publishEvent(EVENT_TYPES.CLAIM_SUBMITTED, claimId, {
      claimId, loopId: claim.loopId, domain: claim.domain, statement: claim.statement,
    });
    await publishEvent(EVENT_TYPES.CLAIM_DECOMPOSED, claimId, {
      claimId, loopId: claim.loopId, subClaimIds,
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

// ── GET /claims/:id ───────────────────────────────────────────────────────────
app.get('/claims/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query('SELECT * FROM claims WHERE id = $1', [req.params.id]);
    if (rows.length === 0) { res.status(404).json({ error: 'Claim not found' }); return; }
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ── GET /claims/:id/sub-claims ────────────────────────────────────────────────
app.get('/claims/:id/sub-claims', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query('SELECT * FROM sub_claims WHERE claim_id = $1 ORDER BY created_at', [req.params.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── PATCH /sub-claims/:id/evidence — record evidence for a sub-claim ──────────
app.patch('/sub-claims/:id/evidence', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { measurementId, likelihood, counterLikelihood } = req.body as {
      measurementId: MeasurementId;
      likelihood?: number;
      counterLikelihood?: number;
    };

    const { rows } = await db.query('SELECT * FROM sub_claims WHERE id = $1', [req.params.id]);
    if (rows.length === 0) { res.status(404).json({ error: 'SubClaim not found' }); return; }

    const sc = rows[0];
    const updatedPrior = updateBayesianPrior(
      sc.bayesian_prior as BayesianPrior,
      measurementId,
      likelihood,
      counterLikelihood,
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
  } catch (err) { next(err); }
});

// ── PATCH /sub-claims/:id/resolve — resolve a sub-claim ───────────────────────
app.patch('/sub-claims/:id/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { verdict, confidence, justification, validationDurationSeconds } = req.body;
    const newStatus = verdict === 'confirmed' ? SubClaimStatus.VERIFIED
                    : verdict === 'denied'    ? SubClaimStatus.FALSIFIED
                    :                           SubClaimStatus.UNDECIDABLE;

    const { rows: scRows } = await db.query('SELECT * FROM sub_claims WHERE id=$1', [req.params.id]);
    if (scRows.length === 0) { res.status(404).json({ error: 'SubClaim not found' }); return; }

    await db.query(
      `UPDATE sub_claims SET status=$1, resolved_at=NOW() WHERE id=$2`,
      [newStatus, req.params.id],
    );

    // Propagate to parent claim: recompute composite truth score
    const claimId = scRows[0].claim_id;
    const { rows: allSc } = await db.query('SELECT * FROM sub_claims WHERE claim_id=$1', [claimId]);

    const truthScore = allSc.reduce((acc: number, sc: { weight: number; bayesian_prior: BayesianPrior }) => {
      return acc * Math.pow(sc.bayesian_prior.posteriorProbability, sc.weight);
    }, 1.0);

    const allResolved = allSc.every((sc: { status: string }) =>
      [SubClaimStatus.VERIFIED, SubClaimStatus.FALSIFIED, SubClaimStatus.UNDECIDABLE].includes(sc.status as SubClaimStatus)
    );

    const claimStatus = allResolved
      ? (truthScore >= 0.6 ? ClaimStatus.VERIFIED : ClaimStatus.FALSIFIED)
      : ClaimStatus.DECOMPOSED;

    await db.query(
      `UPDATE claims SET truth_score=$1, status=$2, updated_at=NOW() WHERE id=$3`,
      [truthScore, claimStatus, claimId],
    );

    if (allResolved) {
      await publishEvent(
        truthScore >= 0.6 ? EVENT_TYPES.CLAIM_VERIFIED : EVENT_TYPES.CLAIM_FALSIFIED,
        claimId,
        { claimId, loopId: scRows[0].loop_id, truthScore },
      );
    }

    await publishEvent(EVENT_TYPES.SUBCLAIM_RESOLVED, req.params.id, {
      subClaimId: req.params.id, claimId, loopId: scRows[0].loop_id,
      status: newStatus,
      result: { verdict, confidence, evidenceMeasurementIds: [], justification, validationDurationSeconds },
    });

    res.json({ subClaimId: req.params.id, status: newStatus, claimTruthScore: truthScore });
  } catch (err) { next(err); }
});

// ── GET /loops/:loopId/claims ─────────────────────────────────────────────────
app.get('/loops/:loopId/claims', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await db.query('SELECT * FROM claims WHERE loop_id=$1', [req.params.loopId]);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[epistemology-engine] Error:', err);
  res.status(500).json({ error: err.message });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await redis.connect();
  console.log('[epistemology-engine] Redis connected');

  await initDb();

  app.listen(PORT, () => {
    console.log(`[epistemology-engine] Listening on port ${PORT}`);
  });
}

main().catch(err => {
  console.error('[epistemology-engine] Fatal startup error:', err);
  process.exit(1);
});
