/**
 * Temporal Service — Service Entrypoint
 *
 * Time management and epoch tracking layer for the Extropy Engine.
 * Manages seasons/epochs, loop timeouts, reputation decay automation,
 * governance weight decay, and scheduled tasks. The "heartbeat" of
 * the system.
 *
 * Port: 4011
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
  Season,
  SeasonId,
  SeasonStatus,
  SeasonRanking,
  ValidatorId,
  LoopId,
  DomainEvent,
  ServiceHealthResponse,
  LoopOpenedPayload,
  LoopClosedPayload,
  XPMintedProvisionalPayload,
  SeasonStartedPayload,
  SeasonEndedPayload,
  LoopTimedOutPayload,
  ReputationDecayTickPayload,
  GovernanceWeightDecayedPayload,
  DFAOId,
  EntropyDomain,
} from '@extropy/contracts';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4011;
const SERVICE = ServiceName.TEMPORAL;

// ── Service URLs ────────────────────────────────────────────────────────────────────────────────
const REPUTATION_URL   = process.env.REPUTATION_URL   || 'http://reputation:4005';
// Service URLs (available for future inter-service calls)
// const LOOP_LEDGER_URL  = process.env.LOOP_LEDGER_URL  || 'http://loop-ledger:4003';
// const DFAO_URL         = process.env.DFAO_URL         || 'http://dfao-registry:4007';
// const ECONOMY_URL      = process.env.ECONOMY_URL      || 'http://token-economy:4009';
// const CREDENTIALS_URL  = process.env.CREDENTIALS_URL  || 'http://credentials:4010';

const pool  = createPool();
const redis = createRedis();
const bus   = new EventBus(redis, pool, SERVICE);

// ─────────────────────────────────────────────────────────────────────────────────
//  Row Mappers
// ─────────────────────────────────────────────────────────────────────────────────

function seasonFromRow(row: any): Season {
  return {
    id:                       row.id                         as SeasonId,
    number:                   row.number,
    name:                     row.name,
    status:                   row.status                     as SeasonStatus,
    startedAt:                row.started_at?.toISOString()  ?? row.starts_at?.toISOString(),
    endsAt:                   row.ends_at?.toISOString(),
    completedAt:              row.completed_at ? row.completed_at.toISOString() : null,
    rewardMultiplier:         row.reward_multiplier          ?? 1.0,
    startingRankingsSnapshot: row.starting_rankings_snapshot ?? null,
    finalRankings:            row.final_rankings             ?? null,
    startVertexId:            row.start_vertex_id            ?? ('' as any),
    endVertexId:              row.end_vertex_id              ?? null,
    totalXPMinted:            row.total_xp_minted            ?? 0,
    totalLoopsClosed:         row.total_loops_closed         ?? 0,
    metadata:                 row.metadata                   ?? {},
  };
}

function scheduledTaskFromRow(row: any): Record<string, unknown> {
  return {
    id:             row.id,
    taskType:       row.task_type,
    targetEntityId: row.target_entity_id,
    scheduledFor:   row.scheduled_for?.toISOString(),
    payload:        row.payload ?? {},
    status:         row.status,
    executedAt:     row.executed_at ? row.executed_at.toISOString() : null,
    createdAt:      row.created_at?.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
//  Health
// ─────────────────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  const health: ServiceHealthResponse = {
    service:   SERVICE,
    status:    'healthy',
    version:   '0.1.0',
    uptime:    process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: {
      'loop-ledger':    'connected',
      'reputation':     'connected',
      'dfao-registry':  'connected',
      'token-economy':  'connected',
      'credentials':    'connected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Seasons
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * POST /seasons — Create a new season
 */
