/**
 * XP Mint — Service Entrypoint
 *
 * Mints XP tokens only when a loop closes with verified ΔS > 0.
 * Enforces strict minting criteria and calculates the final XP score.
 *
 * Core formula:  XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 *
 * Two-phase minting:
 *   Phase 1 (ERC):  Provisional XP on loop close
 *   Phase 2 (RCV):  Retroactive confirm or burn
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
  CAUSAL_CLOSURE_SPEEDS,
} from '@extropy/contracts';
import type {
  XPMintEvent,
  MintEventId,
  MintStatus,
  XPDistribution,
  XPFormulaInputs,
  IrreducibleXPInputs,
  LoopId,
  ValidatorId,
  DomainEvent,
  ServiceHealthResponse,
  EntropyDomain,
  LoopClosedPayload,
  XPMintedProvisionalPayload,
  XPConfirmedPayload,
  XPBurnedPayload,
} from '@extropy/contracts';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4005;
const SERVICE = ServiceName.XP_MINT;
const LOOP_LEDGER_URL = process.env.LOOP_LEDGER_URL || 'http://loop-ledger:4003';
const REPUTATION_URL = process.env.REPUTATION_URL || 'http://reputation:4004';

const pool = createPool();
const redis = createRedis();
const bus = new EventBus(redis, pool, SERVICE);

// ── XP Calculation ────────────────────────────────────────────────────────

function calculateXP(inputs: XPFormulaInputs): number {
  const { reputation, feedbackClosure, deltaS, domainWeight, essentiality, settlementTimeSeconds } = inputs;
  if (deltaS <= 0) return 0;
  if (reputation <= 0 || feedbackClosure <= 0 || domainWeight <= 0 || essentiality <= 0) return 0;
  if (settlementTimeSeconds <= 0) return 0;
  const settlementFactor = Math.log(1 / settlementTimeSeconds);
  if (settlementFactor <= 0) return 0;
  const xp = reputation * feedbackClosure * deltaS * (domainWeight * essentiality) * settlementFactor;
  return Math.max(0, xp);
}

function calculateIrreducibleXP(inputs: IrreducibleXPInputs): number {
  const { deltaS, causalClosureSpeed } = inputs;
  if (deltaS <= 0 || causalClosureSpeed <= 0) return 0;
  return deltaS / (causalClosureSpeed * causalClosureSpeed);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function mintEventFromRow(row: any): XPMintEvent {
  return {
    id: row.id as MintEventId,
    loopId: row.loop_id as LoopId,
    status: row.status as MintStatus,
    reputationFactor: row.reputation_factor,
    feedbackClosureStrength: row.feedback_closure_strength,
    deltaS: row.delta_s,
    domainEssentialityProduct: row.domain_essentiality_product,
    settlementTimeFactor: row.settlement_time_factor,
    xpValue: row.xp_value,
    distribution: row.distribution || [],
    totalMinted: row.total_minted,
    burnReason: row.burn_reason || undefined,
    retroactiveValidationAt: row.retroactive_validation_at ? row.retroactive_validation_at.toISOString() : undefined,
    createdAt: row.created_at.toISOString(),
  };
}

// ── Internal: Mint ────────────────────────────────────────────────────────

async function mintForLoop(loopId: LoopId): Promise<XPMintEvent> {
  // Check for existing mint
  const existingRes = await pool.query('SELECT * FROM mint.mint_events WHERE loop_id = $1', [loopId]);
  if (existingRes.rows.length > 0) {
    console.log(`[xp-mint] Mint already exists for loop ${loopId}`);
    return mintEventFromRow(existingRes.rows[0]);
  }

  // Fetch loop from Loop Ledger
  const loopRes = await fetch(`${LOOP_LEDGER_URL}/loops/${loopId}`);
  if (!loopRes.ok) throw new Error(`Failed to fetch loop ${loopId}: ${loopRes.status}`);
  const loop = await loopRes.json() as any;

  if (loop.status !== 'closed') throw new Error(`Loop ${loopId} is not closed (status=${loop.status})`);
  if (!loop.deltaS || loop.deltaS <= 0) throw new Error(`Loop ${loopId} has invalid ΔS: ${loop.deltaS}`);

  // Fetch validator reputations
  let aggregateRep = INITIAL_REP_FALLBACK;
  const validatorIds: ValidatorId[] = loop.validatorIds || [];

  if (validatorIds.length > 0) {
    try {
      const repRes = await fetch(`${REPUTATION_URL}/reputation/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validatorIds }),
      });
      if (repRes.ok) {
        const repMap = await repRes.json() as Record<string, any>;
        const reps = Object.values(repMap).map((r: any) => r.aggregate || 1);
        aggregateRep = reps.length > 0 ? reps.reduce((a: number, b: number) => a + b, 0) / reps.length : 1;
      }
    } catch (err) {
      console.log('[xp-mint] Reputation service unavailable, using fallback');
    }
  }

  // Compute formula inputs
  const R = aggregateRep;
  const F = loop.consensus
    ? loop.consensus.vPlus / (loop.consensus.vPlus + loop.consensus.vMinus || 1)
    : 0.8;
  const deltaS = loop.deltaS;
  const w = 1.0; // Domain weight (simplified)
  const E = 0.8; // Essentiality factor (simplified)
  const Ts = loop.settlementTimeSeconds || 1;

  const domain = loop.domain as EntropyDomain;
  const cL = CAUSAL_CLOSURE_SPEEDS[domain] || 1e-4;

  // Calculate XP: use max of full formula and irreducible floor
  const fullXP = calculateXP({
    reputation: R,
    feedbackClosure: F,
    deltaS,
    domainWeight: w,
    essentiality: E,
    settlementTimeSeconds: Ts,
  });

  const irreducibleXP = calculateIrreducibleXP({ deltaS, causalClosureSpeed: cL });
  const xpValue = Math.max(fullXP, irreducibleXP);
  const settlementFactor = Ts > 0 ? Math.log(1 / Ts) : 0;

  // Compute distribution (filter null validators)
  const cleanValidatorIds = validatorIds.filter((v: ValidatorId) => v != null);
  const distribution: XPDistribution[] = cleanValidatorIds.map((vid: ValidatorId) => ({
    validatorId: vid,
    share: 1 / Math.max(cleanValidatorIds.length, 1),
    xpAmount: xpValue / Math.max(cleanValidatorIds.length, 1),
    basis: 'equal_split',
  }));

  const mintEventId = uuidv4() as MintEventId;

  // Idempotent insert — ON CONFLICT returns nothing if mint already exists
  const insertResult = await pool.query(
    `INSERT INTO mint.mint_events (id, loop_id, status, reputation_factor, feedback_closure_strength, delta_s,
     domain_essentiality_product, settlement_time_factor, xp_value, distribution, total_minted)
     VALUES ($1, $2, 'provisional', $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (loop_id) DO NOTHING
     RETURNING id`,
    [mintEventId, loopId, R, F, deltaS, w * E, settlementFactor, xpValue, JSON.stringify(distribution), xpValue],
  );

  if (insertResult.rowCount === 0) {
    // Already minted — return existing
    console.log(`[xp-mint] Mint already exists for loop ${loopId} (concurrent insert)`);
    return mintEventFromRow(
      (await pool.query('SELECT * FROM mint.mint_events WHERE loop_id = $1', [loopId])).rows[0],
    );
  }

  const mintEvent = mintEventFromRow(
    (await pool.query('SELECT * FROM mint.mint_events WHERE id = $1', [mintEventId])).rows[0],
  );

  // Emit provisional mint event
  await bus.emit(EventType.XP_MINTED_PROVISIONAL, loopId, {
    mintEvent,
  } as XPMintedProvisionalPayload);

  // Accrue reputation for each validator (filter nulls)
  for (const vid of cleanValidatorIds) {
    try {
      await fetch(`${REPUTATION_URL}/reputation/accrue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          validatorId: vid,
          domain,
          xpEarned: xpValue / Math.max(cleanValidatorIds.length, 1),
          loopId,
        }),
      });
    } catch (err) {
      console.error(`[xp-mint] Failed to accrue rep for ${vid}:`, err);
    }
  }

  // Settle the loop in Loop Ledger
  try {
    await fetch(`${LOOP_LEDGER_URL}/loops/${loopId}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mintEventId }),
    });
  } catch (err) {
    console.error(`[xp-mint] Failed to settle loop ${loopId}:`, err);
  }

  console.log(`[xp-mint] ✨ MINTED ${xpValue.toFixed(2)} XP for loop ${loopId} (R=${R.toFixed(2)}, F=${F.toFixed(2)}, ΔS=${deltaS}, irreducible=${irreducibleXP.toFixed(2)})`);
  return mintEvent;
}

const INITIAL_REP_FALLBACK = 1.0;

// ── Health Check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const health: ServiceHealthResponse = {
    service: SERVICE,
    status: 'healthy',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: {
      'epistemology-engine': 'disconnected',
      'signalflow': 'disconnected',
      'loop-ledger': 'connected',
      'reputation': 'connected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ── POST /mint ───────────────────────────────────────────────────────────
app.post('/mint', async (req, res) => {
  try {
    const { loopId } = req.body;
    if (!loopId) {
      res.status(400).json({ error: 'Missing loopId', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }
    const mintEvent = await mintForLoop(loopId as LoopId);
    res.status(201).json(mintEvent);
  } catch (err: any) {
    console.error('[xp-mint] POST /mint error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /mint/:mintEventId ───────────────────────────────────────────────
app.get('/mint/:mintEventId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM mint.mint_events WHERE id = $1', [req.params.mintEventId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Mint event not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    res.json(mintEventFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /mint/by-loop/:loopId ────────────────────────────────────────────
app.get('/mint/by-loop/:loopId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM mint.mint_events WHERE loop_id = $1', [req.params.loopId]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No mint event for this loop', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    res.json(mintEventFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /mint/history ────────────────────────────────────────────────────
app.get('/mint/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    let query = 'SELECT * FROM mint.mint_events';
    const params: any[] = [];
    let idx = 0;

    if (req.query.status) {
      idx++;
      query += ` WHERE status = $${idx}`;
      params.push(req.query.status);
    }
    query += ` ORDER BY created_at DESC LIMIT $${idx + 1} OFFSET $${idx + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows.map(mintEventFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /mint/:mintEventId/confirm ──────────────────────────────────────
app.post('/mint/:mintEventId/confirm', async (req, res) => {
  try {
    const mintEventId = req.params.mintEventId;
    const existing = await pool.query('SELECT * FROM mint.mint_events WHERE id = $1', [mintEventId]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Mint event not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    if (existing.rows[0].status !== 'provisional') {
      res.status(400).json({ error: 'Mint is not provisional', code: 'INVALID_STATE', timestamp: new Date().toISOString() });
      return;
    }

    await pool.query(
      `UPDATE mint.mint_events SET status = 'confirmed', retroactive_validation_at = NOW() WHERE id = $1`,
      [mintEventId],
    );

    const updated = await pool.query('SELECT * FROM mint.mint_events WHERE id = $1', [mintEventId]);
    const mintEvent = mintEventFromRow(updated.rows[0]);

    await bus.emit(EventType.XP_CONFIRMED, mintEvent.loopId, {
      mintEventId: mintEvent.id,
      loopId: mintEvent.loopId,
      totalXP: mintEvent.totalMinted,
    } as XPConfirmedPayload);

    console.log(`[xp-mint] Mint ${mintEventId} CONFIRMED`);
    res.json(mintEvent);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /mint/:mintEventId/burn ─────────────────────────────────────────
app.post('/mint/:mintEventId/burn', async (req, res) => {
  try {
    const mintEventId = req.params.mintEventId;
    const { reason } = req.body;

    const existing = await pool.query('SELECT * FROM mint.mint_events WHERE id = $1', [mintEventId]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Mint event not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    if (existing.rows[0].status !== 'provisional') {
      res.status(400).json({ error: 'Mint is not provisional', code: 'INVALID_STATE', timestamp: new Date().toISOString() });
      return;
    }

    await pool.query(
      `UPDATE mint.mint_events SET status = 'burned', burn_reason = $1, retroactive_validation_at = NOW() WHERE id = $2`,
      [reason, mintEventId],
    );

    const updated = await pool.query('SELECT * FROM mint.mint_events WHERE id = $1', [mintEventId]);
    const mintEvent = mintEventFromRow(updated.rows[0]);

    await bus.emit(EventType.XP_BURNED, mintEvent.loopId, {
      mintEventId: mintEvent.id,
      loopId: mintEvent.loopId,
      burnReason: reason,
      xpBurned: mintEvent.totalMinted,
    } as XPBurnedPayload);

    console.log(`[xp-mint] Mint ${mintEventId} BURNED: ${reason}`);
    res.json(mintEvent);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /mint/calculate ─────────────────────────────────────────────────
app.post('/mint/calculate', (req, res) => {
  const inputs = req.body as XPFormulaInputs;
  const xpValue = calculateXP(inputs);

  res.json({
    xpValue,
    breakdown: {
      reputationFactor: inputs.reputation,
      feedbackClosureStrength: inputs.feedbackClosure,
      deltaS: inputs.deltaS,
      domainEssentialityProduct: inputs.domainWeight * inputs.essentiality,
      settlementTimeFactor: inputs.settlementTimeSeconds > 0
        ? Math.log(1 / inputs.settlementTimeSeconds)
        : 0,
    },
    irreducibleXP: null,
    formulaUsed: `XP = ${inputs.reputation} × ${inputs.feedbackClosure} × ${inputs.deltaS} × (${inputs.domainWeight} × ${inputs.essentiality}) × log(1/${inputs.settlementTimeSeconds})`,
  });
});

// ── GET /supply ──────────────────────────────────────────────────────────
app.get('/supply', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(SUM(total_minted), 0) as total_minted,
        COALESCE(SUM(CASE WHEN status = 'confirmed' THEN total_minted ELSE 0 END), 0) as total_confirmed,
        COALESCE(SUM(CASE WHEN status = 'burned' THEN total_minted ELSE 0 END), 0) as total_burned,
        COALESCE(SUM(CASE WHEN status = 'provisional' THEN total_minted ELSE 0 END), 0) as total_provisional,
        COUNT(*) as event_count
      FROM mint.mint_events
    `);
    const row = result.rows[0];
    res.json({
      totalMinted: parseFloat(row.total_minted),
      totalConfirmed: parseFloat(row.total_confirmed),
      totalBurned: parseFloat(row.total_burned),
      totalProvisional: parseFloat(row.total_provisional),
      eventCount: parseInt(row.event_count),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── GET /supply/by-validator/:validatorId ────────────────────────────────
app.get('/supply/by-validator/:validatorId', async (req, res) => {
  try {
    const validatorId = req.params.validatorId;
    const result = await pool.query('SELECT distribution, total_minted, status FROM mint.mint_events');

    let totalXP = 0;
    for (const row of result.rows) {
      const dist = row.distribution || [];
      for (const d of dist) {
        if (d.validatorId === validatorId && row.status !== 'burned') {
          totalXP += d.xpAmount || 0;
        }
      }
    }

    res.json({ validatorId, totalXP });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ── POST /events ─────────────────────────────────────────────────────────
app.post('/events', async (req, res) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[xp-mint] Received event: ${event.type}`);

    switch (event.type) {
      case EventType.LOOP_CLOSED: {
        const payload = event.payload as LoopClosedPayload;
        console.log(`[xp-mint] Loop ${payload.loop.id} closed — auto-minting XP`);
        try {
          await mintForLoop(payload.loop.id);
        } catch (err) {
          console.error(`[xp-mint] Error minting for loop ${payload.loop.id}:`, err);
        }
        break;
      }
      default:
        break;
    }

    res.status(202).send();
  } catch (err: any) {
    console.error('[xp-mint] Event handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────

async function main() {
  await waitForPostgres(pool);
  await waitForRedis(redis);
  await bus.start();

  // Subscribe via bus
  bus.on(EventType.LOOP_CLOSED, async (event) => {
    const payload = event.payload as LoopClosedPayload;
    console.log(`[xp-mint] Bus: Loop ${payload.loop.id} closed — auto-minting`);
    try {
      await mintForLoop(payload.loop.id);
    } catch (err) {
      console.error(`[xp-mint] Bus: Error minting for loop ${payload.loop.id}:`, err);
    }
  });

  app.listen(PORT, () => {
    console.log(`[xp-mint] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[xp-mint] Fatal startup error:', err);
  process.exit(1);
});

export { calculateXP, calculateIrreducibleXP };
export default app;
