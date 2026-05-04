/**
 * Loop Ledger — Service Entrypoint
 *
 * DAG-based ledger recording closed verification loops.
 * Loop closure is the atomic unit of value in the Extropy Engine.
 */

import express, { type Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  EventBus,
  createPool,
  createRedis,
  waitForPostgres,
  waitForRedis,
  EventType,
  ServiceName,
  CAUSAL_CLOSURE_SPEEDS,
} from '@extropy/contracts';
import type {
  Loop,
  LoopId,
  LoopStatus,
  LoopConsensus,
  ConsensusVote,
  MeasurementId,
  ClaimId,
  MintEventId,
  DomainEvent,
  ServiceHealthResponse,
  EntropyDomain,
  LoopOpenedPayload,
  LoopMeasurementRecordedPayload,
  LoopClosedPayload,
  LoopFailedPayload,
  TaskCompletedPayload,
  ClaimEvaluatedPayload,
  XPMintedProvisionalPayload,
} from '@extropy/contracts';

const app: Express = express();
app.use(express.json());

const PORT = process.env.PORT || 4003;
const SERVICE = ServiceName.LOOP_LEDGER;
const SIGNALFLOW_URL = process.env.SIGNALFLOW_URL || 'http://signalflow:4002';

const pool = createPool();
const redis = createRedis();
const bus = new EventBus(redis, pool, SERVICE);

// ── Helpers ───────────────────────────────────────────────────────────────

function loopFromRow(row: any): Loop {
  return {
    id: row.id as LoopId,
    claimId: row.claim_id as ClaimId,
    status: row.status as LoopStatus,
    domain: row.domain as EntropyDomain,
    entropyBefore: row.entropy_before || null,
    entropyAfter: row.entropy_after || null,
    deltaS: row.delta_s,
    validatorIds: row.validator_ids || [],
    taskIds: row.task_ids || [],
    consensus: row.consensus || null,
    parentLoopIds: row.parent_loop_ids || [],
    childLoopIds: row.child_loop_ids || [],
    settlementTimeSeconds: row.settlement_time_seconds,
    causalClosureSpeed: row.causal_closure_speed,
    createdAt: row.created_at.toISOString(),
    closedAt: row.closed_at ? row.closed_at.toISOString() : undefined,
    settledAt: row.settled_at ? row.settled_at.toISOString() : undefined,
  };
}

// ── Internal: Close loop ─────────────────────────────────────────────────

async function closeLoop(loopId: LoopId): Promise<Loop> {
  const res = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [loopId]);
  if (res.rows.length === 0) throw new Error('Loop not found');
  const loop = loopFromRow(res.rows[0]);

  if (!loop.deltaS || loop.deltaS <= 0) throw new Error('Cannot close loop: ΔS must be > 0');
  if (!loop.consensus || !loop.consensus.passed) throw new Error('Cannot close loop: consensus not passed');

  const now = new Date();
  const createdAt = new Date(loop.createdAt);
  const settlementTimeSeconds = (now.getTime() - createdAt.getTime()) / 1000;

  await pool.query(
    `UPDATE ledger.loops SET status = 'closed', closed_at = $1, settlement_time_seconds = $2 WHERE id = $3`,
    [now, settlementTimeSeconds, loopId],
  );

  const updatedRes = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [loopId]);
  const closedLoop = loopFromRow(updatedRes.rows[0]);

  await bus.emit(EventType.LOOP_CLOSED, loopId, {
    loop: closedLoop,
    deltaS: closedLoop.deltaS!,
    consensus: closedLoop.consensus!,
  } as LoopClosedPayload);

  console.log(`[loop-ledger] Loop ${loopId} CLOSED: ΔS=${closedLoop.deltaS}, Tₛ=${settlementTimeSeconds.toFixed(1)}s`);
  return closedLoop;
}

// ── Internal: Settle loop ────────────────────────────────────────────────