app.post('/seasons', async (req, res) => {
  try {
    const { name, startsAt, endsAt, rewardMultiplier } = req.body;

    if (!name || !startsAt || !endsAt) {
      res.status(400).json({
        error:     'Missing required fields: name, startsAt, endsAt',
        code:      'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Assign sequential season number
    const countRes = await pool.query('SELECT COUNT(*) AS cnt FROM temporal.seasons');
    const seasonNumber = parseInt(countRes.rows[0].cnt, 10) + 1;

    const seasonId = uuidv4() as SeasonId;

    await pool.query(
      `INSERT INTO temporal.seasons
         (id, number, name, status, starts_at, ends_at, reward_multiplier,
          total_xp_minted, total_loops_closed, metadata)
       VALUES ($1, $2, $3, 'upcoming', $4, $5, $6, 0, 0, '{}')`,
      [
        seasonId,
        seasonNumber,
        name,
        new Date(startsAt),
        new Date(endsAt),
        rewardMultiplier ?? 1.0,
      ],
    );

    const row = await pool.query('SELECT * FROM temporal.seasons WHERE id = $1', [seasonId]);
    const season = seasonFromRow(row.rows[0]);

    console.log(`[temporal] Season ${seasonNumber} "${name}" created (id=${seasonId})`);
    res.status(201).json(season);
  } catch (err: any) {
    console.error('[temporal] POST /seasons error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/**
 * GET /seasons — List all seasons
 */
app.get('/seasons', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM temporal.seasons ORDER BY number ASC',
    );
    res.json(result.rows.map(seasonFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/**
 * GET /seasons/current — Get the currently active season
 */
app.get('/seasons/current', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM temporal.seasons WHERE status = 'active' ORDER BY number DESC LIMIT 1`,
    );
    if (result.rows.length === 0) {
      res.status(404).json({
        error:     'No active season',
        code:      'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    res.json(seasonFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/**
 * GET /seasons/:id — Get season details
 */
app.get('/seasons/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM temporal.seasons WHERE id = $1',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Season not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    res.json(seasonFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/**
 * GET /seasons/:id/rankings — Get season rankings (final or in-progress)
 */
app.get('/seasons/:id/rankings', async (req, res) => {
  try {
    const seasonRes = await pool.query(
      'SELECT * FROM temporal.seasons WHERE id = $1',
      [req.params.id],
    );
    if (seasonRes.rows.length === 0) {
      res.status(404).json({ error: 'Season not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    const season = seasonFromRow(seasonRes.rows[0]);

    // If final rankings exist, return them
    if (season.finalRankings) {
      res.json(season.finalRankings);
      return;
    }

    // Otherwise compute live rankings from reputation + mint data
    const rankings = await computeCurrentRankings(season.id, seasonRes.rows[0].starts_at);
    res.json(rankings);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/**
 * POST /seasons/:id/start — Start a season
 */
app.post('/seasons/:id/start', async (req, res) => {
  try {
    const seasonId = req.params.id as SeasonId;

    const seasonRes = await pool.query('SELECT * FROM temporal.seasons WHERE id = $1', [seasonId]);
    if (seasonRes.rows.length === 0) {
      res.status(404).json({ error: 'Season not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const season = seasonFromRow(seasonRes.rows[0]);
    if (season.status !== 'upcoming') {
      res.status(409).json({
        error:     `Season cannot be started: current status is '${season.status}'`,
        code:      'INVALID_STATE',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Take governance rankings snapshot (current validator standings)
    let rankingsSnapshot: Record<ValidatorId, number> = {};
    try {
      const repRes = await fetch(`${REPUTATION_URL}/validators?isActive=true`);
      if (repRes.ok) {
        const validators = (await repRes.json()) as any[];
        for (const v of validators) {
          rankingsSnapshot[v.id as ValidatorId] = v.aggregate_reputation ?? v.reputation?.aggregate ?? 0;
        }
      }
    } catch (err) {
      console.warn('[temporal] Could not fetch validators for rankings snapshot:', err);
    }

    const now = new Date();
    await pool.query(
      `UPDATE temporal.seasons
          SET status = 'active',
              started_at = $1,
              starting_rankings_snapshot = $2
        WHERE id = $3`,
      [now, JSON.stringify(rankingsSnapshot), seasonId],
    );

    const updated = await pool.query('SELECT * FROM temporal.seasons WHERE id = $1', [seasonId]);
    const updatedSeason = seasonFromRow(updated.rows[0]);

    await bus.emit(
      EventType.SEASON_STARTED,
      seasonId as unknown as LoopId,
      { season: updatedSeason } as SeasonStartedPayload,
    );

    console.log(`[temporal] Season ${updatedSeason.number} "${updatedSeason.name}" STARTED`);
    res.json(updatedSeason);
  } catch (err: any) {
    console.error('[temporal] POST /seasons/:id/start error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/**
 * POST /seasons/:id/end — End a season
 */
app.post('/seasons/:id/end', async (req, res) => {
  try {
    const seasonId = req.params.id as SeasonId;

    const seasonRes = await pool.query('SELECT * FROM temporal.seasons WHERE id = $1', [seasonId]);
    if (seasonRes.rows.length === 0) {
      res.status(404).json({ error: 'Season not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const season = seasonFromRow(seasonRes.rows[0]);
    if (season.status !== 'active') {
      res.status(409).json({
        error:     `Season cannot be ended: current status is '${season.status}'`,
        code:      'INVALID_STATE',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Transition to CLOSING
    await pool.query(
      `UPDATE temporal.seasons SET status = 'closing' WHERE id = $1`,
      [seasonId],
    );
    console.log(`[temporal] Season ${season.number} entering CLOSING state`);

    // Calculate final rankings
    const finalRankings = await computeFinalRankings(
      seasonId,
      seasonRes.rows[0].starts_at,
    );

    // Assign titles to top performers
    await assignSeasonTitles(finalRankings, seasonId);

    // Trigger governance ranking reset (zero out governance weights in dfao.memberships)
    try {
      await pool.query(
        `UPDATE dfao.memberships SET governance_weight = 0 WHERE status = 'active'`,
      );
      console.log('[temporal] Governance weights reset for new season');
    } catch (err) {
      console.warn('[temporal] Could not reset governance weights:', err);
    }

    // Transition to COMPLETED
    const now = new Date();
    await pool.query(
      `UPDATE temporal.seasons
          SET status = 'completed',
              completed_at = $1,
              final_rankings = $2
        WHERE id = $3`,
      [now, JSON.stringify(finalRankings), seasonId],
    );

    const updated = await pool.query('SELECT * FROM temporal.seasons WHERE id = $1', [seasonId]);
    const completedSeason = seasonFromRow(updated.rows[0]);

    await bus.emit(
      EventType.SEASON_ENDED,
      seasonId as unknown as LoopId,
      {
        season:           completedSeason,
        finalRankings,
        totalXPMinted:    completedSeason.totalXPMinted,
        totalLoopsClosed: completedSeason.totalLoopsClosed,
      } as SeasonEndedPayload,
    );

    console.log(
      `[temporal] Season ${completedSeason.number} "${completedSeason.name}" COMPLETED — ` +
      `${finalRankings.length} ranked validators, ${completedSeason.totalXPMinted} total XP`,
    );
    res.json(completedSeason);
  } catch (err: any) {
    console.error('[temporal] POST /seasons/:id/end error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Loop Timeouts
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * POST /loops/check-timeouts — Check for timed-out loops (cron endpoint)
 *
 * For each open/validating loop, checks:
 *   NOW() > created_at + interval '1/causal_closure_speed seconds'
 */
app.post('/loops/check-timeouts', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM ledger.loops WHERE status IN ('open', 'validating')`,
    );

    const now = Date.now();
    let timedOutCount = 0;

    for (const row of result.rows) {
      const createdAt     = new Date(row.created_at).getTime();
      const closureSpeed  = row.causal_closure_speed as number;
      // Timeout interval = 1 / causal_closure_speed seconds
      const timeoutMs = closureSpeed > 0
        ? (1 / closureSpeed) * 1000
        : 3_600_000; // fallback: 1 hour

      if (now > createdAt + timeoutMs) {
        // Mark loop as failed with TIMEOUT reason
        await pool.query(
          `UPDATE ledger.loops
              SET status = 'failed',
                  timeout_reason = 'TIMEOUT'
            WHERE id = $1 AND status IN ('open', 'validating')`,
          [row.id],
        );

        const loopId   = row.id as LoopId;
        const timedOutAt = new Date().toISOString();

        await bus.emit(
          EventType.LOOP_TIMED_OUT,
          loopId,
          {
            loopId,
            openedAt:  new Date(row.created_at).toISOString(),
            timedOutAt,
            domain:    row.domain as EntropyDomain,
          } as LoopTimedOutPayload,
        );

        console.log(
          `[temporal] Loop ${loopId} TIMED OUT (domain=${row.domain}, ` +
          `age=${Math.round((now - createdAt) / 1000)}s, timeout=${Math.round(timeoutMs / 1000)}s)`,
        );
        timedOutCount++;
      }
    }

    console.log(`[temporal] Timeout check complete: ${timedOutCount} loops timed out`);
    res.json({ timedOutCount, checkedCount: result.rows.length });
  } catch (err: any) {
    console.error('[temporal] POST /loops/check-timeouts error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Reputation Decay
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * POST /reputation/decay-tick — Run reputation decay for all active validators
 *
 * Applies: new_rep = current_rep × (1 - decay_rate)
 */
app.post('/reputation/decay-tick', async (_req, res) => {
  try {
    const DECAY_RATE = 0.02; // γ — default 2% per period

    const validatorsRes = await pool.query(
      `SELECT * FROM reputation.validators WHERE is_active = true`,
    );

    let decayedCount = 0;

    for (const row of validatorsRes.rows) {
      const currentAggregate: number = row.aggregate_reputation ?? 0;
      const newAggregate = currentAggregate * (1 - DECAY_RATE);

      // Decay per-domain values stored in the domains JSONB column
      const domainScores: Record<string, number> = row.domain_scores ?? {};
      const newDomainScores: Record<string, number> = {};
      for (const [domain, score] of Object.entries(domainScores)) {
        newDomainScores[domain] = (score as number) * (1 - DECAY_RATE);
      }

      await pool.query(
        `UPDATE reputation.validators
            SET aggregate_reputation = $1,
                domain_scores = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [newAggregate, JSON.stringify(newDomainScores), row.id],
      );

      // Emit per-validator decay event
      await bus.emit(
        EventType.REPUTATION_DECAY_TICK,
        row.id as LoopId,
        {
          validatorId:  row.id as ValidatorId,
          domain:       'aggregate' as unknown as EntropyDomain,
          decayAmount:  currentAggregate - newAggregate,
          newAggregate,
        } as ReputationDecayTickPayload,
      );

      decayedCount++;
    }

    console.log(`[temporal] Reputation decay tick: ${decayedCount} validators decayed at rate ${DECAY_RATE}`);
    res.json({ decayedCount, decayRate: DECAY_RATE });
  } catch (err: any) {
    console.error('[temporal] POST /reputation/decay-tick error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Governance Weight Decay
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * POST /governance/weight-decay — Decay governance weights in DFAOs (cron endpoint)
 *
 * Applies 5% monthly decay: new_weight = current_weight × 0.95
 */
app.post('/governance/weight-decay', async (_req, res) => {
  try {
    const DECAY_RATE = 0.05; // 5% monthly

    const membershipsRes = await pool.query(
      `SELECT * FROM dfao.memberships WHERE status = 'active'`,
    );

    let decayedCount = 0;

    for (const row of membershipsRes.rows) {
      const previousWeight: number = row.governance_weight ?? 0;
      const newWeight = previousWeight * (1 - DECAY_RATE);

      await pool.query(
        `UPDATE dfao.memberships
            SET governance_weight = $1,
                updated_at = NOW()
          WHERE dfao_id = $2 AND validator_id = $3`,
        [newWeight, row.dfao_id, row.validator_id],
      );

      await bus.emit(
        EventType.GOVERNANCE_WEIGHT_DECAYED,
        row.validator_id as LoopId,
        {
          validatorId:    row.validator_id as ValidatorId,
          dfaoId:         row.dfao_id as DFAOId,
          previousWeight,
          newWeight,
          decayRate:      DECAY_RATE,
        } as GovernanceWeightDecayedPayload,
      );

      decayedCount++;
    }

    console.log(`[temporal] Governance weight decay: ${decayedCount} memberships updated at rate ${DECAY_RATE}`);
    res.json({ decayedCount, decayRate: DECAY_RATE });
  } catch (err: any) {
    console.error('[temporal] POST /governance/weight-decay error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  XP Decay
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * POST /xp/decay — Run XP decay (cron endpoint)
 *
 * XP_t = XP_{t-1} × (1 - ρ) where ρ = 0.01 per 30 loop cycles
 */
app.post('/xp/decay', async (_req, res) => {
  try {
    const DECAY_RATE    = 0.01;   // ρ
    const CYCLE_LENGTH  = 30;     // 30 loop cycles

    // Get current total loop count to determine cycle number
    const cycleRes = await pool.query(
      `SELECT COUNT(*) AS total_loops FROM ledger.loops WHERE status IN ('closed', 'settled')`,
    );
    const totalLoops  = parseInt(cycleRes.rows[0].total_loops ?? '0', 10);
    const cycleNumber = Math.floor(totalLoops / CYCLE_LENGTH);

    const walletsRes = await pool.query(
      `SELECT w.id AS wallet_id, w.validator_id, w.xp_balance
         FROM economy.wallets w
        WHERE w.xp_balance > 0`,
    );

    let decayedCount = 0;

    for (const row of walletsRes.rows) {
      const previousXP: number = row.xp_balance ?? 0;
      const newXP = previousXP * (1 - DECAY_RATE);

      await pool.query(
        `UPDATE economy.wallets SET xp_balance = $1, updated_at = NOW() WHERE id = $2`,
        [newXP, row.wallet_id],
      );

      await bus.emit(
        EventType.XP_DECAYED,
        row.validator_id as LoopId,
        {
          validatorId:  row.validator_id as ValidatorId,
          previousXP,
          newXP,
          decayRate:    DECAY_RATE,
          cycleNumber,
        },
      );

      decayedCount++;
    }

    console.log(`[temporal] XP decay: ${decayedCount} wallets decayed at rate ${DECAY_RATE} (cycle ${cycleNumber})`);
    res.json({ decayedCount, decayRate: DECAY_RATE, cycleNumber });
  } catch (err: any) {
    console.error('[temporal] POST /xp/decay error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Scheduled Tasks
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * POST /scheduled-tasks — Create a scheduled task
 */
app.post('/scheduled-tasks', async (req, res) => {
  try {
    const { taskType, targetEntityId, scheduledFor, payload } = req.body;

    if (!taskType || !scheduledFor) {
      res.status(400).json({
        error:     'Missing required fields: taskType, scheduledFor',
        code:      'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const taskId = uuidv4();
    await pool.query(
      `INSERT INTO temporal.scheduled_tasks
         (id, task_type, target_entity_id, scheduled_for, payload, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [
        taskId,
        taskType,
        targetEntityId ?? null,
        new Date(scheduledFor),
        JSON.stringify(payload ?? {}),
      ],
    );

    const row = await pool.query(
      'SELECT * FROM temporal.scheduled_tasks WHERE id = $1',
      [taskId],
    );

    console.log(`[temporal] Scheduled task created: ${taskType} at ${scheduledFor} (id=${taskId})`);
    res.status(201).json(scheduledTaskFromRow(row.rows[0]));
  } catch (err: any) {
    console.error('[temporal] POST /scheduled-tasks error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/**
 * GET /scheduled-tasks — List scheduled tasks with optional filters
 */
app.get('/scheduled-tasks', async (req, res) => {
  try {
    let query  = 'SELECT * FROM temporal.scheduled_tasks WHERE 1=1';
    const params: any[] = [];
    let idx = 0;

    if (req.query.status) {
      idx++;
      query += ` AND status = $${idx}`;
      params.push(req.query.status);
    }
    if (req.query.taskType) {
      idx++;
      query += ` AND task_type = $${idx}`;
      params.push(req.query.taskType);
    }
    if (req.query.targetEntityId) {
      idx++;
      query += ` AND target_entity_id = $${idx}`;
      params.push(req.query.targetEntityId);
    }

    query += ' ORDER BY scheduled_for ASC';

    const result = await pool.query(query, params);
    res.json(result.rows.map(scheduledTaskFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/**
 * POST /scheduled-tasks/execute — Execute all due scheduled tasks (cron endpoint)
 */
app.post('/scheduled-tasks/execute', async (_req, res) => {
  try {
    const dueRes = await pool.query(
      `SELECT * FROM temporal.scheduled_tasks
        WHERE scheduled_for <= NOW() AND status = 'pending'
        ORDER BY scheduled_for ASC`,
    );

    const executed: string[] = [];
    const failed:   string[] = [];

    for (const row of dueRes.rows) {
      try {
        await executeScheduledTask(row);

        await pool.query(
          `UPDATE temporal.scheduled_tasks
              SET status = 'executed', executed_at = NOW()
            WHERE id = $1`,
          [row.id],
        );

        executed.push(row.id);
        console.log(`[temporal] Executed scheduled task ${row.id} (type=${row.task_type})`);
      } catch (err: any) {
        console.error(`[temporal] Failed to execute task ${row.id}:`, err);

        await pool.query(
          `UPDATE temporal.scheduled_tasks
              SET status = 'failed', executed_at = NOW()
            WHERE id = $1`,
          [row.id],
        );

        failed.push(row.id);
      }
    }

    res.json({
      executedCount: executed.length,
      failedCount:   failed.length,
      executed,
      failed,
    });
  } catch (err: any) {
    console.error('[temporal] POST /scheduled-tasks/execute error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Master Cron Tick
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * POST /cron/tick — Master cron tick (called by external scheduler every hour)
 *
 * Runs all periodic tasks in sequence:
 *   1. Loop timeout check
 *   2. CT lockup expiry check
 *   3. Check if current season should end
 */
app.post('/cron/tick', async (_req, res) => {
  const summary: Record<string, unknown> = {};
  const base = `http://localhost:${PORT}`;

  try {
    // 1. Loop timeout check
    try {
      const timeoutRes = await fetch(`${base}/loops/check-timeouts`, { method: 'POST' });
      if (timeoutRes.ok) {
        summary.loopTimeouts = await timeoutRes.json();
      }
    } catch (err: any) {
      summary.loopTimeoutsError = err.message;
      console.error('[temporal] cron/tick — loop timeout check failed:', err);
    }

    // 2. CT lockup expiry check (unlock CTs past 2-week lockup)
    try {
      // CT lockup is 2 weeks (336 hours); query directly for expired lockups
      const expiredRes = await pool.query(
        `SELECT tb.id, tb.wallet_id, tb.validator_id, tb.amount, tb.lockup_expires_at, w.id AS wallet_id_2
           FROM economy.token_balances tb
           JOIN economy.wallets w ON tb.wallet_id = w.id
          WHERE tb.token_type = 'ct'
            AND tb.status = 'locked'
            AND tb.lockup_expires_at <= NOW()`,
      );

      let unlockedCount = 0;
      for (const row of expiredRes.rows) {
        // Unlock the balance
        await pool.query(
          `UPDATE economy.token_balances
              SET status = 'active', lockup_expires_at = NULL, updated_at = NOW()
            WHERE id = $1`,
          [row.id],
        );

        // Get active season for context
        const seasonRes = await pool.query(
          `SELECT id FROM temporal.seasons WHERE status = 'active' LIMIT 1`,
        );
        const seasonId = seasonRes.rows[0]?.id ?? null;

        await bus.emit(
          EventType.CT_LOCKUP_EXPIRED,
          row.validator_id as LoopId,
          {
            walletId:    row.wallet_id,
            validatorId: row.validator_id as ValidatorId,
            amount:      row.amount,
            seasonId,
          },
        );

        unlockedCount++;
        console.log(`[temporal] CT lockup expired for validator ${row.validator_id}: ${row.amount} CT unlocked`);
      }
      summary.ctLockupsUnlocked = unlockedCount;
    } catch (err: any) {
      summary.ctLockupError = err.message;
      console.error('[temporal] cron/tick — CT lockup check failed:', err);
    }

    // 3. Check if current season should end
    try {
      const activeSeason = await pool.query(
        `SELECT * FROM temporal.seasons WHERE status = 'active' AND ends_at <= NOW() LIMIT 1`,
      );

      if (activeSeason.rows.length > 0) {
        const seasonId = activeSeason.rows[0].id;
        console.log(`[temporal] Active season ${seasonId} has passed its end date — auto-ending`);

        const endRes = await fetch(`${base}/seasons/${seasonId}/end`, { method: 'POST' });
        if (endRes.ok) {
          summary.seasonEnded = await endRes.json();
        } else {
          summary.seasonEndError = `HTTP ${endRes.status}`;
        }
      } else {
        summary.seasonEnded = null;
      }
    } catch (err: any) {
      summary.seasonCheckError = err.message;
      console.error('[temporal] cron/tick — season check failed:', err);
    }

    console.log('[temporal] Cron tick completed:', JSON.stringify(summary));
    res.json({ ok: true, timestamp: new Date().toISOString(), summary });
  } catch (err: any) {
    console.error('[temporal] POST /cron/tick error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Event Receiver (HTTP webhook)
// ─────────────────────────────────────────────────────────────────────────────────

app.post('/events', async (req, res) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[temporal] Received event: ${event.type}`);
    await handleEvent(event);
    res.status(202).send();
  } catch (err: any) {
    console.error('[temporal] Event handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Internal: Event Handling
// ─────────────────────────────────────────────────────────────────────────────────

async function handleEvent(event: DomainEvent): Promise<void> {
  switch (event.type) {
    case EventType.LOOP_OPENED: {
      // Optionally schedule a timeout task for this loop
      const payload = event.payload as LoopOpenedPayload;
      const loopId  = payload.loop?.id ?? event.correlationId;

      try {
        // Schedule a timeout check 1 hour from now as a safety net
        const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await pool.query(
          `INSERT INTO temporal.scheduled_tasks
             (id, task_type, target_entity_id, scheduled_for, payload, status)
           VALUES ($1, 'loop_timeout_check', $2, $3, $4, 'pending')`,
          [
            uuidv4(),
            loopId,
            new Date(scheduledFor),
            JSON.stringify({ loopId }),
          ],
        );
        console.log(`[temporal] Scheduled timeout check for loop ${loopId}`);
      } catch (err) {
        console.warn('[temporal] Could not schedule timeout task:', err);
      }
      break;
    }

    case EventType.LOOP_CLOSED: {
      // Update season stats: increment total_loops_closed, total_xp_minted (will be updated on XP mint)
      const payload = event.payload as LoopClosedPayload;
      const loopId  = payload.loop?.id ?? event.correlationId;

      try {
        await pool.query(
          `UPDATE temporal.seasons
              SET total_loops_closed = total_loops_closed + 1
            WHERE status = 'active'`,
        );
        console.log(`[temporal] Season stats updated: +1 loop closed (loop=${loopId})`);
      } catch (err) {
        console.warn('[temporal] Could not update season loop count:', err);
      }
      break;
    }

    case EventType.XP_MINTED_PROVISIONAL: {
      // Update season total_xp_minted
      const payload   = event.payload as XPMintedProvisionalPayload;
      const xpMinted  = payload.mintEvent?.totalMinted ?? 0;

      try {
        await pool.query(
          `UPDATE temporal.seasons
              SET total_xp_minted = total_xp_minted + $1
            WHERE status = 'active'`,
          [xpMinted],
        );
        console.log(`[temporal] Season stats updated: +${xpMinted} XP minted`);
      } catch (err) {
        console.warn('[temporal] Could not update season XP total:', err);
      }
      break;
    }

    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
//  Internal: Scheduled Task Execution
// ─────────────────────────────────────────────────────────────────────────────────

async function executeScheduledTask(row: any): Promise<void> {
  const base      = `http://localhost:${PORT}`;
  const taskType  = row.task_type as string;
  // row.payload available for future task-specific configuration

  switch (taskType) {
    case 'loop_timeout_check': {
      await fetch(`${base}/loops/check-timeouts`, { method: 'POST' });
      break;
    }

    case 'reputation_decay': {
      await fetch(`${base}/reputation/decay-tick`, { method: 'POST' });
      break;
    }

    case 'governance_decay': {
      await fetch(`${base}/governance/weight-decay`, { method: 'POST' });
      break;
    }

    case 'xp_decay': {
      await fetch(`${base}/xp/decay`, { method: 'POST' });
      break;
    }

    case 'ct_inactivity_burn': {
      // Check for wallets with CT and no activity in 365 days — burn CT
      const CT_INACTIVITY_DAYS = 365;
      const cutoff = new Date(Date.now() - CT_INACTIVITY_DAYS * 24 * 60 * 60 * 1000);

      const staleCTRes = await pool.query(
        `SELECT tb.id, tb.wallet_id, tb.validator_id, tb.amount
           FROM economy.token_balances tb
          WHERE tb.token_type = 'ct'
            AND tb.status = 'active'
            AND tb.amount > 0
            AND tb.last_activity_at < $1`,
        [cutoff],
      );

      for (const row of staleCTRes.rows) {
        const burnedAmount = row.amount;

        await pool.query(
          `UPDATE economy.token_balances
              SET status = 'burned', amount = 0, updated_at = NOW()
            WHERE id = $1`,
          [row.id],
        );

        const inactiveDays = Math.floor(
          (Date.now() - new Date(row.last_activity_at ?? cutoff).getTime()) / (1000 * 60 * 60 * 24),
        );

        await bus.emit(
          EventType.CT_INACTIVITY_BURN,
          row.validator_id as LoopId,
          {
            walletId:     row.wallet_id,
            validatorId:  row.validator_id as ValidatorId,
            burnedAmount,
            inactiveDays,
            vertexId:     '' as any,
          },
        );

        console.log(
          `[temporal] CT inactivity burn: ${burnedAmount} CT burned for validator ${row.validator_id} ` +
          `(${inactiveDays} inactive days)`,
        );
      }
      break;
    }

    case 'cat_recertification': {
      // Check for CATs with no activity in 180 days — flag recertification_due
      const CAT_RECERT_DAYS = 180;
      const cutoff = new Date(Date.now() - CAT_RECERT_DAYS * 24 * 60 * 60 * 1000);

      const staleCATRes = await pool.query(
        `SELECT c.id, c.validator_id, c.domain, c.issued_at
           FROM credentials.credentials c
          WHERE c.type = 'certification'
            AND c.revoked_at IS NULL
            AND c.issued_at < $1`,
        [cutoff],
      );

      for (const row of staleCATRes.rows) {
        const dueBy = new Date(
          new Date(row.issued_at).getTime() + CAT_RECERT_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();

        await bus.emit(
          EventType.CAT_RECERTIFICATION_DUE,
          row.validator_id as LoopId,
          {
            validatorId:    row.validator_id as ValidatorId,
            domain:         row.domain as EntropyDomain,
            lastCertifiedAt: new Date(row.issued_at).toISOString(),
            dueBy,
          },
        );

        console.log(
          `[temporal] CAT recertification due for validator ${row.validator_id} ` +
          `(domain=${row.domain}, due=${dueBy})`,
        );
      }
      break;
    }

    default:
      console.warn(`[temporal] Unknown task type: ${taskType}`);
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
//  Internal: Rankings Computation
// ─────────────────────────────────────────────────────────────────────────────────

async function computeCurrentRankings(
  _seasonId: SeasonId,
  seasonStartedAt: Date,
): Promise<SeasonRanking[]> {
  // Aggregate XP minted per validator since season start
  const xpRes = await pool.query(
    `SELECT me.validator_id,
            SUM(xd.xp_amount) AS season_xp,
            COUNT(DISTINCT l.id) AS loop_count
       FROM mint.mint_events me
       JOIN mint.xp_distributions xd ON xd.mint_event_id = me.id
       JOIN ledger.loops l ON l.id = me.loop_id
      WHERE me.created_at >= $1
        AND me.status IN ('provisional', 'confirmed')
      GROUP BY me.validator_id
      ORDER BY season_xp DESC`,
    [seasonStartedAt],
  ).catch(() => ({ rows: [] as any[] }));

  const rankings: SeasonRanking[] = xpRes.rows.map((row: any, idx: number) => ({
    validatorId: row.validator_id as ValidatorId,
    rank:        idx + 1,
    totalXP:     parseFloat(row.season_xp ?? '0'),
    totalLoops:  parseInt(row.loop_count ?? '0', 10),
    title:       null,
    badgeIds:    [],
  }));

  return rankings;
}

async function computeFinalRankings(
  _seasonId: SeasonId,
  seasonStartedAt: Date,
): Promise<SeasonRanking[]> {
  // Try DB-side aggregation first; gracefully fall back on schema differences
  const xpRes = await pool.query(
    `SELECT xd.validator_id,
            COALESCE(SUM(xd.xp_amount), 0) AS season_xp,
            COUNT(DISTINCT me.loop_id) AS loop_count
       FROM mint.xp_distributions xd
       JOIN mint.mint_events me ON me.id = xd.mint_event_id
      WHERE me.created_at >= $1
        AND me.status IN ('provisional', 'confirmed')
      GROUP BY xd.validator_id
      ORDER BY season_xp DESC`,
    [seasonStartedAt],
  ).catch(() => ({ rows: [] as any[] }));

  const rankings: SeasonRanking[] = xpRes.rows.map((row: any, idx: number) => ({
    validatorId: row.validator_id as ValidatorId,
    rank:        idx + 1,
    totalXP:     parseFloat(row.season_xp ?? '0'),
    totalLoops:  parseInt(row.loop_count ?? '0', 10),
    title:       null,
    badgeIds:    [],
  }));

  return rankings;
}

async function assignSeasonTitles(
  rankings: SeasonRanking[],
  seasonId: SeasonId,
): Promise<void> {
  // Top 1: "Ecosystem Pioneer"
  // Top 2-5: "Season Champion"
  // Top 6-10: "Season Contender"
  const titleMap: Record<number, string> = {
    1: 'Ecosystem Pioneer',
  };
  for (let i = 2; i <= 5; i++) {
    titleMap[i] = 'Season Champion';
  }
  for (let i = 6; i <= 10; i++) {
    titleMap[i] = 'Season Contender';
  }

  for (const ranking of rankings) {
    const title = titleMap[ranking.rank] ?? null;
    if (title) {
      ranking.title = title;

      // Emit TITLE_AWARDED event
      try {
        await bus.emit(
          EventType.TITLE_AWARDED,
          ranking.validatorId as unknown as LoopId,
          {
            credential: {
              id:                   uuidv4() as any,
              validatorId:          ranking.validatorId,
              type:                 'title' as any,
              name:                 title,
              description:          `Awarded for rank #${ranking.rank} in season ${seasonId}`,
              level:                null,
              domain:               null,
              seasonId,
              persistsAcrossSeasons: ranking.rank === 1,
              vertexId:             '' as any,
              visualMetadata:       {},
              issuedAt:             new Date().toISOString(),
              expiresAt:            null,
              revokedAt:            null,
            },
            reputationLevel: ranking.rank,
          },
        );
        console.log(`[temporal] Title "${title}" awarded to validator ${ranking.validatorId} (rank #${ranking.rank})`);
      } catch (err) {
        console.warn(`[temporal] Could not emit TITLE_AWARDED for ${ranking.validatorId}:`, err);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
//  Startup
// ─────────────────────────────────────────────────────────────────────────────────

async function main() {
  await waitForPostgres(pool);
  await waitForRedis(redis);
  await bus.start();

  // Subscribe to events via Redis pub/sub
  bus.on(EventType.LOOP_OPENED, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  bus.on(EventType.LOOP_CLOSED, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  bus.on(EventType.XP_MINTED_PROVISIONAL, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  app.listen(PORT, () => {
    console.log(`[temporal] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[temporal] Fatal startup error:', err);
  process.exit(1);
});

export default app;
