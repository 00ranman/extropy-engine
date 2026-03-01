/**
 * Reputation Service — Service Entrypoint
 *
 * Computes validator reputation as compressed evidence of past
 * verification accuracy. Feeds back into SignalFlow routing weights
 * and the XP mint formula's R factor.
 *
 * Reputation dynamics:
 *   Accrual:  R_i(t+1) = R_i(t) + α · XP_t
 *   Decay:    R_i(t)   = R_i(t-1) · (1 - γ)
 *   Penalty:  R_i(t)   = R_i(t) - penalty
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
} from '@extropy/contracts';
import type {
  ValidatorId,
  DomainEvent,
  ServiceHealthResponse,
  EntropyDomain,
  LoopId,
  ReputationAccruedPayload,
  ReputationPenalizedPayload,
  LoopClosedPayload,
} from '@extropy/contracts';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4004;
const SERVICE = ServiceName.REPUTATION;

// ── Reputation Constants ──────────────────────────────────────────────────────
const DEFAULT_ACCRUAL_RATE = 0.1;
const DEFAULT_DECAY_RATE = 0.02;
const INITIAL_REPUTATION = 1.0;
const STREAK_BONUS_MULTIPLIER = 0.05;

const ALL_DOMAINS: EntropyDomain[] = ['cognitive', 'code', 'social', 'economic', 'thermodynamic', 'informational'] as EntropyDomain[];

const pool = createPool();
const redis = createRedis();
const bus = new EventBus(redis, pool, SERVICE);

// ── Helpers ───────────────────────────────────────────────────────────────────

function validatorFromRow(row: any): any {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    domains: row.domains || [],
    aggregateReputation: row.aggregate_reputation,
    reputationByDomain: row.reputation_by_domain || {},
    accrualRate: row.accrual_rate,
    decayRate: row.decay_rate,
    currentStreak: row.current_streak,
    penaltyCount: row.penalty_count,
    totalXpEarned: row.total_xp_earned,
    loopsParticipated: row.loops_participated,
    accurateValidations: row.accurate_validations,
    currentTaskCount: row.current_task_count,
    maxConcurrentTasks: row.max_concurrent_tasks,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    lastActiveAt: row.last_active_at.toISOString(),
    // Also include snake_case for SignalFlow compatibility
    aggregate_reputation: row.aggregate_reputation,
    current_task_count: row.current_task_count,
    max_concurrent_tasks: row.max_concurrent_tasks,
    accurate_validations: row.accurate_validations,
    loops_participated: row.loops_participated,
  };
}

// ── Internal: Accrue ──────────────────────────────────────────────────────────

async function accrueReputation(
  validatorId: ValidatorId,
  domain: EntropyDomain,
  xpEarned: number,
  loopId: LoopId,
): Promise<any> {
  const res = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [validatorId]);
  if (res.rows.length === 0) throw new Error(`Validator ${validatorId} not found`);
  const row = res.rows[0];

  const accrualRate = row.accrual_rate || DEFAULT_ACCRUAL_RATE;
  const currentStreak = row.current_streak || 0;
  const effectiveRate = accrualRate + (currentStreak * STREAK_BONUS_MULTIPLIER);
  const delta = effectiveRate * xpEarned;

  const repByDomain = row.reputation_by_domain || {};
  repByDomain[domain] = (repByDomain[domain] || INITIAL_REPUTATION) + delta;

  // Recompute aggregate = average of non-zero domain reps
  const domainValues = Object.values(repByDomain).filter((v: any) => v > 0) as number[];
  const aggregate = domainValues.length > 0 ? domainValues.reduce((a, b) => a + b, 0) / domainValues.length : INITIAL_REPUTATION;

  await pool.query(
    `UPDATE reputation.validators
     SET reputation_by_domain = $1, aggregate_reputation = $2,
         current_streak = current_streak + 1,
         loops_participated = loops_participated + 1,
         accurate_validations = accurate_validations + 1,
         total_xp_earned = total_xp_earned + $3,
         last_active_at = NOW()
     WHERE id = $4`,
    [JSON.stringify(repByDomain), aggregate, xpEarned, validatorId],
  );

  // Record event
  await pool.query(
    `INSERT INTO reputation.events (validator_id, type, domain, delta, reason, related_loop_id)
     VALUES ($1, 'accrual', $2, $3, $4, $5)`,
    [validatorId, domain, delta, `Accrual for loop closure (XP=${xpEarned.toFixed(2)})`, loopId],
  );

  await bus.emit(EventType.REPUTATION_ACCRUED, loopId, {
    validatorId,
    domain,
    delta,
    newAggregate: aggregate,
    relatedLoopId: loopId,
  } as ReputationAccruedPayload);

  console.log(`[reputation] Accrued ${delta.toFixed(4)} rep for validator ${validatorId} in ${domain} (streak=${currentStreak + 1})`);

  const updated = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [validatorId]);
  return validatorFromRow(updated.rows[0]);
}

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const health: ServiceHealthResponse = {
    service: SERVICE,
    status: 'healthy',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: {
      'epistemology-engine': 'disconnected',
      'signalflow': 'connected',
      'loop-ledger': 'connected',
      'xp-mint': 'connected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ── POST /validators ──────────────────────────────────────────────────────────
app.post('/validators', async (req, res) => {
  try {
    const { name, type, domains } = req.body;
    if (!name || !type || !domains) {
      res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const validatorId = uuidv4();
    const repByDomain: Record<string, number> = {};
    for (const d of ALL_DOMAINS) {
      repByDomain[d] = domains.includes(d) ? INITIAL_REPUTATION : 0;
    }

    await pool.query(
      `INSERT INTO reputation.validators (id, name, type, domains, aggregate_reputation, reputation_by_domain)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [validatorId, name, type, domains, INITIAL_REPUTATION, JSON.stringify(repByDomain)],
    );

    const result = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [validatorId]);
    console.log(`[reputation] Registered validator ${validatorId}: ${name} (${type})`);
    res.status(201).json(validatorFromRow(result.rows[0]));
  } catch (err: any) {
    console.error('[reputation] POST /validators error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /validators ───────────────────────────────────────────────────────────
app.get('/validators', async (req, res) => {
  try {
    let query = 'SELECT * FROM reputation.validators WHERE 1=1';
    const params: any[] = [];
    let idx = 0;

    if (req.query.domain) {
      idx++;
      query += ` AND $${idx} = ANY(domains)`;
      params.push(req.query.domain);
    }
    if (req.query.active !== undefined) {
      idx++;
      query += ` AND is_active = $${idx}`;
      params.push(req.query.active === 'true');
    }
    query += ' ORDER BY aggregate_reputation DESC';

    const result = await pool.query(query, params);
    res.json(result.rows.map(validatorFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /validators/:validatorId ──────────────────────────────────────────────
app.get('/validators/:validatorId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [req.params.validatorId]);
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
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 0;

    if (req.body.name !== undefined) { idx++; fields.push(`name = $${idx}`); values.push(req.body.name); }
    if (req.body.isActive !== undefined) { idx++; fields.push(`is_active = $${idx}`); values.push(req.body.isActive); }
    if (req.body.domains !== undefined) { idx++; fields.push(`domains = $${idx}`); values.push(req.body.domains); }

    if (fields.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    idx++;
    values.push(req.params.validatorId);
    await pool.query(`UPDATE reputation.validators SET ${fields.join(', ')} WHERE id = $${idx}`, values);

    const result = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [req.params.validatorId]);
    res.json(validatorFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /validators/:validatorId/reputation ───────────────────────────────────
app.get('/validators/:validatorId/reputation', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [req.params.validatorId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Validator not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    const row = result.rows[0];
    res.json({
      aggregate: row.aggregate_reputation,
      byDomain: row.reputation_by_domain,
      accrualRate: row.accrual_rate,
      decayRate: row.decay_rate,
      currentStreak: row.current_streak,
      penaltyCount: row.penalty_count,
      lastUpdatedAt: row.last_active_at.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /validators/:validatorId/reputation/history ───────────────────────────
app.get('/validators/:validatorId/reputation/history', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM reputation.events WHERE validator_id = $1 ORDER BY timestamp DESC LIMIT 100',
      [req.params.validatorId],
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /reputation/accrue ───────────────────────────────────────────────────
app.post('/reputation/accrue', async (req, res) => {
  try {
    const { validatorId, domain, xpEarned, loopId } = req.body;
    const updated = await accrueReputation(validatorId, domain, xpEarned || 1.0, loopId);
    res.json(updated);
  } catch (err: any) {
    console.error('[reputation] POST /reputation/accrue error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /reputation/penalize ─────────────────────────────────────────────────
app.post('/reputation/penalize', async (req, res) => {
  try {
    const { validatorId, domain, penalty, reason, loopId } = req.body;

    const vRes = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [validatorId]);
    if (vRes.rows.length === 0) {
      res.status(404).json({ error: 'Validator not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    const row = vRes.rows[0];

    const repByDomain = row.reputation_by_domain || {};
    repByDomain[domain] = Math.max(0, (repByDomain[domain] || 0) - penalty);

    const domainValues = Object.values(repByDomain).filter((v: any) => v > 0) as number[];
    const aggregate = domainValues.length > 0 ? domainValues.reduce((a, b) => a + b, 0) / domainValues.length : 0;

    await pool.query(
      `UPDATE reputation.validators
       SET reputation_by_domain = $1, aggregate_reputation = $2,
           current_streak = 0, penalty_count = penalty_count + 1
       WHERE id = $3`,
      [JSON.stringify(repByDomain), aggregate, validatorId],
    );

    await pool.query(
      `INSERT INTO reputation.events (validator_id, type, domain, delta, reason, related_loop_id)
       VALUES ($1, 'penalty', $2, $3, $4, $5)`,
      [validatorId, domain, -penalty, reason, loopId],
    );

    await bus.emit(EventType.REPUTATION_PENALIZED, loopId, {
      validatorId,
      domain,
      penalty,
      reason,
      relatedLoopId: loopId,
    } as ReputationPenalizedPayload);

    const updated = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [validatorId]);
    res.json(validatorFromRow(updated.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /reputation/decay ────────────────────────────────────────────────────
app.post('/reputation/decay', async (req, res) => {
  try {
    const thresholdHours = req.body.thresholdHours || 24;
    const result = await pool.query(
      `SELECT * FROM reputation.validators WHERE last_active_at < NOW() - INTERVAL '1 hour' * $1`,
      [thresholdHours],
    );

    let affected = 0;
    for (const row of result.rows) {
      const repByDomain = row.reputation_by_domain || {};
      const decayRate = row.decay_rate || DEFAULT_DECAY_RATE;

      for (const domain of Object.keys(repByDomain)) {
        repByDomain[domain] = repByDomain[domain] * (1 - decayRate);
      }

      const domainValues = Object.values(repByDomain).filter((v: any) => v > 0) as number[];
      const aggregate = domainValues.length > 0 ? domainValues.reduce((a, b) => a + b, 0) / domainValues.length : 0;

      await pool.query(
        `UPDATE reputation.validators SET reputation_by_domain = $1, aggregate_reputation = $2 WHERE id = $3`,
        [JSON.stringify(repByDomain), aggregate, row.id],
      );

      affected++;
    }

    res.json({ affectedValidators: affected });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /reputation/bulk ─────────────────────────────────────────────────────
app.post('/reputation/bulk', async (req, res) => {
  try {
    const { validatorIds } = req.body;
    if (!validatorIds || validatorIds.length === 0) {
      res.json({});
      return;
    }

    const placeholders = validatorIds.map((_: any, i: number) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT id, aggregate_reputation, reputation_by_domain FROM reputation.validators WHERE id IN (${placeholders})`,
      validatorIds,
    );

    const map: Record<string, any> = {};
    for (const row of result.rows) {
      map[row.id] = {
        aggregate: row.aggregate_reputation,
        byDomain: row.reputation_by_domain,
      };
    }
    res.json(map);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /reputation/leaderboard ───────────────────────────────────────────────
app.get('/reputation/leaderboard', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM reputation.validators WHERE is_active = TRUE ORDER BY aggregate_reputation DESC LIMIT 50',
    );
    res.json(result.rows.map(validatorFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /events ──────────────────────────────────────────────────────────────
app.post('/events', async (req, res) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[reputation] Received event: ${event.type}`);

    switch (event.type) {
      case EventType.LOOP_CLOSED: {
        const payload = event.payload as LoopClosedPayload;
        const loop = payload.loop;
        const validVids = (loop.validatorIds || []).filter((v: any) => v != null);
        for (const vid of validVids) {
          try {
            await accrueReputation(vid, loop.domain, payload.deltaS, loop.id);
          } catch (err) {
            console.error(`[reputation] Failed to accrue rep for ${vid}:`, err);
          }
        }
        break;
      }
      default:
        break;
    }

    res.status(202).send();
  } catch (err: any) {
    console.error('[reputation] Event handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  await waitForPostgres(pool);
  await waitForRedis(redis);
  await bus.start();

  // Subscribe via bus
  bus.on(EventType.LOOP_CLOSED, async (event) => {
    const payload = event.payload as LoopClosedPayload;
    const loop = payload.loop;
    const validVids = (loop.validatorIds || []).filter((v: any) => v != null);
    for (const vid of validVids) {
      try {
        await accrueReputation(vid, loop.domain, payload.deltaS, loop.id);
      } catch (err) {
        console.error(`[reputation] Bus: Failed to accrue rep for ${vid}:`, err);
      }
    }
  });

  app.listen(PORT, () => {
    console.log(`[reputation] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[reputation] Fatal startup error:', err);
  process.exit(1);
});

export default app;
