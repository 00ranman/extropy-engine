/**
 * Epistemology Engine — Service Entrypoint
 *
 * Ingests claims, decomposes them into verifiable sub-claims,
 * and scores truth via Bayesian updating against entropy measurements.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  EventBus,
  createPool,
  createRedis,
  waitForPostgres,
  waitForRedis,
  EventType,
  ServiceName,
  ClaimStatus,
  SubClaimStatus,
} from '@extropy/contracts';
import type {
  Claim,
  ClaimId,
  SubClaim,
  SubClaimId,
  LoopId,
  ValidatorId,
  MeasurementId,
  BayesianPrior,
  BayesianUpdate,
  DomainEvent,
  ServiceHealthResponse,
  EntropyDomain,
  ClaimSubmittedPayload,
  ClaimDecomposedPayload,
  SubClaimUpdatedPayload,
  ClaimEvaluatedPayload,
  TaskCompletedPayload,
} from '@extropy/contracts';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4001;
const SERVICE = ServiceName.EPISTEMOLOGY_ENGINE;
const LOOP_LEDGER_URL = process.env.LOOP_LEDGER_URL || 'http://loop-ledger:4003';
const SIGNALFLOW_URL = process.env.SIGNALFLOW_URL || 'http://signalflow:4002';

const pool = createPool();
const redis = createRedis();
const bus = new EventBus(redis, pool, SERVICE);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInitialPrior(): BayesianPrior {
  return {
    priorProbability: 0.5,
    likelihood: 0.5,
    counterLikelihood: 0.5,
    posteriorProbability: 0.5,
    updateCount: 0,
    confidenceInterval: [0.3, 0.7],
    updateHistory: [],
  };
}

function claimFromRow(row: any): Claim {
  return {
    id: row.id as ClaimId,
    loopId: row.loop_id as LoopId,
    statement: row.statement,
    domain: row.domain as EntropyDomain,
    submitterId: row.submitter_id as ValidatorId,
    status: row.status as ClaimStatus,
    bayesianPrior: row.bayesian_prior,
    subClaimIds: row.sub_claim_ids || [],
    truthScore: row.truth_score || 0,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function subClaimFromRow(row: any): SubClaim {
  return {
    id: row.id as SubClaimId,
    claimId: row.claim_id as ClaimId,
    loopId: row.loop_id as LoopId,
    statement: row.statement,
    domain: row.domain as EntropyDomain,
    status: row.status as SubClaimStatus,
    bayesianPrior: row.bayesian_prior,
    measurementIds: row.measurement_ids || [],
    assignedValidatorIds: row.assigned_validator_ids || [],
    weight: row.weight,
    dependsOn: row.depends_on || [],
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : undefined,
  };
}

// ── Internal: Decompose ──────────────────────────────────────────────────────

async function decomposeClaim(claimId: ClaimId): Promise<SubClaim[]> {
  const claimRes = await pool.query('SELECT * FROM epistemology.claims WHERE id = $1', [claimId]);
  if (claimRes.rows.length === 0) throw new Error('Claim not found');
  const claim = claimFromRow(claimRes.rows[0]);

  const subClaims: SubClaim[] = [];
  const labels = [
    `Baseline measurement: ${claim.statement} — initial state`,
    `Action verification: ${claim.statement} — intervention occurred`,
    `Outcome measurement: ${claim.statement} — result state`,
  ];

  const ids: SubClaimId[] = [];
  for (let i = 0; i < 3; i++) {
    const id = uuidv4() as SubClaimId;
    ids.push(id);
    const prior = makeInitialPrior();
    const dependsOn = i === 0 ? [] : [ids[i - 1]];
    const weight = 1 / 3;

    await pool.query(
      `INSERT INTO epistemology.sub_claims (id, claim_id, loop_id, statement, domain, status, bayesian_prior, weight, depends_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, claimId, claim.loopId, labels[i], claim.domain, SubClaimStatus.PENDING, JSON.stringify(prior), weight, dependsOn],
    );

    subClaims.push({
      id,
      claimId: claim.id,
      loopId: claim.loopId,
      statement: labels[i],
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: prior,
      measurementIds: [],
      assignedValidatorIds: [],
      weight,
      dependsOn,
      createdAt: new Date().toISOString(),
    });
  }

  // Update claim
  await pool.query(
    `UPDATE epistemology.claims SET status = $1, sub_claim_ids = $2, updated_at = NOW() WHERE id = $3`,
    [ClaimStatus.DECOMPOSED, ids, claimId],
  );

  // Emit
  await bus.emit(EventType.CLAIM_DECOMPOSED, claim.loopId, {
    claimId: claim.id,
    subClaims,
  } as ClaimDecomposedPayload);

  console.log(`[epistemology-engine] Decomposed claim ${claimId} into ${ids.length} sub-claims`);
  return subClaims;
}

// ── Internal: Evidence / Bayesian Update ─────────────────────────────────────

async function applyEvidence(
  subClaimId: SubClaimId,
  verdict: 'confirmed' | 'denied',
  confidence: number,
  validatorId: ValidatorId,
  measurementId?: MeasurementId,
): Promise<SubClaim> {
  const res = await pool.query('SELECT * FROM epistemology.sub_claims WHERE id = $1', [subClaimId]);
  if (res.rows.length === 0) throw new Error('SubClaim not found');
  const sc = subClaimFromRow(res.rows[0]);
  const prior = sc.bayesianPrior;

  // Bayesian update
  const likelihood = verdict === 'confirmed' ? confidence : (1 - confidence);
  const counterLikelihood = verdict === 'confirmed' ? (1 - confidence) : confidence;
  const likelihoodRatio = counterLikelihood > 0 ? likelihood / counterLikelihood : 100;
  const numerator = prior.posteriorProbability * likelihoodRatio;
  const denominator = numerator + (1 - prior.posteriorProbability);
  const newPosterior = denominator > 0 ? numerator / denominator : prior.posteriorProbability;

  const update: BayesianUpdate = {
    timestamp: new Date().toISOString(),
    evidenceId: measurementId || subClaimId,
    priorBefore: prior.posteriorProbability,
    posteriorAfter: newPosterior,
    likelihoodRatio,
  };

  const updatedPrior: BayesianPrior = {
    ...prior,
    likelihood,
    counterLikelihood,
    posteriorProbability: newPosterior,
    updateCount: prior.updateCount + 1,
    confidenceInterval: [Math.max(0, newPosterior - 0.15), Math.min(1, newPosterior + 0.15)],
    updateHistory: [...prior.updateHistory, update],
  };

  // Determine new status
  let newStatus: SubClaimStatus = SubClaimStatus.VALIDATING;
  if (newPosterior > 0.7) newStatus = SubClaimStatus.VERIFIED;
  else if (newPosterior < 0.3) newStatus = SubClaimStatus.FALSIFIED;

  // Update assigned validators
  const validators = sc.assignedValidatorIds.includes(validatorId)
    ? sc.assignedValidatorIds
    : [...sc.assignedValidatorIds, validatorId];

  const measurements = measurementId && !sc.measurementIds.includes(measurementId)
    ? [...sc.measurementIds, measurementId]
    : sc.measurementIds;

  await pool.query(
    `UPDATE epistemology.sub_claims
     SET bayesian_prior = $1, status = $2, assigned_validator_ids = $3, measurement_ids = $4,
         resolved_at = CASE WHEN $2 IN ('verified','falsified','undecidable') THEN NOW() ELSE resolved_at END
     WHERE id = $5`,
    [JSON.stringify(updatedPrior), newStatus, validators, measurements, subClaimId],
  );

  // Emit sub-claim updated
  await bus.emit(EventType.SUBCLAIM_UPDATED, sc.loopId, {
    subClaimId: sc.id,
    claimId: sc.claimId,
    newPosterior,
    update,
  } as SubClaimUpdatedPayload);

  console.log(`[epistemology-engine] SubClaim ${subClaimId}: ${verdict} → posterior=${newPosterior.toFixed(3)} → ${newStatus}`);

  // Check if all sub-claims for this claim are resolved
  const allSc = await pool.query(
    `SELECT status FROM epistemology.sub_claims WHERE claim_id = $1`,
    [sc.claimId],
  );
  const allResolved = allSc.rows.every((r: any) =>
    ['verified', 'falsified', 'undecidable'].includes(r.status),
  );
  if (allResolved) {
    console.log(`[epistemology-engine] All sub-claims resolved for claim ${sc.claimId} — evaluating`);
    await evaluateClaim(sc.claimId);
  }

  return { ...sc, bayesianPrior: updatedPrior, status: newStatus };
}

// ── Internal: Evaluate ───────────────────────────────────────────────────────

async function evaluateClaim(claimId: ClaimId): Promise<void> {
  const scRes = await pool.query(
    'SELECT * FROM epistemology.sub_claims WHERE claim_id = $1',
    [claimId],
  );
  const subClaims = scRes.rows.map(subClaimFromRow);

  // Weighted average of posteriors
  let weightedSum = 0;
  let totalWeight = 0;
  for (const sc of subClaims) {
    weightedSum += sc.weight * sc.bayesianPrior.posteriorProbability;
    totalWeight += sc.weight;
  }
  const truthScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  let status: ClaimStatus;
  if (truthScore > 0.6) status = ClaimStatus.VERIFIED;
  else if (truthScore < 0.4) status = ClaimStatus.FALSIFIED;
  else status = ClaimStatus.EVALUATED;

  await pool.query(
    `UPDATE epistemology.claims SET status = $1, truth_score = $2, updated_at = NOW() WHERE id = $3`,
    [status, truthScore, claimId],
  );

  const claimRes = await pool.query('SELECT loop_id FROM epistemology.claims WHERE id = $1', [claimId]);
  const loopId = claimRes.rows[0].loop_id as LoopId;

  await bus.emit(EventType.CLAIM_EVALUATED, loopId, {
    claimId,
    truthScore,
    status,
  } as ClaimEvaluatedPayload);

  console.log(`[epistemology-engine] Claim ${claimId} evaluated: truthScore=${truthScore.toFixed(3)}, status=${status}`);
}

// ── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const health: ServiceHealthResponse = {
    service: SERVICE,
    status: 'healthy',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: {
      'loop-ledger': 'connected',
      'signalflow': 'connected',
      'reputation': 'disconnected',
      'xp-mint': 'disconnected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ── POST /claims ─────────────────────────────────────────────────────────────
app.post('/claims', async (req, res) => {
  try {
    const { statement, domain, submitterId } = req.body;
    if (!statement || !domain || !submitterId) {
      res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const claimId = uuidv4() as ClaimId;
    const loopId = uuidv4() as LoopId;
    const prior = makeInitialPrior();

    await pool.query(
      `INSERT INTO epistemology.claims (id, loop_id, statement, domain, submitter_id, status, bayesian_prior, truth_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [claimId, loopId, statement, domain, submitterId, ClaimStatus.SUBMITTED, JSON.stringify(prior), 0],
    );

    const claim: Claim = {
      id: claimId,
      loopId,
      statement,
      domain,
      submitterId,
      status: ClaimStatus.SUBMITTED,
      bayesianPrior: prior,
      subClaimIds: [],
      truthScore: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Emit claim.submitted
    await bus.emit(EventType.CLAIM_SUBMITTED, loopId, { claim } as ClaimSubmittedPayload);

    // Open a loop in Loop Ledger
    try {
      await fetch(`${LOOP_LEDGER_URL}/loops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, domain, parentLoopIds: [], loopId }),
      });
      console.log(`[epistemology-engine] Opened loop ${loopId} in Loop Ledger`);
    } catch (err) {
      console.error(`[epistemology-engine] Failed to open loop in Ledger:`, err);
    }

    // Auto-decompose
    await decomposeClaim(claimId);

    // Re-read claim after decompose
    const updated = await pool.query('SELECT * FROM epistemology.claims WHERE id = $1', [claimId]);
    const finalClaim = claimFromRow(updated.rows[0]);

    console.log(`[epistemology-engine] Claim ${claimId} created and decomposed`);
    res.status(201).json(finalClaim);
  } catch (err: any) {
    console.error('[epistemology-engine] POST /claims error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /claims ──────────────────────────────────────────────────────────────
app.get('/claims', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM epistemology.claims ORDER BY created_at DESC');
    res.json(result.rows.map(claimFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /claims/:claimId ─────────────────────────────────────────────────────
app.get('/claims/:claimId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM epistemology.claims WHERE id = $1', [req.params.claimId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Claim not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    res.json(claimFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /claims/:claimId/decompose ──────────────────────────────────────────
app.post('/claims/:claimId/decompose', async (req, res) => {
  try {
    const subClaims = await decomposeClaim(req.params.claimId as ClaimId);
    res.status(201).json(subClaims);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /claims/:claimId/evaluate ───────────────────────────────────────────
app.post('/claims/:claimId/evaluate', async (req, res) => {
  try {
    await evaluateClaim(req.params.claimId as ClaimId);
    const result = await pool.query('SELECT * FROM epistemology.claims WHERE id = $1', [req.params.claimId]);
    res.json(claimFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /subclaims/:subClaimId ───────────────────────────────────────────────
app.get('/subclaims/:subClaimId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM epistemology.sub_claims WHERE id = $1', [req.params.subClaimId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'SubClaim not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    res.json(subClaimFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /subclaims/by-claim/:claimId ────────────────────────────────────────
app.get('/subclaims/by-claim/:claimId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM epistemology.sub_claims WHERE claim_id = $1 ORDER BY created_at',
      [req.params.claimId],
    );
    res.json(result.rows.map(subClaimFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /subclaims/:subClaimId/evidence ─────────────────────────────────────
app.post('/subclaims/:subClaimId/evidence', async (req, res) => {
  try {
    const { verdict, confidence, validatorId, measurementId } = req.body;
    const sc = await applyEvidence(
      req.params.subClaimId as SubClaimId,
      verdict,
      confidence || 0.85,
      validatorId,
      measurementId,
    );
    res.json(sc);
  } catch (err: any) {
    console.error('[epistemology-engine] POST /subclaims/evidence error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /events ─────────────────────────────────────────────────────────────
app.post('/events', async (req, res) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[epistemology-engine] Received event: ${event.type}`);

    switch (event.type) {
      case EventType.TASK_COMPLETED: {
        const payload = event.payload as TaskCompletedPayload;
        // Look up which sub-claim this task was for
        // We need to find the sub-claim by querying signalflow for the task
        try {
          const taskRes = await fetch(`${SIGNALFLOW_URL}/tasks/${payload.taskId}`);
          if (taskRes.ok) {
            const task = await taskRes.json() as any;
            const rawVerdict = String(payload.result.verdict);
            const verdict = (rawVerdict === 'confirmed' || rawVerdict === 'supported') ? 'confirmed' as const : 'denied' as const;
            await applyEvidence(
              task.subClaimId as SubClaimId,
              verdict,
              payload.result.confidence,
              payload.validatorId,
            );
          }
        } catch (err) {
          console.error('[epistemology-engine] Error processing task.completed:', err);
        }
        break;
      }
      default:
        break;
    }

    res.status(202).send();
  } catch (err: any) {
    console.error('[epistemology-engine] Event handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  await waitForPostgres(pool);
  await waitForRedis(redis);
  await bus.start();

  // Subscribe to task.completed events via bus
  bus.on(EventType.TASK_COMPLETED, async (event) => {
    const payload = event.payload as TaskCompletedPayload;
    try {
      const taskRes = await fetch(`${SIGNALFLOW_URL}/tasks/${payload.taskId}`);
      if (taskRes.ok) {
        const task = await taskRes.json() as any;
        const rawVerdict2 = String(payload.result.verdict);
        const verdict = (rawVerdict2 === 'confirmed' || rawVerdict2 === 'supported') ? 'confirmed' as const : 'denied' as const;
        await applyEvidence(
          task.subClaimId as SubClaimId,
          verdict,
          payload.result.confidence,
          payload.validatorId,
        );
      }
    } catch (err) {
      console.error('[epistemology-engine] Error handling TASK_COMPLETED via bus:', err);
    }
  });

  app.listen(PORT, () => {
    console.log(`[epistemology-engine] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[epistemology-engine] Fatal startup error:', err);
  process.exit(1);
});

export default app;