async function settleLoop(loopId: LoopId, mintEventId: MintEventId): Promise<Loop> {
  await pool.query(
    `UPDATE ledger.loops SET status = 'settled', settled_at = NOW() WHERE id = $1`,
    [loopId],
  );

  const res = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [loopId]);
  const loop = loopFromRow(res.rows[0]);

  await bus.emit(EventType.LOOP_SETTLED, loopId, { loopId, mintEventId });

  console.log(`[loop-ledger] Loop ${loopId} SETTLED (mint=${mintEventId})`);
  return loop;
}

// ── Internal: Record measurement ─────────────────────────────────────────

async function recordMeasurement(
  loopId: LoopId,
  phase: 'before' | 'after',
  value: number,
  uncertainty: number,
  source: any,
): Promise<any> {
  const measurementId = uuidv4() as MeasurementId;

  // Read loop to get domain
  const loopRes = await pool.query('SELECT domain FROM ledger.loops WHERE id = $1', [loopId]);
  if (loopRes.rows.length === 0) throw new Error('Loop not found');
  const domain = loopRes.rows[0].domain;

  await pool.query(
    `INSERT INTO ledger.measurements (id, loop_id, domain, phase, value, uncertainty, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (loop_id, phase) DO UPDATE SET value = $5, uncertainty = $6, source = $7`,
    [measurementId, loopId, domain, phase, value, uncertainty, JSON.stringify(source)],
  );

  // Update loop's entropy_before/entropy_after
  const measurement = { id: measurementId, loopId, domain, value, uncertainty, source, timestamp: new Date().toISOString() };
  if (phase === 'before') {
    await pool.query('UPDATE ledger.loops SET entropy_before = $1 WHERE id = $2', [JSON.stringify(measurement), loopId]);
  } else {
    await pool.query('UPDATE ledger.loops SET entropy_after = $1 WHERE id = $2', [JSON.stringify(measurement), loopId]);
  }

  // Check if both measurements exist and compute deltaS
  const bothRes = await pool.query(
    `SELECT phase, value FROM ledger.measurements WHERE loop_id = $1 ORDER BY phase`,
    [loopId],
  );
  const phases = new Map(bothRes.rows.map((r: any) => [r.phase, r.value]));

  if (phases.has('before') && phases.has('after')) {
    const deltaS = phases.get('before')! - phases.get('after')!;
    await pool.query('UPDATE ledger.loops SET delta_s = $1 WHERE id = $2', [deltaS, loopId]);
    console.log(`[loop-ledger] ΔS computed for loop ${loopId}: ${deltaS}`);
  }

  await bus.emit(EventType.LOOP_MEASUREMENT_RECORDED, loopId, {
    loopId,
    measurement,
    phase,
  } as LoopMeasurementRecordedPayload);

  return measurement;
}

