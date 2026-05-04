/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Epistemology Engine
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  v3.1 REDEFINITION NOTICE
 *  ─────────────────────────
 *  The epistemology engine is NOT a central decomposition service. The reading
 *  in v3.0 that placed claim decomposition here was a misunderstanding of what
 *  this layer always was. Decomposition is a personal-AI responsibility at the
 *  edge (see architecture/AUTARKY.md, docs/SPEC_v3.1.md §7).
 *
 *  In v3.1, the epistemology engine is recognized for what it is: the mesh's
 *  EMERGENT PEER-REVIEW SYSTEM, witnessed and aggregated as a queryable
 *  observability layer. The mesh, running on incentives alone, IS the engine.
 *  This package surfaces what emerges. It does not arbitrate truth.
 *
 *  WHAT THIS PACKAGE DOES (target state, v3.1.x → v3.2):
 *    1. Aggregates validation outcomes across the DAG
 *    2. Surfaces consensus drift, dissent clusters, contested-claim patterns
 *    3. Computes mesh-wide falsifiability statistics per domain/DFAO
 *    4. Tracks reputation graph evolution; flags Sybil-suspicious clusters
 *    5. Detects emergent ontologies (recurring claim patterns, naming drift)
 *    6. Provides queryable hooks for governance
 *    7. Surfaces Goodhart-pattern signals where XP correlates poorly with
 *       independently-observed outcomes
 *
 *  WHAT THIS PACKAGE DOES NOT DO:
 *    - Decompose claims (personal AI does this)
 *    - Decide what is true (the mesh does this through validation)
 *    - Hold a private world model
 *    - Act as a single source of epistemic authority
 *
 *  v3.0 LEGACY ENDPOINTS:
 *    The /claims POST + sub-claim atomization + Bayesian update endpoints below
 *    are retained for backwards compatibility through v3.1.x. They will be
 *    removed in v3.2 once observability endpoints are stable.
 *
 *  Architecture:
 *    - Express HTTP server (port 4001)
 *    - PostgreSQL database (mesh-state index, NOT a claim authority)
 *    - Redis for event bus subscription (read-mostly)
 *    - Shares @extropy/contracts types
 *    - Read-mostly: writes only metadata about network state
 *    - Stateless under restart: rebuilt from DAG replay
 *    - Multi-instance: no canonical engine instance, by design
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
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
} from '@extropy/contracts';

import {
  initBayesianPrior,
  updateBayesianPrior,
  ensureBeta,
  aggregateLogOdds,
  aggregateGeometric,
} from './bayesian';

import {
  selectBackend,
  PostgresSource,
  DagSubstrateSource,
  type EpistemologySource,
} from './observability/index.js';
import { createMeshRouter } from './routes/mesh/index.js';

import {
  ClaimStatus,
  SubClaimStatus,
  EventType,
  ServiceName,
} from '@extropy/contracts';

// ── Local request/response types (not part of shared contracts) ──────────────

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
//  Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PORT       = parseInt(process.env.PORT     ?? '3002', 10);
const DB_URL     = process.env.DATABASE_URL      ?? 'postgresql://postgres:postgres@localhost:5433/epistemology';
const REDIS_URL  = process.env.REDIS_URL         ?? 'redis://localhost:6379';

/** Truth score above which a fully-resolved claim is marked VERIFIED. */
const VERIFIED_THRESHOLD = parseFloat(process.env.VERIFIED_THRESHOLD ?? '0.6');

/** Aggregator: 'logodds' (v3.1, default) or 'geometric' (legacy v3.0 ∏ p^w). */
const AGGREGATOR = (process.env.TRUTH_AGGREGATOR ?? 'logodds') as 'logodds' | 'geometric';

function aggregateTruthScore(parts: ReadonlyArray<{ probability: number; weight: number }>): number {
  return AGGREGATOR === 'geometric' ? aggregateGeometric(parts) : aggregateLogOdds(parts);
}

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

const redis = new Redis(REDIS_URL);

interface SimpleEvent {
  eventId: string;
  aggregateId: string;
  type: string;
  data: unknown;
  occurredAt: string;
  source: string;
  schemaVersion: number;
}

