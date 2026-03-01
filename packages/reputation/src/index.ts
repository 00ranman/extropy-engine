/**
 * Reputation Service — Service Entrypoint
 *
 * Computes validator reputation as compressed evidence of past verification
 * accuracy. Reputation feeds back into SignalFlow routing weights and the
 * XP mint formula's R factor.
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
  LoopId,
  DomainEvent,
  ServiceHealthResponse,
  EntropyDomain,
  LoopClosedPayload,
  XPMintedFinalPayload,
} from '@extropy/contracts';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4004;
const SERVICE = ServiceName.REPUTATION;

const pool = createPool();
const redis = createRedis();
const bus = new EventBus(redis, pool, SERVICE);

// ── Constants ─────────────────────────────────────────────────────────────
const DEFAULT_ACCRUAL_RATE = 0.1;   // α
const DEFAULT_DECAY_RATE   = 0.01;  // γ
const INITIAL_REPUTATION   = 1.0;

// ── Helpers ───────────────────────────────────────────────────────────────

function validatorFromRow(row: any) {
  return {
    id:          row.id as ValidatorId,
    name:        row.name as string,
    domains:     row.domains as EntropyDomain[],
    reputation:  row.reputation as number,
    accuracy:    row.accuracy as number,
    totalLoops:  row.total_loops as number,
    isActive:    row.is_active as boolean,
    createdAt:   row.created_at.toISOString(),
    updatedAt:   row.updated_at?.toISOString(),
  };
}

function repEventFromRow(row: any) {
  return {
    id:          row.id,
    validatorId: row.validator_id as ValidatorId,
    eventType:   row.event_type as string,
    delta:       row.delta as number,
    newScore:    row.new_score as number,
    loopId:      row.loop_id ?? null,
    reason:      row.reason ?? null,
    timestamp:   row.created_at.toISOString(),
  };
}

// ── Health Check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const health: ServiceHealthResponse = {
    service:      SERVICE,
    status:       'healthy',
    version:      '0.1.0',
    uptime:       process.uptime(),
    timestamp:    new Date().toISOString(),
    dependencies: {
      'loop-ledger': 'connected',
      'xp-mint':     'connected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ── POST /validators ──────────────────────────────────────────────────────
app.post('/validators', async (req, res) => {
  try {
    const { name, domains, initialReputation, validatorId: providedId } = req.body;
    if (!name || !domains || domains.length === 0) {
      res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const validatorId = (providedId || uuidv4()) as ValidatorId;
    const rep = initialReputation ?? INITIAL_REPUTATION;

    await pool.query(
      `INSERT INTO reputation.validators (id, name, domains, reputation, accuracy, total_loops, is_active)
       VALUES ($1, $2, $3, $4, 0.0, 0, true)
       ON CONFLICT (id) DO NOTHING`,
      [validatorId, name, domains, rep],
    );

    const result = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [validatorId]);
    if (result.rows.length === 0) {
      res.status(409).json({ error: 'Validator already exists', code: 'CONFLICT', timestamp: new Date().toISOString() });
      return;
    }

    res.status(201).json(validatorFromRow(result.rows[0]));
  } catch (err: any) {
    console.error('[reputation] POST /validators error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /validators ───────────────────────────────────────────────────────
app.get('/validators', async (req, res) => {
  try {
    const { domain, isActive, sortBy = 'reputation_desc', page = '1', pageSize = '20' } = req.query;

    let query = 'SELECT * FROM reputation.validators WHERE 1=1';
    const params: any[] = [];
    let idx = 0;

    if (domain) { idx++; query += ` AND $${idx} = ANY(domains)`; params.push(domain); }
    if (isActive !== undefined) { idx++; query += ` AND is_active = $${idx}`; params.push(isActive === 'true'); }

    const sortMap: Record<string, string> = {
      reputation_desc: 'reputation DESC',
      reputation_asc:  'reputation ASC',
      accuracy_desc:   'accuracy DESC',
      xp_desc:         'reputation DESC',
    };
    query += ` ORDER BY ${sortMap[sortBy as string] || 'reputation DESC'}`;

    const total = (await pool.query(`SELECT COUNT(*) FROM reputation.validators WHERE 1=1`, [])).rows[0].count;
    const p  = parseInt(page as string, 10);
    const ps = parseInt(pageSize as string, 10);
    idx++; query += ` LIMIT $${idx}`; params.push(ps);
    idx++; query += ` OFFSET $${idx}`; params.push((p - 1) * ps);

    const result = await pool.query(query, params);
    res.json({ data: result.rows.map(validatorFromRow), total: parseInt(total, 10), page: p, pageSize: ps });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /validators/:validatorId ──────────────────────────────────────────
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

// ── PATCH /validators/:validatorId ────────────────────────────────────────
app.patch('/validators/:validatorId', async (req, res) => {
  try {
    const { name, domains, isActive } = req.body;
    const sets: string[] = [];
    const params: any[] = [req.params.validatorId];
    let idx = 1;

    if (name     !== undefined) { idx++; sets.push(`name = $${idx}`);      params.push(name); }
    if (domains  !== undefined) { idx++; sets.push(`domains = $${idx}`);   params.push(domains); }
    if (isActive !== undefined) { idx++; sets.push(`is_active = $${idx}`); params.push(isActive); }

    if (sets.length === 0) {
      res.status(400).json({ error: 'No fields to update', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    sets.push(`updated_at = NOW()`);
    await pool.query(`UPDATE reputation.validators SET ${sets.join(', ')} WHERE id = $1`, params);
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

// ── GET /validators/:validatorId/reputation ───────────────────────────────
app.get('/validators/:validatorId/reputation', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [req.params.validatorId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Validator not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    const v = result.rows[0];
    res.json({
      validatorId: v.id,
      score:       v.reputation,
      accuracy:    v.accuracy,
      totalLoops:  v.total_loops,
      lastUpdated: v.updated_at?.toISOString() || v.created_at.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /validators/:validatorId/reputation/history ───────────────────────
app.get('/validators/:validatorId/reputation/history', async (req, res) => {
  try {
    const { limit = '50', eventType } = req.query;
    let query = 'SELECT * FROM reputation.reputation_events WHERE validator_id = $1';
    const params: any[] = [req.params.validatorId];

    if (eventType) { query += ' AND event_type = $2'; params.push(eventType); }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string, 10));

    const result = await pool.query(query, params);
    res.json({
      validatorId: req.params.validatorId,
      events: result.rows.map(repEventFromRow),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /reputation/accrue ───────────────────────────────────────────────
app.post('/reputation/accrue', async (req, res) => {
  try {
    const { validatorId, loopId, xpAwarded, accrualRate = DEFAULT_ACCRUAL_RATE } = req.body;
    if (!validatorId || !loopId || xpAwarded === undefined) {
      res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const vRes = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [validatorId]);
    if (vRes.rows.length === 0) {
      res.status(404).json({ error: 'Validator not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const current = vRes.rows[0].reputation as number;
    const delta   = accrualRate * xpAwarded;
    const newScore = current + delta;

    // Update accuracy (simple running average: +1 for positive xp)
    const totalLoops = (vRes.rows[0].total_loops as number) + 1;
    const accuracy   = Math.min(1.0, (vRes.rows[0].accuracy * (totalLoops - 1) + (xpAwarded > 0 ? 1 : 0)) / totalLoops);

    await pool.query(
      `UPDATE reputation.validators SET reputation = $1, total_loops = $2, accuracy = $3, updated_at = NOW() WHERE id = $4`,
      [newScore, totalLoops, accuracy, validatorId],
    );

    // Log reputation event
    await pool.query(
      `INSERT INTO reputation.reputation_events (id, validator_id, event_type, delta, new_score, loop_id, reason)
       VALUES ($1, $2, 'accrual', $3, $4, $5, 'XP-based accrual')`,
      [uuidv4(), validatorId, delta, newScore, loopId],
    );

    await bus.emit(EventType.REPUTATION_UPDATED, validatorId as ValidatorId, {
      validatorId,
      oldScore: current,
      newScore,
      delta,
      reason: 'accrual',
    });

    res.json({ validatorId, score: newScore, accuracy, totalLoops, lastUpdated: new Date().toISOString() });
  } catch (err: any) {
    console.error('[reputation] POST /reputation/accrue error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /reputation/decay ────────────────────────────────────────────────
app.post('/reputation/decay', async (req, res) => {
  try {
    const { decayRate = DEFAULT_DECAY_RATE, validatorIds } = req.body;

    let query = 'SELECT id, reputation FROM reputation.validators WHERE is_active = true';
    const params: any[] = [];
    if (validatorIds && validatorIds.length > 0) {
      query += ` AND id = ANY($1)`;
      params.push(validatorIds);
    }

    const result = await pool.query(query, params);
    let count = 0;

    for (const row of result.rows) {
      const newScore = row.reputation * (1 - decayRate);
      await pool.query(
        `UPDATE reputation.validators SET reputation = $1, updated_at = NOW() WHERE id = $2`,
        [newScore, row.id],
      );
      await pool.query(
        `INSERT INTO reputation.reputation_events (id, validator_id, event_type, delta, new_score, reason)
         VALUES ($1, $2, 'decay', $3, $4, 'Time-based decay')`,
        [uuidv4(), row.id, newScore - row.reputation, newScore],
      );
      count++;
    }

    res.json({ validatorsDecayed: count, decayRate, timestamp: new Date().toISOString() });
  } catch (err: any) {
    console.error('[reputation] POST /reputation/decay error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /reputation/penalty ──────────────────────────────────────────────
app.post('/reputation/penalty', async (req, res) => {
  try {
    const { validatorId, penalty, reason, loopId } = req.body;
    if (!validatorId || penalty === undefined) {
      res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const vRes = await pool.query('SELECT * FROM reputation.validators WHERE id = $1', [validatorId]);
    if (vRes.rows.length === 0) {
      res.status(404).json({ error: 'Validator not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const current  = vRes.rows[0].reputation as number;
    const newScore = Math.max(0, current - penalty);

    await pool.query(
      `UPDATE reputation.validators SET reputation = $1, updated_at = NOW() WHERE id = $2`,
      [newScore, validatorId],
    );

    await pool.query(
      `INSERT INTO reputation.reputation_events (id, validator_id, event_type, delta, new_score, loop_id, reason)
       VALUES ($1, $2, 'penalty', $3, $4, $5, $6)`,
      [uuidv4(), validatorId, -penalty, newScore, loopId || null, reason || 'Penalty applied'],
    );

    await bus.emit(EventType.REPUTATION_UPDATED, validatorId as ValidatorId, {
      validatorId,
      oldScore: current,
      newScore,
      delta: -penalty,
      reason: 'penalty',
    });

    res.json({ validatorId, score: newScore, accuracy: vRes.rows[0].accuracy, totalLoops: vRes.rows[0].total_loops, lastUpdated: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /reputation/leaderboard ───────────────────────────────────────────
app.get('/reputation/leaderboard', async (req, res) => {
  try {
    const { limit = '10', domain } = req.query;
    let query = 'SELECT * FROM reputation.validators WHERE is_active = true';
    const params: any[] = [];

    if (domain) { query += ' AND $1 = ANY(domains)'; params.push(domain); }
    query += ` ORDER BY reputation DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string, 10));

    const result = await pool.query(query, params);
    const leaderboard = result.rows.map((row: any, i: number) => ({
      rank:        i + 1,
      validatorId: row.id,
      name:        row.name,
      reputation:  row.reputation,
      accuracy:    row.accuracy,
      totalLoops:  row.total_loops,
    }));

    res.json(leaderboard);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /events ─────────────────────────────────────────────────────────
app.post('/events', async (req, res) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[reputation] Received event: ${event.type}`);
    await handleEvent(event);
    res.status(202).send();
  } catch (err: any) {
    console.error('[reputation] Event handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

async function handleEvent(event: DomainEvent): Promise<void> {
  switch (event.type) {
    case EventType.LOOP_CLOSED: {
      // Auto-accrue reputation for all validators in the loop
      const payload = event.payload as LoopClosedPayload;
      const loop    = payload.loop;
      const xpBase  = (loop.deltaS ?? 1) * 10; // base XP proportional to ΔS

      for (const validatorId of loop.validatorIds) {
        try {
          const vRes = await pool.query('SELECT id FROM reputation.validators WHERE id = $1', [validatorId]);
          if (vRes.rows.length === 0) {
            // Auto-register unknown validators
            await pool.query(
              `INSERT INTO reputation.validators (id, name, domains, reputation, accuracy, total_loops, is_active)
               VALUES ($1, $2, $3, $4, 0.0, 0, true) ON CONFLICT (id) DO NOTHING`,
              [validatorId, `Validator ${validatorId.slice(0, 8)}`, [loop.domain], INITIAL_REPUTATION],
            );
          }

          const current   = (await pool.query('SELECT reputation FROM reputation.validators WHERE id = $1', [validatorId])).rows[0]?.reputation ?? INITIAL_REPUTATION;
          const delta     = DEFAULT_ACCRUAL_RATE * xpBase;
          const newScore  = current + delta;
          const totalRes  = await pool.query('SELECT total_loops, accuracy FROM reputation.validators WHERE id = $1', [validatorId]);
          const totalLoops = (totalRes.rows[0]?.total_loops ?? 0) + 1;
          const accuracy   = Math.min(1.0, ((totalRes.rows[0]?.accuracy ?? 0) * (totalLoops - 1) + 1) / totalLoops);

          await pool.query(
            `UPDATE reputation.validators SET reputation = $1, total_loops = $2, accuracy = $3, updated_at = NOW() WHERE id = $4`,
            [newScore, totalLoops, accuracy, validatorId],
          );

          await pool.query(
            `INSERT INTO reputation.reputation_events (id, validator_id, event_type, delta, new_score, loop_id, reason)
             VALUES ($1, $2, 'accrual', $3, $4, $5, 'Loop closed accrual')`,
            [uuidv4(), validatorId, delta, newScore, loop.id],
          );

          await bus.emit(EventType.REPUTATION_UPDATED, validatorId as ValidatorId, {
            validatorId, oldScore: current, newScore, delta, reason: 'loop_closed',
          });

          console.log(`[reputation] Accrued +${delta.toFixed(3)} for validator ${validatorId} (loop=${loop.id})`);
        } catch (err) {
          console.error(`[reputation] Failed to accrue for validator ${validatorId}:`, err);
        }
      }
      break;
    }

    case EventType.XP_MINTED_FINAL: {
      const payload = event.payload as XPMintedFinalPayload;
      console.log(`[reputation] XP_MINTED_FINAL received for loop ${payload.mintEvent.loopId}`);
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

  bus.on(EventType.LOOP_CLOSED, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  bus.on(EventType.XP_MINTED_FINAL, async (event) => {
    await handleEvent(event as DomainEvent);
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