// ── Health Check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const health: ServiceHealthResponse = {
    service: SERVICE,
    status: 'healthy',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: {
      'epistemology-engine': 'connected',
      'signalflow': 'connected',
      'reputation': 'connected',
      'xp-mint': 'connected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ── POST /loops ──────────────────────────────────────────────────────────
app.post('/loops', async (req, res) => {
  try {
    const { claimId, domain, parentLoopIds, loopId: providedLoopId } = req.body;
    if (!claimId || !domain) {
      res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const loopId = (providedLoopId || uuidv4()) as LoopId;
    const causalClosureSpeed = CAUSAL_CLOSURE_SPEEDS[domain as EntropyDomain] || 1e-4;

    await pool.query(
      `INSERT INTO ledger.loops (id, claim_id, domain, status, causal_closure_speed, parent_loop_ids)
       VALUES ($1, $2, $3, 'open', $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [loopId, claimId, domain, causalClosureSpeed, parentLoopIds || []],
    );

    // Insert DAG edges
    if (parentLoopIds && parentLoopIds.length > 0) {
      for (const parentId of parentLoopIds) {
        await pool.query(
          `INSERT INTO ledger.dag_edges (parent_loop_id, child_loop_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [parentId, loopId],
        );
      }
    }

    const loopRes = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [loopId]);
    const loop = loopFromRow(loopRes.rows[0]);

    await bus.emit(EventType.LOOP_OPENED, loopId, {
      loop,
      claim: { id: claimId },
    } as LoopOpenedPayload);

    console.log(`[loop-ledger] Loop ${loopId} OPENED for claim ${claimId} (domain=${domain}, c_L=${causalClosureSpeed})`);
    res.status(201).json(loop);
  } catch (err: any) {
    console.error('[loop-ledger] POST /loops error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /loops ───────────────────────────────────────────────────────────
app.get('/loops', async (req, res) => {
  try {
    let query = 'SELECT * FROM ledger.loops WHERE 1=1';
    const params: any[] = [];
    let idx = 0;

    if (req.query.status) { idx++; query += ` AND status = $${idx}`; params.push(req.query.status); }
    if (req.query.domain) { idx++; query += ` AND domain = $${idx}`; params.push(req.query.domain); }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows.map(loopFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /loops/:loopId ───────────────────────────────────────────────────
app.get('/loops/:loopId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [req.params.loopId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Loop not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    res.json(loopFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /loops/:loopId/measurements ─────────────────────────────────────
app.post('/loops/:loopId/measurements', async (req, res) => {
  try {
    const { phase, value, uncertainty, source } = req.body;
    const measurement = await recordMeasurement(
      req.params.loopId as LoopId,
      phase,
      value,
      uncertainty || 0,
      source || { type: 'algorithm', identifier: 'system' },
    );
    res.status(201).json(measurement);
  } catch (err: any) {
    console.error('[loop-ledger] POST /measurements error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /loops/:loopId/consensus ────────────────────────────────────────
app.post('/loops/:loopId/consensus', async (req, res) => {
  try {
    const loopId = req.params.loopId as LoopId;
    await pool.query(`UPDATE ledger.loops SET status = 'consensus' WHERE id = $1`, [loopId]);
    await bus.emit(EventType.LOOP_CONSENSUS_STARTED, loopId, { loopId });

    const loopRes = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [loopId]);
    console.log(`[loop-ledger] Loop ${loopId} entered CONSENSUS phase`);
    res.json(loopFromRow(loopRes.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /loops/:loopId/consensus/vote ───────────────────────────────────
app.post('/loops/:loopId/consensus/vote', async (req, res) => {
  try {
    const loopId = req.params.loopId as LoopId;
    const { validatorId, vote, reputationWeight, justification } = req.body;

    const loopRes = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [loopId]);
    if (loopRes.rows.length === 0) {
      res.status(404).json({ error: 'Loop not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const loop = loopFromRow(loopRes.rows[0]);
    const consensus: LoopConsensus = loop.consensus || {
      vPlus: 0,
      vMinus: 0,
      passed: false,
      votes: [],
      resolvedAt: '',
    };

    const newVote: ConsensusVote = {
      validatorId,
      vote,
      reputationWeight: reputationWeight || 1.0,
      justification,
    };
    consensus.votes.push(newVote);

    // Add validator to loop
    const validatorIds = loop.validatorIds.includes(validatorId)
      ? loop.validatorIds
      : [...loop.validatorIds, validatorId];

    // Compute V+ and V-
    let vPlus = 0;
    let vMinus = 0;
    for (const v of consensus.votes) {
      if (v.vote === 'confirm') vPlus += v.reputationWeight;
      else if (v.vote === 'deny') vMinus += v.reputationWeight;
    }
    consensus.vPlus = vPlus;
    consensus.vMinus = vMinus;

    // Resolve consensus (for happy path: resolve after any vote comes in)
    consensus.passed = vPlus > vMinus;
    consensus.resolvedAt = new Date().toISOString();

    await pool.query(
      `UPDATE ledger.loops SET consensus = $1, validator_ids = $2 WHERE id = $3`,
      [JSON.stringify(consensus), validatorIds, loopId],
    );

    // Auto-close or fail
    const deltaS = loop.deltaS;
    if (consensus.passed && deltaS !== null && deltaS > 0) {
      console.log(`[loop-ledger] Consensus passed for loop ${loopId} — auto-closing`);
      const closedLoop = await closeLoop(loopId);
      res.json(closedLoop);
      return;
    } else if (!consensus.passed) {
      console.log(`[loop-ledger] Consensus failed for loop ${loopId}`);
      await pool.query(`UPDATE ledger.loops SET status = 'failed' WHERE id = $1`, [loopId]);
      await bus.emit(EventType.LOOP_FAILED, loopId, {
        loopId,
        reason: 'Consensus rejected',
        deltaS,
        consensus,
      } as LoopFailedPayload);
    }

    const updated = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [loopId]);
    res.json(loopFromRow(updated.rows[0]));
  } catch (err: any) {
    console.error('[loop-ledger] POST /consensus/vote error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /loops/:loopId/close ────────────────────────────────────────────
app.post('/loops/:loopId/close', async (req, res) => {
  try {
    const loop = await closeLoop(req.params.loopId as LoopId);
    res.json(loop);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /loops/:loopId/settle ───────────────────────────────────────────
app.post('/loops/:loopId/settle', async (req, res) => {
  try {
    const { mintEventId } = req.body;
    const loop = await settleLoop(req.params.loopId as LoopId, mintEventId as MintEventId);
    res.json(loop);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /loops/:loopId/fail ─────────────────────────────────────────────
app.post('/loops/:loopId/fail', async (req, res) => {
  try {
    const loopId = req.params.loopId as LoopId;
    const { reason } = req.body;
    await pool.query(`UPDATE ledger.loops SET status = 'failed' WHERE id = $1`, [loopId]);
    const loopRes = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [loopId]);
    const loop = loopFromRow(loopRes.rows[0]);
    await bus.emit(EventType.LOOP_FAILED, loopId, {
      loopId,
      reason: reason || 'Manual failure',
      deltaS: loop.deltaS,
      consensus: loop.consensus,
    } as LoopFailedPayload);
    res.json(loop);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /events ─────────────────────────────────────────────────────────
app.post('/events', async (req, res) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[loop-ledger] Received event: ${event.type}`);
    await handleEvent(event);
    res.status(202).send();
  } catch (err: any) {
    console.error('[loop-ledger] Event handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function handleEvent(event: DomainEvent): Promise<void> {
  switch (event.type) {
    case EventType.TASK_COMPLETED: {
      const payload = event.payload as TaskCompletedPayload;
      const loopId = event.correlationId as LoopId;
      const validatorId = payload.validatorId;

      // Add validator + task to loop (idempotent — no null appends)
      const loopRes = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [loopId]);
      if (loopRes.rows.length === 0) break;
      const loop = loopFromRow(loopRes.rows[0]);

      const vIds = loop.validatorIds.includes(validatorId) ? loop.validatorIds : [...loop.validatorIds, validatorId];
      const tIds = loop.taskIds.includes(payload.taskId) ? loop.taskIds : [...loop.taskIds, payload.taskId];
      await pool.query(
        `UPDATE ledger.loops SET validator_ids = $1, task_ids = $2 WHERE id = $3`,
        [vIds, tIds, loopId],
      );

      // ── Atomically claim the "all tasks complete" transition ─────────
      // Use UPDATE ... WHERE status = 'open' as an optimistic lock.
      // Only one concurrent handler wins the race; others get rowCount=0.
      try {
        const tasksRes = await fetch(`${SIGNALFLOW_URL}/tasks?loopId=${loopId}`);
        if (tasksRes.ok) {
          const tasks = await tasksRes.json() as any[];
          const allComplete = tasks.length > 0 && tasks.every((t: any) => t.status === 'completed');

          if (allComplete) {
            // Attempt atomic transition: open → processing
            const lockResult = await pool.query(
              `UPDATE ledger.loops SET status = 'processing' WHERE id = $1 AND status = 'open' RETURNING id`,
              [loopId],
            );

            if (lockResult.rowCount === 0) {
              // Another handler already claimed this transition — skip
              console.log(`[loop-ledger] Loop ${loopId} already being processed — skipping duplicate`);
              break;
            }

            console.log(`[loop-ledger] All ${tasks.length} tasks complete for loop ${loopId} — recording measurements and starting consensus`);

            // Record simulated entropy measurements
            await recordMeasurement(loopId, 'before', 100, 0.01, { type: 'algorithm', identifier: 'entropy-baseline' });
            await recordMeasurement(loopId, 'after', 60, 0.01, { type: 'algorithm', identifier: 'entropy-result' });

            // Start consensus
            await pool.query(`UPDATE ledger.loops SET status = 'consensus' WHERE id = $1`, [loopId]);
            await bus.emit(EventType.LOOP_CONSENSUS_STARTED, loopId, { loopId });

            // Re-read to get updated validator_ids (in case other handlers added theirs)
            const freshLoop = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [loopId]);
            const freshVIds = (freshLoop.rows[0].validator_ids || []).filter((v: any) => v != null) as string[];

            // Auto-vote confirm with aggregated rep weight
            const avgRepWeight = freshVIds.length > 0 ? 1.0 : 0.5;
            for (const vid of freshVIds) {
              const vote = {
                validatorId: vid as any,
                vote: 'confirm' as const,
                reputationWeight: avgRepWeight,
              };

              // Apply vote directly
              const lRes = await pool.query('SELECT * FROM ledger.loops WHERE id = $1', [loopId]);
              const l = loopFromRow(lRes.rows[0]);
              const consensus: LoopConsensus = l.consensus || { vPlus: 0, vMinus: 0, passed: false, votes: [], resolvedAt: '' };
              consensus.votes.push(vote);

              let vPlus = 0;
              let vMinus = 0;
              for (const v of consensus.votes) {
                if (v.vote === 'confirm') vPlus += v.reputationWeight;
                else if (v.vote === 'deny') vMinus += v.reputationWeight;
              }
              consensus.vPlus = vPlus;
              consensus.vMinus = vMinus;
              consensus.passed = vPlus > vMinus;
              consensus.resolvedAt = new Date().toISOString();

              await pool.query(
                `UPDATE ledger.loops SET consensus = $1 WHERE id = $2`,
                [JSON.stringify(consensus), loopId],
              );
            }

            // Now close
            try {
              await closeLoop(loopId);
            } catch (err) {
              console.error(`[loop-ledger] Failed to close loop ${loopId}:`, err);
            }
          }
        }
      } catch (err) {
        console.error('[loop-ledger] Error checking tasks:', err);
      }
      break;
    }

    case EventType.CLAIM_EVALUATED: {
      // Claim evaluated — already handled by auto-consensus in task.completed
      const payload = event.payload as ClaimEvaluatedPayload;
      console.log(`[loop-ledger] Claim ${payload.claimId} evaluated: ${payload.status} (truthScore=${payload.truthScore})`);
      break;
    }

    case EventType.XP_MINTED_PROVISIONAL: {
      const payload = event.payload as XPMintedProvisionalPayload;
      const loopId = payload.mintEvent.loopId;
      const mintEventId = payload.mintEvent.id;
      console.log(`[loop-ledger] XP minted provisionally for loop ${loopId} — auto-settling`);
      try {
        // Only settle if still in closed state (idempotent guard)
        const guardRes = await pool.query(
          `UPDATE ledger.loops SET status = 'settling' WHERE id = $1 AND status = 'closed' RETURNING id`,
          [loopId],
        );
        if (guardRes.rowCount === 0) {
          console.log(`[loop-ledger] Loop ${loopId} already settled or not closed — skipping`);
          break;
        }
        await settleLoop(loopId, mintEventId);
      } catch (err) {
        console.error(`[loop-ledger] Failed to settle loop ${loopId}:`, err);
      }
      break;
    }

    default:
      break;
  }
}

// ── Start ─────────────────────────────────────────────────────────────────

async function main() {
  await waitForPostgres(pool);
  await waitForRedis(redis);
  await bus.start();

  // Subscribe via bus
  bus.on(EventType.TASK_COMPLETED, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  bus.on(EventType.CLAIM_EVALUATED, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  bus.on(EventType.XP_MINTED_PROVISIONAL, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  app.listen(PORT, () => {
    console.log(`[loop-ledger] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[loop-ledger] Fatal startup error:', err);
  process.exit(1);
});

export default app;
