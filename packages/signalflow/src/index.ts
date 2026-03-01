/**
 * SignalFlow Orchestrator — Service Entrypoint
 *
 * Routes validation tasks to human/AI validators based on domain expertise,
 * reputation, load, and historical accuracy. Manages task lifecycle.
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
  TaskStatus,
} from '@extropy/contracts';
import type {
  TaskId,
  SubClaimId,
  LoopId,
  ValidatorId,
  DomainEvent,
  ServiceHealthResponse,
  TaskCreatedPayload,
  TaskAssignedPayload,
  TaskCompletedPayload,
} from '@extropy/contracts';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4002;
const SERVICE = ServiceName.SIGNALFLOW;

const pool = createPool();
const redis = createRedis();
const bus = new EventBus(redis, pool, SERVICE);

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoutingDecision {
  strategy: string;
  selectedValidatorId: ValidatorId;
  candidateCount: number;
  score: number;
  factors: {
    reputationScore: number;
    domainExpertise: number;
    currentLoad: number;
    historicalAccuracy: number;
    responseTimeScore: number;
  };
  alternativesConsidered: Array<{ validatorId: string; score: number; rejectionReason?: string }>;
}

interface TaskRouting {
  taskId: TaskId;
  subClaimId: SubClaimId;
  loopId: LoopId;
  assignedValidatorId: ValidatorId;
  status: TaskStatus;
  priority: number;
  deadline?: string;
  completedAt?: string;
  result?: { verdict: string; confidence: number; reasoning?: string; evidence?: string[] };
  routingDecision: RoutingDecision;
  reassignmentCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ValidatorProfile {
  validatorId: ValidatorId;
  type: 'human' | 'ai' | 'hybrid';
  domains: string[];
  isAvailable: boolean;
  currentLoad: number;
  maxLoad: number;
  reputationScore: number;
  domainExpertise: Record<string, number>;
  historicalAccuracy: number;
  avgResponseTimeSeconds: number;
  lastActiveAt: string;
}

// ── Routing helpers ───────────────────────────────────────────────────────────

async function getValidatorsForDomain(domain: string): Promise<ValidatorProfile[]> {
  const res = await pool.query(
    `SELECT * FROM signalflow.validators
     WHERE is_available = true AND current_load < max_load
       AND (domains @> $1::text[] OR cardinality(domains) = 0)
     ORDER BY reputation_score DESC`,
    [JSON.stringify([domain])],
  );
  return res.rows.map((r: any) => ({
    validatorId: r.validator_id as ValidatorId,
    type: r.type,
    domains: r.domains,
    isAvailable: r.is_available,
    currentLoad: r.current_load,
    maxLoad: r.max_load,
    reputationScore: r.reputation_score,
    domainExpertise: r.domain_expertise || {},
    historicalAccuracy: r.historical_accuracy || 0.5,
    avgResponseTimeSeconds: r.avg_response_time_seconds || 3600,
    lastActiveAt: r.last_active_at?.toISOString() || new Date().toISOString(),
  }));
}

function scoreValidator(v: ValidatorProfile, domain: string): number {
  const expertise = v.domainExpertise[domain] || 0.5;
  const loadFactor = v.maxLoad > 0 ? 1 - v.currentLoad / v.maxLoad : 0;
  const timeFactor = Math.min(1, 3600 / (v.avgResponseTimeSeconds || 3600));
  return (
    0.35 * v.reputationScore +
    0.25 * expertise +
    0.20 * loadFactor +
    0.15 * v.historicalAccuracy +
    0.05 * timeFactor
  );
}

async function selectValidator(
  domain: string,
  excludeIds: ValidatorId[] = [],
  strategy = 'weighted_random',
): Promise<{ validator: ValidatorProfile; decision: RoutingDecision }> {
  const candidates = (await getValidatorsForDomain(domain))
    .filter(v => !excludeIds.includes(v.validatorId));

  if (candidates.length === 0) throw new Error('No eligible validators available');

  const scored = candidates.map(v => ({ v, score: scoreValidator(v, domain) }));
  scored.sort((a, b) => b.score - a.score);

  let selected = scored[0];

  if (strategy === 'weighted_random' && scored.length > 1) {
    // Softmax-style weighted random
    const totalScore = scored.reduce((acc, s) => acc + s.score, 0);
    let rand = Math.random() * totalScore;
    for (const s of scored) {
      rand -= s.score;
      if (rand <= 0) { selected = s; break; }
    }
  }

  const decision: RoutingDecision = {
    strategy,
    selectedValidatorId: selected.v.validatorId,
    candidateCount: candidates.length,
    score: selected.score,
    factors: {
      reputationScore: selected.v.reputationScore,
      domainExpertise: selected.v.domainExpertise[domain] || 0.5,
      currentLoad: selected.v.currentLoad,
      historicalAccuracy: selected.v.historicalAccuracy,
      responseTimeScore: Math.min(1, 3600 / (selected.v.avgResponseTimeSeconds || 3600)),
    },
    alternativesConsidered: scored
      .filter(s => s.v.validatorId !== selected.v.validatorId)
      .slice(0, 5)
      .map(s => ({ validatorId: s.v.validatorId, score: s.score })),
  };

  return { validator: selected.v, decision };
}

function taskFromRow(row: any): TaskRouting {
  return {
    taskId: row.task_id as TaskId,
    subClaimId: row.sub_claim_id as SubClaimId,
    loopId: row.loop_id as LoopId,
    assignedValidatorId: row.assigned_validator_id as ValidatorId,
    status: row.status as TaskStatus,
    priority: row.priority,
    deadline: row.deadline?.toISOString(),
    completedAt: row.completed_at?.toISOString(),
    result: row.result,
    routingDecision: row.routing_decision,
    reassignmentCount: row.reassignment_count || 0,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function validatorFromRow(row: any): ValidatorProfile {
  return {
    validatorId: row.validator_id as ValidatorId,
    type: row.type,
    domains: row.domains || [],
    isAvailable: row.is_available,
    currentLoad: row.current_load,
    maxLoad: row.max_load || 10,
    reputationScore: row.reputation_score || 0.5,
    domainExpertise: row.domain_expertise || {},
    historicalAccuracy: row.historical_accuracy || 0.5,
    avgResponseTimeSeconds: row.avg_response_time_seconds || 3600,
    lastActiveAt: row.last_active_at?.toISOString() || new Date().toISOString(),
  };
}

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  const h: ServiceHealthResponse = {
    service: SERVICE,
    status: 'healthy',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: {} as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(h);
});

// ── POST /tasks ───────────────────────────────────────────────────────────────

app.post('/tasks', async (req, res) => {
  try {
    const { subClaimId, loopId, domain = 'general', priority = 5, preferredStrategy, deadline, excludeValidators = [] } = req.body;
    if (!subClaimId || !loopId) {
      res.status(400).json({ error: 'subClaimId and loopId are required', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const { validator, decision } = await selectValidator(domain, excludeValidators as ValidatorId[], preferredStrategy);

    const taskId = uuidv4() as TaskId;
    const dl = deadline || new Date(Date.now() + 3600 * 1000).toISOString();

    await pool.query(
      `INSERT INTO signalflow.tasks (task_id, sub_claim_id, loop_id, assigned_validator_id, status, priority, deadline, routing_decision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [taskId, subClaimId, loopId, validator.validatorId, TaskStatus.ASSIGNED, priority, dl, JSON.stringify(decision)],
    );

    // Increment validator load
    await pool.query(
      `UPDATE signalflow.validators SET current_load = current_load + 1, last_active_at = NOW() WHERE validator_id = $1`,
      [validator.validatorId],
    );

    const task = await pool.query('SELECT * FROM signalflow.tasks WHERE task_id = $1', [taskId]);
    const t = taskFromRow(task.rows[0]);

    await bus.emit(EventType.TASK_CREATED, loopId as LoopId, { taskId, subClaimId, loopId, validatorId: validator.validatorId } as TaskCreatedPayload);
    await bus.emit(EventType.TASK_ASSIGNED, loopId as LoopId, { taskId, validatorId: validator.validatorId, decision } as TaskAssignedPayload);

    console.log(`[signalflow] Task ${taskId} created and assigned to validator ${validator.validatorId}`);
    res.status(201).json(t);
  } catch (err: any) {
    console.error('[signalflow] POST /tasks error:', err);
    const status = err.message.includes('No eligible') ? 503 : 500;
    res.status(status).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /tasks ────────────────────────────────────────────────────────────────

app.get('/tasks', async (req, res) => {
  try {
    const { status, validatorId, loopId, priority, page = 1, pageSize = 20 } = req.query;
    let query = 'SELECT * FROM signalflow.tasks WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (status) { query += ` AND status = $${idx++}`; params.push(status); }
    if (validatorId) { query += ` AND assigned_validator_id = $${idx++}`; params.push(validatorId); }
    if (loopId) { query += ` AND loop_id = $${idx++}`; params.push(loopId); }
    if (priority) { query += ` AND priority >= $${idx++}`; params.push(Number(priority)); }

    const countRes = await pool.query(`SELECT COUNT(*) FROM signalflow.tasks WHERE 1=1`, []);
    const total = parseInt(countRes.rows[0].count);

    query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

    const result = await pool.query(query, params);
    res.json({ items: result.rows.map(taskFromRow), total, page: Number(page), pageSize: Number(pageSize) });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /tasks/:taskId ────────────────────────────────────────────────────────

app.get('/tasks/:taskId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM signalflow.tasks WHERE task_id = $1', [req.params.taskId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Task not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    res.json(taskFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /tasks/:taskId/complete ──────────────────────────────────────────────

app.post('/tasks/:taskId/complete', async (req, res) => {
  try {
    const { verdict, confidence, validatorId, reasoning, evidence } = req.body;
    const taskRes = await pool.query('SELECT * FROM signalflow.tasks WHERE task_id = $1', [req.params.taskId]);
    if (taskRes.rows.length === 0) {
      res.status(404).json({ error: 'Task not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    const t = taskFromRow(taskRes.rows[0]);
    if ([TaskStatus.COMPLETED, TaskStatus.TIMED_OUT].includes(t.status)) {
      res.status(409).json({ error: 'Task already completed or timed out', code: 'CONFLICT', timestamp: new Date().toISOString() });
      return;
    }

    const result = { verdict, confidence, reasoning, evidence };
    await pool.query(
      `UPDATE signalflow.tasks SET status = $1, result = $2, completed_at = NOW(), updated_at = NOW() WHERE task_id = $3`,
      [TaskStatus.COMPLETED, JSON.stringify(result), req.params.taskId],
    );

    // Decrement load
    await pool.query(
      `UPDATE signalflow.validators SET current_load = GREATEST(0, current_load - 1) WHERE validator_id = $1`,
      [t.assignedValidatorId],
    );

    const updated = await pool.query('SELECT * FROM signalflow.tasks WHERE task_id = $1', [req.params.taskId]);
    const updatedTask = taskFromRow(updated.rows[0]);

    await bus.emit(EventType.TASK_COMPLETED, t.loopId, {
      taskId: t.taskId,
      subClaimId: t.subClaimId,
      loopId: t.loopId,
      validatorId: validatorId || t.assignedValidatorId,
      result,
    } as TaskCompletedPayload);

    console.log(`[signalflow] Task ${t.taskId} completed: verdict=${verdict}, confidence=${confidence}`);
    res.json(updatedTask);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /tasks/:taskId/reassign ──────────────────────────────────────────────

app.post('/tasks/:taskId/reassign', async (req, res) => {
  try {
    const { reason = 'manual_override', excludeValidators = [] } = req.body;
    const taskRes = await pool.query('SELECT * FROM signalflow.tasks WHERE task_id = $1', [req.params.taskId]);
    if (taskRes.rows.length === 0) {
      res.status(404).json({ error: 'Task not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    const t = taskFromRow(taskRes.rows[0]);

    // Get domain from sub-claim (fall back to 'general')
    const domain = 'general';
    const excluded = [t.assignedValidatorId, ...excludeValidators] as ValidatorId[];
    const { validator, decision } = await selectValidator(domain, excluded);

    // Decrement old validator
    await pool.query(
      `UPDATE signalflow.validators SET current_load = GREATEST(0, current_load - 1) WHERE validator_id = $1`,
      [t.assignedValidatorId],
    );

    await pool.query(
      `UPDATE signalflow.tasks SET assigned_validator_id = $1, status = $2, routing_decision = $3,
       reassignment_count = reassignment_count + 1, updated_at = NOW() WHERE task_id = $4`,
      [validator.validatorId, TaskStatus.REASSIGNED, JSON.stringify(decision), req.params.taskId],
    );

    // Increment new validator
    await pool.query(
      `UPDATE signalflow.validators SET current_load = current_load + 1 WHERE validator_id = $1`,
      [validator.validatorId],
    );

    const updated = await pool.query('SELECT * FROM signalflow.tasks WHERE task_id = $1', [req.params.taskId]);
    console.log(`[signalflow] Task ${t.taskId} reassigned to ${validator.validatorId} (reason: ${reason})`);
    res.json(taskFromRow(updated.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /routing/simulate ────────────────────────────────────────────────────

app.post('/routing/simulate', async (req, res) => {
  try {
    const { subClaimId, domain = 'general', strategy } = req.body;
    if (!subClaimId) {
      res.status(400).json({ error: 'subClaimId is required', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }
    const { decision } = await selectValidator(domain, [], strategy);
    res.json(decision);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /routing/config ───────────────────────────────────────────────────────

app.get('/routing/config', async (_req, res) => {
  res.json({
    defaultStrategy: 'weighted_random',
    weights: { reputation: 0.35, domainExpertise: 0.25, currentLoad: 0.20, historicalAccuracy: 0.15, responseTime: 0.05 },
    timeoutSeconds: 3600,
    maxReassignments: 3,
  });
});

// ── GET /validators ───────────────────────────────────────────────────────────

app.get('/validators', async (req, res) => {
  try {
    const { domain, available } = req.query;
    let query = 'SELECT * FROM signalflow.validators WHERE 1=1';
    const params: any[] = [];
    let idx = 1;
    if (domain) { query += ` AND domains @> $${idx++}::text[]`; params.push(JSON.stringify([domain])); }
    if (available !== undefined) { query += ` AND is_available = $${idx++}`; params.push(available === 'true'); }
    query += ' ORDER BY reputation_score DESC';
    const result = await pool.query(query, params);
    res.json(result.rows.map(validatorFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /validators ──────────────────────────────────────────────────────────

app.post('/validators', async (req, res) => {
  try {
    const { validatorId, type, domains, maxLoad = 10, domainExpertise = {} } = req.body;
    if (!validatorId || !type || !domains) {
      res.status(400).json({ error: 'validatorId, type, and domains are required', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }
    await pool.query(
      `INSERT INTO signalflow.validators (validator_id, type, domains, max_load, domain_expertise)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (validator_id) DO UPDATE SET type = $2, domains = $3, max_load = $4, domain_expertise = $5`,
      [validatorId, type, domains, maxLoad, JSON.stringify(domainExpertise)],
    );
    const result = await pool.query('SELECT * FROM signalflow.validators WHERE validator_id = $1', [validatorId]);
    res.status(201).json(validatorFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /validators/:validatorId ──────────────────────────────────────────────

app.get('/validators/:validatorId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM signalflow.validators WHERE validator_id = $1', [req.params.validatorId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Validator not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    res.json(validatorFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── PATCH /validators/:validatorId ────────────────────────────────────────────

app.patch('/validators/:validatorId', async (req, res) => {
  try {
    const { isAvailable, domains, domainExpertise, maxLoad } = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (isAvailable !== undefined) { updates.push(`is_available = $${idx++}`); params.push(isAvailable); }
    if (domains) { updates.push(`domains = $${idx++}`); params.push(domains); }
    if (domainExpertise) { updates.push(`domain_expertise = $${idx++}`); params.push(JSON.stringify(domainExpertise)); }
    if (maxLoad !== undefined) { updates.push(`max_load = $${idx++}`); params.push(maxLoad); }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    updates.push(`updated_at = NOW()`);
    params.push(req.params.validatorId);
    await pool.query(`UPDATE signalflow.validators SET ${updates.join(', ')} WHERE validator_id = $${idx}`, params);

    const result = await pool.query('SELECT * FROM signalflow.validators WHERE validator_id = $1', [req.params.validatorId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Validator not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    res.json(validatorFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /events ──────────────────────────────────────────────────────────────

app.post('/events', async (req, res) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[signalflow] Received event: ${event.type}`);
    res.status(202).send();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  await waitForPostgres(pool);
  await waitForRedis(redis);
  await bus.start();

  app.listen(PORT, () => {
    console.log(`[signalflow] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[signalflow] Fatal startup error:', err);
  process.exit(1);
});

export default app;