async function publishEvent<T>(type: string, aggregateId: string, data: T): Promise<void> {
  const event: SimpleEvent = {
    eventId: uuidv4(),
    aggregateId,
    type,
    data,
    occurredAt: new Date().toISOString(),
    source: ServiceName.EPISTEMOLOGY_ENGINE,
    schemaVersion: 1,
  };
  await redis.publish('extropy:events', JSON.stringify(event));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Bayesian Math — see ./bayesian.ts for the Beta(α, β) implementation
// ─────────────────────────────────────────────────────────────────────────────
//
//  v3.1: Bayesian math is now Beta(α, β) conjugate updates with proper Beta
//  credible intervals and weighted log-odds aggregation. Helpers live in
//  ./bayesian.ts so observability/test code can reuse them without dragging
//  in the express + pg + redis runtime.
//
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

// ── EpistemologySource backend selection (v3.1 observability) ────────────────
//
//  EPISTEMOLOGY_SOURCE=postgres        → PostgresSource (default, v3.1.x)
//  EPISTEMOLOGY_SOURCE=dag-substrate   → DagSubstrateSource (stub until DAG node API ships)
//
const epistemologyBackend = selectBackend();
const epistemologySource: EpistemologySource =
  epistemologyBackend === 'postgres'
    ? new PostgresSource({ pool: db })
    : new DagSubstrateSource();

const app: Express = express();
app.use(express.json());

// Mount the v3.1 observability surface under /mesh.
app.use('/mesh', createMeshRouter({ source: epistemologySource }));

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
      await publishEvent(EventType.CLAIM_SUBMITTED, claimId, {
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
    await publishEvent(EventType.CLAIM_SUBMITTED, claimId, {
      claimId, loopId: claim.loopId, domain: claim.domain, statement: claim.statement,
    });
    await publishEvent(EventType.CLAIM_DECOMPOSED, claimId, {
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
    // Body shape (v3.1): { measurementId, evidenceConfidence: number in [0,1] }
    //   1 = unambiguous confirmation, 0 = unambiguous refutation, 0.5 = uninformative
    // Body shape (v3.0 legacy, still accepted): { measurementId, likelihood, counterLikelihood }
    //   evidenceConfidence is derived as likelihood / (likelihood + counterLikelihood)
    const { measurementId, evidenceConfidence, likelihood, counterLikelihood } = req.body as {
      measurementId: MeasurementId;
      evidenceConfidence?: number;
      likelihood?: number;
      counterLikelihood?: number;
    };

    const { rows } = await db.query('SELECT * FROM sub_claims WHERE id = $1', [req.params.id]);
    if (rows.length === 0) { res.status(404).json({ error: 'SubClaim not found' }); return; }

    let confidence: number;
    if (typeof evidenceConfidence === 'number') {
      confidence = evidenceConfidence;
    } else if (typeof likelihood === 'number' && typeof counterLikelihood === 'number') {
      const total = likelihood + counterLikelihood;
      confidence = total === 0 ? 0.5 : likelihood / total;
    } else {
      res.status(400).json({
        error: 'Provide either evidenceConfidence (preferred) or both likelihood and counterLikelihood (legacy)',
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

    // v3.1: aggregate sub-claim posteriors via the configured aggregator
    // (weighted log-odds by default; legacy geometric mean opt-in via env).
    // Each sub-claim's posterior is read from its Beta posterior mean when
    // present, else the legacy posteriorProbability field.
    const truthScore = aggregateTruthScore(
      allSc.map((sc: { weight: number; bayesian_prior: BayesianPrior }) => {
        const p = sc.bayesian_prior;
        const probability = (typeof p.alpha === 'number' && typeof p.beta === 'number')
          ? p.alpha / (p.alpha + p.beta)
          : (p.posteriorProbability ?? 0.5);
        return { probability, weight: sc.weight };
      }),
    );

    const allResolved = allSc.every((sc: { status: string }) =>
      [SubClaimStatus.VERIFIED, SubClaimStatus.FALSIFIED, SubClaimStatus.UNDECIDABLE].includes(sc.status as SubClaimStatus)
    );

    const claimStatus = allResolved
      ? (truthScore >= VERIFIED_THRESHOLD ? ClaimStatus.VERIFIED : ClaimStatus.FALSIFIED)
      : ClaimStatus.DECOMPOSED;

    await db.query(
      `UPDATE claims SET truth_score=$1, status=$2, updated_at=NOW() WHERE id=$3`,
      [truthScore, claimStatus, claimId],
    );

    if (allResolved) {
      await publishEvent(
        EventType.CLAIM_EVALUATED,
        claimId,
        { claimId, loopId: scRows[0].loop_id, truthScore, status: claimStatus },
      );
    }

    await publishEvent(EventType.SUBCLAIM_UPDATED, req.params.id, {
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
  await redis.ping();
  console.log('[epistemology-engine] Redis connected');

  await initDb();

  // Initialize the observability source before binding the listener.
  await epistemologySource.init();
  app.listen(PORT, () => {
    console.log(`[epistemology-engine] Listening on port ${PORT}`);
  });
}

main().catch(err => {
  console.error('[epistemology-engine] Fatal startup error:', err);
  process.exit(1);
});
