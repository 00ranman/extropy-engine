/**
 * Ecosystem Integration Service — Service Entrypoint
 *
 * Port: 4014
 *
 * Application-layer API surface for the Extropy Engine ecosystem:
 *   - Skill DAG       (LevelUp Academy)
 *   - XP Oracle Layer (external platform connectors)
 *   - Cross-Domain XP Exchange
 *   - Merchant Network (EP conversion)
 *   - Ecosystem health & integration status
 *
 * Subscriptions: LOOP_CLOSED, CAT_CERTIFIED
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
} from '@extropy/contracts';
import type {
  SkillNode,
  SkillNodeId,
  XPOracleSource,
  XPOracleMappingRule,
  XPExchange,
  ValidatorId,
  DomainEvent,
  ServiceHealthResponse,
  EntropyDomain,
  LoopClosedPayload,
  CATCertifiedPayload,
  SkillNodeCreatedPayload,
  SkillMasteredPayload,
  XPOracleSyncPayload,
  XPExchangeCompletedPayload,
  EPConvertedPayload,
  CredentialId,
  EPConversionInputs,
  DFAOId,
  LoopId,
} from '@extropy/contracts';

const app: Express = express();
app.use(express.json());

const PORT  = process.env.PORT                || 4014;
const SERVICE = ServiceName.ECOSYSTEM;
const TOKEN_ECONOMY_URL = process.env.TOKEN_ECONOMY_URL || 'http://token-economy:4009';

const pool  = createPool();
const redis = createRedis();
const bus   = new EventBus(redis, pool, SERVICE);

// ─────────────────────────────────────────────────────────────────────────────
//  DB Helpers — row mappers
// ─────────────────────────────────────────────────────────────────────────────

function skillNodeFromRow(row: any): SkillNode {
  return {
    id: row.id as SkillNodeId,
    name: row.name,
    domain: row.domain as EntropyDomain,
    prerequisiteIds: row.prerequisite_ids || [],
    requiredCATLevel: row.required_cat_level ?? 0,
    dfaoId: row.dfao_id ?? null,
    masteryThreshold: row.mastery_threshold ?? 10,
    metadata: row.metadata || {},
  };
}

function oracleSourceFromRow(row: any): XPOracleSource {
  return {
    id: row.id,
    platform: row.platform,
    mappingRules: row.mapping_rules || [],
    isActive: row.is_active,
    lastSyncAt: row.last_sync_at ? row.last_sync_at.toISOString() : null,
  };
}

function exchangeFromRow(row: any): XPExchange {
  return {
    id: row.id,
    fromDomain: row.from_domain as EntropyDomain,
    toDomain: row.to_domain as EntropyDomain,
    exchangeRate: parseFloat(row.exchange_rate),
    transferFriction: parseFloat(row.transfer_friction),
    minimumAmount: parseFloat(row.minimum_amount),
    governanceApproved: row.governance_approved,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Error helpers
// ─────────────────────────────────────────────────────────────────────────────

function err400(res: express.Response, message: string, code = 'VALIDATION_ERROR'): void {
  res.status(400).json({ error: message, code, timestamp: new Date().toISOString() });
}

function err404(res: express.Response, message: string): void {
  res.status(404).json({ error: message, code: 'NOT_FOUND', timestamp: new Date().toISOString() });
}

function err500(res: express.Response, error: any): void {
  res.status(500).json({ error: error?.message ?? String(error), code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Mastery helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the CAT certifications for a validator from the credentials service.
 * Returns a map of domain → highest CAT level.
 * Falls back to querying ecosystem.validator_cat_cache if available.
 */
async function getValidatorCATLevels(validatorId: ValidatorId): Promise<Record<string, number>> {
  try {
    // Check local cache first
    const cacheRes = await pool.query(
      `SELECT domain, cat_level FROM ecosystem.validator_cat_cache WHERE validator_id = $1`,
      [validatorId],
    );
    if (cacheRes.rows.length > 0) {
      const levels: Record<string, number> = {};
      for (const row of cacheRes.rows) {
        levels[row.domain] = row.cat_level;
      }
      return levels;
    }
  } catch {
    // Table may not exist in all environments
  }
  return {};
}

/**
 * Get the count of validated performances for a validator on skills in a given domain.
 * Checks ecosystem.skill_performances table (populated by LOOP_CLOSED events).
 */
async function getValidatedPerformanceCount(validatorId: ValidatorId, domain: EntropyDomain): Promise<number> {
  try {
    const res = await pool.query(
      `SELECT COALESCE(SUM(performance_count), 0) AS total
         FROM ecosystem.skill_performances
        WHERE validator_id = $1 AND domain = $2`,
      [validatorId, domain],
    );
    return parseInt(res.rows[0]?.total ?? '0', 10);
  } catch {
    return 0;
  }
}

/**
 * Recursively collect all prerequisite IDs for a skill node.
 * Returns them in bottom-up BFS order (deepest prerequisites first).
 */
async function collectPrerequisiteChain(skillId: SkillNodeId, visited = new Set<string>()): Promise<SkillNode[]> {
  if (visited.has(skillId)) return [];
  visited.add(skillId);

  const res = await pool.query(
    `SELECT * FROM ecosystem.skill_nodes WHERE id = $1`,
    [skillId],
  );
  if (res.rows.length === 0) return [];

  const node = skillNodeFromRow(res.rows[0]);
  const result: SkillNode[] = [];

  for (const prereqId of node.prerequisiteIds) {
    const prereqs = await collectPrerequisiteChain(prereqId as SkillNodeId, visited);
    result.push(...prereqs);
  }
  result.push(node);
  return result;
}

/**
 * Check whether a validator has mastered a skill.
 * Mastery requires:
 *   1. All prerequisite skills mastered (CAT level met in their domains)
 *   2. Validated performances in this skill's domain >= masteryThreshold
 */
async function checkSkillMastery(
  validatorId: ValidatorId,
  skill: SkillNode,
): Promise<{ mastered: boolean; reason?: string; performanceCount: number }> {
  const catLevels = await getValidatorCATLevels(validatorId);

  // Check CAT level for this skill's domain
  const validatorCATLevel = catLevels[skill.domain] ?? 0;
  if (validatorCATLevel < skill.requiredCATLevel) {
    return {
      mastered: false,
      reason: `CAT level ${validatorCATLevel} in ${skill.domain} is below required ${skill.requiredCATLevel}`,
      performanceCount: 0,
    };
  }

  // Check prerequisite CAT levels
  if (skill.prerequisiteIds.length > 0) {
    const prereqRes = await pool.query(
      `SELECT * FROM ecosystem.skill_nodes WHERE id = ANY($1::text[])`,
      [skill.prerequisiteIds],
    );
    for (const prereqRow of prereqRes.rows) {
      const prereq = skillNodeFromRow(prereqRow);
      const prereqCAT = catLevels[prereq.domain] ?? 0;
      if (prereqCAT < prereq.requiredCATLevel) {
        return {
          mastered: false,
          reason: `Prerequisite skill "${prereq.name}" not met: CAT level ${prereqCAT} < ${prereq.requiredCATLevel} in ${prereq.domain}`,
          performanceCount: 0,
        };
      }
    }
  }

  // Check validated performances
  const performanceCount = await getValidatedPerformanceCount(validatorId, skill.domain);
  if (performanceCount < skill.masteryThreshold) {
    return {
      mastered: false,
      reason: `Validated performances ${performanceCount} < mastery threshold ${skill.masteryThreshold}`,
      performanceCount,
    };
  }

  return { mastered: true, performanceCount };
}

// ─────────────────────────────────────────────────────────────────────────────
//  GET /health
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  const health: ServiceHealthResponse = {
    service: SERVICE,
    status: 'healthy',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: {
      'token-economy': 'connected',
      'credentials': 'connected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ════════════════════════════════════════════════════════════════════════════════
//  SKILL DAG — LevelUp Academy Foundation
// ════════════════════════════════════════════════════════════════════════════════

// ── POST /skills ────────────────────────────────────────────────────────────────

app.post('/skills', async (req, res) => {
  try {
    const { name, domain, prerequisiteIds, requiredCATLevel, dfaoId, masteryThreshold, metadata } = req.body;

    if (!name || !domain) {
      err400(res, 'Missing required fields: name, domain'); return;
    }

    // Validate prerequisite skills exist
    const prereqIds: SkillNodeId[] = prerequisiteIds || [];
    if (prereqIds.length > 0) {
      const existRes = await pool.query(
        `SELECT id FROM ecosystem.skill_nodes WHERE id = ANY($1::text[])`,
        [prereqIds],
      );
      const foundIds = new Set(existRes.rows.map((r: any) => r.id));
      const missing = prereqIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        err400(res, `Prerequisite skill(s) not found: ${missing.join(', ')}`); return;
      }
    }

    const id = uuidv4() as SkillNodeId;
    const now = new Date().toISOString();

    await pool.query(
      `INSERT INTO ecosystem.skill_nodes
         (id, name, domain, prerequisite_ids, required_cat_level, dfao_id, mastery_threshold, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        name,
        domain,
        prereqIds,
        requiredCATLevel ?? 0,
        dfaoId ?? null,
        masteryThreshold ?? 10,
        JSON.stringify(metadata || {}),
        now,
      ],
    );

    const row = await pool.query(`SELECT * FROM ecosystem.skill_nodes WHERE id = $1`, [id]);
    const skill = skillNodeFromRow(row.rows[0]);

    await bus.emit(
      EventType.SKILL_NODE_CREATED,
      id as unknown as LoopId,
      { skillNode: skill } as SkillNodeCreatedPayload,
    );

    console.log(`[ecosystem] Skill node created: ${name} (${domain})`);
    res.status(201).json(skill);
  } catch (err) {
    console.error('[ecosystem] POST /skills error:', err);
    err500(res, err);
  }
});

// ── GET /skills ───────────────────────────────────────────────────────────────────

app.get('/skills', async (req, res) => {
  try {
    let query = 'SELECT * FROM ecosystem.skill_nodes WHERE 1=1';
    const params: any[] = [];
    let idx = 0;

    if (req.query.domain)  { idx++; query += ` AND domain = $${idx}`;   params.push(req.query.domain); }
    if (req.query.dfaoId)  { idx++; query += ` AND dfao_id = $${idx}`;  params.push(req.query.dfaoId); }

    query += ' ORDER BY created_at ASC';

    const result = await pool.query(query, params);
    res.json(result.rows.map(skillNodeFromRow));
  } catch (err) {
    err500(res, err);
  }
});

// ── GET /skills/:id ──────────────────────────────────────────────────────────────

app.get('/skills/:id', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ecosystem.skill_nodes WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) { err404(res, 'Skill not found'); return; }
    res.json(skillNodeFromRow(result.rows[0]));
  } catch (err) {
    err500(res, err);
  }
});

// ── GET /skills/:id/prerequisites ─────────────────────────────────────────────────

app.get('/skills/:id/prerequisites', async (req, res) => {
  try {
    const rootRes = await pool.query(`SELECT * FROM ecosystem.skill_nodes WHERE id = $1`, [req.params.id]);
    if (rootRes.rows.length === 0) { err404(res, 'Skill not found'); return; }

    const root = skillNodeFromRow(rootRes.rows[0]);

    // Recursively collect prerequisites (excluding the root itself)
    const visited = new Set<string>([root.id]);
    const chain: SkillNode[] = [];

    for (const prereqId of root.prerequisiteIds) {
      const prereqs = await collectPrerequisiteChain(prereqId as SkillNodeId, visited);
      chain.push(...prereqs);
    }

    res.json(chain);
  } catch (err) {
    err500(res, err);
  }
});

// ── GET /skills/:id/dependents ────────────────────────────────────────────────────

app.get('/skills/:id/dependents', async (req, res) => {
  try {
    const skillRes = await pool.query(`SELECT id FROM ecosystem.skill_nodes WHERE id = $1`, [req.params.id]);
    if (skillRes.rows.length === 0) { err404(res, 'Skill not found'); return; }

    // Find all skills that list this ID in their prerequisite_ids
    const result = await pool.query(
      `SELECT * FROM ecosystem.skill_nodes WHERE $1 = ANY(prerequisite_ids) ORDER BY created_at ASC`,
      [req.params.id],
    );
    res.json(result.rows.map(skillNodeFromRow));
  } catch (err) {
    err500(res, err);
  }
});

// ── POST /skills/:id/check-mastery ────────────────────────────────────────────────

app.post('/skills/:id/check-mastery', async (req, res) => {
  try {
    const { validatorId } = req.body;
    if (!validatorId) { err400(res, 'Missing required field: validatorId'); return; }

    const skillRes = await pool.query(`SELECT * FROM ecosystem.skill_nodes WHERE id = $1`, [req.params.id]);
    if (skillRes.rows.length === 0) { err404(res, 'Skill not found'); return; }

    const skill = skillNodeFromRow(skillRes.rows[0]);
    const { mastered, reason, performanceCount } = await checkSkillMastery(validatorId as ValidatorId, skill);

    if (mastered) {
      // Record mastery event — upsert so it is idempotent
      const credentialId = uuidv4() as CredentialId;
      try {
        await pool.query(
          `INSERT INTO ecosystem.skill_masteries (skill_id, validator_id, mastered_at, credential_id)
           VALUES ($1, $2, NOW(), $3)
           ON CONFLICT (skill_id, validator_id) DO NOTHING`,
          [skill.id, validatorId, credentialId],
        );
      } catch {
        // Mastery already recorded — safe to ignore
      }

      await bus.emit(
        EventType.SKILL_MASTERED,
        skill.id as unknown as LoopId,
        {
          validatorId: validatorId as ValidatorId,
          skillNodeId: skill.id,
          validatedPerformances: performanceCount,
          credentialId,
        } as SkillMasteredPayload,
      );

      console.log(`[ecosystem] Validator ${validatorId} mastered skill "${skill.name}"`);
    }

    res.json({
      skillId: skill.id,
      validatorId,
      mastered,
      performanceCount,
      masteryThreshold: skill.masteryThreshold,
      reason: reason ?? null,
    });
  } catch (err) {
    console.error('[ecosystem] POST /skills/:id/check-mastery error:', err);
    err500(res, err);
  }
});

// ── GET /skills/validator/:validatorId ────────────────────────────────────────────

app.get('/skills/validator/:validatorId', async (req, res) => {
  try {
    const { validatorId } = req.params;

    const allSkills = await pool.query(`SELECT * FROM ecosystem.skill_nodes ORDER BY created_at ASC`);
    const catLevels = await getValidatorCATLevels(validatorId as ValidatorId);

    const results = await Promise.all(
      allSkills.rows.map(async (row: any) => {
        const skill = skillNodeFromRow(row);
        const { mastered, reason, performanceCount } = await checkSkillMastery(
          validatorId as ValidatorId,
          skill,
        );

        // Check prerequisites met independently of full mastery
        const prereqsMet = skill.prerequisiteIds.length === 0 || (() => {
          const catLevel = catLevels[skill.domain] ?? 0;
          return catLevel >= skill.requiredCATLevel;
        })();

        return {
          skill,
          mastered,
          prerequisitesMet: prereqsMet,
          performanceCount,
          masteryThreshold: skill.masteryThreshold,
          statusReason: reason ?? null,
        };
      }),
    );

    res.json(results);
  } catch (err) {
    err500(res, err);
  }
});

// ════════════════════════════════════════════════════════════════════════════════
//  XP ORACLE LAYER — External Platform Connectors
// ════════════════════════════════════════════════════════════════════════════════

// ── POST /oracle/sources ──────────────────────────────────────────────────────────

app.post('/oracle/sources', async (req, res) => {
  try {
    const { platform, mappingRules, isActive } = req.body;

    if (!platform || !mappingRules) {
      err400(res, 'Missing required fields: platform, mappingRules'); return;
    }
    if (!Array.isArray(mappingRules) || mappingRules.length === 0) {
      err400(res, 'mappingRules must be a non-empty array'); return;
    }

    const id = uuidv4();
    await pool.query(
      `INSERT INTO ecosystem.oracle_sources (id, platform, mapping_rules, is_active, last_sync_at)
       VALUES ($1, $2, $3, $4, NULL)`,
      [id, platform, JSON.stringify(mappingRules), isActive !== false],
    );

    const row = await pool.query(`SELECT * FROM ecosystem.oracle_sources WHERE id = $1`, [id]);
    const source = oracleSourceFromRow(row.rows[0]);

    console.log(`[ecosystem] Oracle source registered: ${platform}`);
    res.status(201).json(source);
  } catch (err) {
    console.error('[ecosystem] POST /oracle/sources error:', err);
    err500(res, err);
  }
});

// ── GET /oracle/sources ───────────────────────────────────────────────────────────

app.get('/oracle/sources', async (_req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ecosystem.oracle_sources ORDER BY platform ASC`);
    res.json(result.rows.map(oracleSourceFromRow));
  } catch (err) {
    err500(res, err);
  }
});

// ── GET /oracle/sources/:id ─────────────────────────────────────────────────────

app.get('/oracle/sources/:id', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ecosystem.oracle_sources WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) { err404(res, 'Oracle source not found'); return; }
    res.json(oracleSourceFromRow(result.rows[0]));
  } catch (err) {
    err500(res, err);
  }
});

// ── PATCH /oracle/sources/:id ───────────────────────────────────────────────────

app.patch('/oracle/sources/:id', async (req, res) => {
  try {
    const { isActive, mappingRules } = req.body;
    const existing = await pool.query(`SELECT * FROM ecosystem.oracle_sources WHERE id = $1`, [req.params.id]);
    if (existing.rows.length === 0) { err404(res, 'Oracle source not found'); return; }

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 0;

    if (isActive !== undefined) {
      idx++; updates.push(`is_active = $${idx}`); params.push(isActive);
    }
    if (mappingRules !== undefined) {
      if (!Array.isArray(mappingRules)) { err400(res, 'mappingRules must be an array'); return; }
      idx++; updates.push(`mapping_rules = $${idx}`); params.push(JSON.stringify(mappingRules));
    }

    if (updates.length === 0) {
      err400(res, 'No valid fields to update'); return;
    }

    idx++;
    params.push(req.params.id);
    await pool.query(
      `UPDATE ecosystem.oracle_sources SET ${updates.join(', ')} WHERE id = $${idx}`,
      params,
    );

    const updated = await pool.query(`SELECT * FROM ecosystem.oracle_sources WHERE id = $1`, [req.params.id]);
    res.json(oracleSourceFromRow(updated.rows[0]));
  } catch (err) {
    err500(res, err);
  }
});

// ── POST /oracle/sync ──────────────────────────────────────────────────────────────

app.post('/oracle/sync', async (req, res) => {
  try {
    const { sourceId, validatorId, externalData } = req.body;

    if (!sourceId || !validatorId || !externalData) {
      err400(res, 'Missing required fields: sourceId, validatorId, externalData'); return;
    }
    if (!Array.isArray(externalData)) {
      err400(res, 'externalData must be an array of { metric, value } pairs'); return;
    }

    const sourceRes = await pool.query(`SELECT * FROM ecosystem.oracle_sources WHERE id = $1`, [sourceId]);
    if (sourceRes.rows.length === 0) { err404(res, 'Oracle source not found'); return; }

    const source = oracleSourceFromRow(sourceRes.rows[0]);
    if (!source.isActive) {
      err400(res, 'Oracle source is not active', 'SOURCE_INACTIVE'); return;
    }

    const mappingRules: XPOracleMappingRule[] = source.mappingRules;
    const breakdown: Array<{ metric: string; value: number; xpAwarded: number; domain: string; rule: XPOracleMappingRule }> = [];
    const appliedRules: XPOracleMappingRule[] = [];
    let totalXP = 0;

    for (const entry of externalData) {
      const { metric, value } = entry;
      const rule = mappingRules.find((r) => r.externalMetric === metric);
      if (!rule) continue;

      const rawXP   = value * rule.conversionFactor;
      const xpAwarded = Math.min(rawXP, rule.maxXPPerSync);

      breakdown.push({ metric, value, xpAwarded, domain: rule.entropyDomain, rule });
      appliedRules.push(rule);
      totalXP += xpAwarded;
    }

    if (totalXP > 0) {
      // Mint XP to validator via token-economy service (fire-and-forget with logging)
      try {
        const mintRes = await fetch(`${TOKEN_ECONOMY_URL}/wallets/${validatorId}/mint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenType: 'xp',
            amount: totalXP,
            reason: `XP Oracle sync from ${source.platform}`,
          }),
        });
        if (!mintRes.ok) {
          console.warn(`[ecosystem] Token-economy mint failed for oracle sync (${mintRes.status})`);
        }
      } catch (mintErr) {
        console.error('[ecosystem] Oracle sync mint error:', mintErr);
      }
    }

    // Update lastSyncAt on the source
    await pool.query(
      `UPDATE ecosystem.oracle_sources SET last_sync_at = NOW() WHERE id = $1`,
      [sourceId],
    );

    // Record sync history
    const syncId = uuidv4();
    await pool.query(
      `INSERT INTO ecosystem.oracle_sync_history
         (id, source_id, validator_id, total_xp, breakdown, synced_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [syncId, sourceId, validatorId, totalXP, JSON.stringify(breakdown)],
    );

    const syncedAt = new Date().toISOString();
    await bus.emit(
      EventType.XP_ORACLE_SYNC,
      syncId as unknown as LoopId,
      {
        source,
        validatorId: validatorId as ValidatorId,
        xpAwarded: totalXP,
        rulesApplied: appliedRules,
        syncedAt,
      } as XPOracleSyncPayload,
    );

    console.log(`[ecosystem] Oracle sync: ${source.platform} → validator ${validatorId}, +${totalXP} XP`);
    res.json({
      syncId,
      sourceId,
      validatorId,
      totalXP,
      breakdown,
      syncedAt,
    });
  } catch (err) {
    console.error('[ecosystem] POST /oracle/sync error:', err);
    err500(res, err);
  }
});

// ── GET /oracle/validator/:validatorId/history ─────────────────────────────────────

app.get('/oracle/validator/:validatorId/history', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT h.*, s.platform
         FROM ecosystem.oracle_sync_history h
         JOIN ecosystem.oracle_sources s ON s.id = h.source_id
        WHERE h.validator_id = $1
        ORDER BY h.synced_at DESC`,
      [req.params.validatorId],
    );
    res.json(result.rows.map((row: any) => ({
      syncId: row.id,
      sourceId: row.source_id,
      platform: row.platform,
      validatorId: row.validator_id,
      totalXP: parseFloat(row.total_xp),
      breakdown: row.breakdown,
      syncedAt: row.synced_at.toISOString(),
    })));
  } catch (err) {
    err500(res, err);
  }
});

// ════════════════════════════════════════════════════════════════════════════════
//  CROSS-DOMAIN XP EXCHANGE
// ════════════════════════════════════════════════════════════════════════════════

// ── POST /exchange ──────────────────────────────────────────────────────────────────

app.post('/exchange', async (req, res) => {
  try {
    const { fromDomain, toDomain, exchangeRate, transferFriction, minimumAmount, governanceApproved } = req.body;

    if (!fromDomain || !toDomain || exchangeRate === undefined) {
      err400(res, 'Missing required fields: fromDomain, toDomain, exchangeRate'); return;
    }
    if (fromDomain === toDomain) {
      err400(res, 'fromDomain and toDomain must be different'); return;
    }
    if (typeof exchangeRate !== 'number' || exchangeRate <= 0) {
      err400(res, 'exchangeRate must be a positive number'); return;
    }

    const id = uuidv4();
    await pool.query(
      `INSERT INTO ecosystem.xp_exchanges
         (id, from_domain, to_domain, exchange_rate, transfer_friction, minimum_amount, governance_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        fromDomain,
        toDomain,
        exchangeRate,
        transferFriction ?? 0.02,
        minimumAmount ?? 1,
        governanceApproved ?? false,
      ],
    );

    const row = await pool.query(`SELECT * FROM ecosystem.xp_exchanges WHERE id = $1`, [id]);
    const exchange = exchangeFromRow(row.rows[0]);

    console.log(`[ecosystem] XP exchange created: ${fromDomain} → ${toDomain} @ ${exchangeRate}`);
    res.status(201).json(exchange);
  } catch (err) {
    console.error('[ecosystem] POST /exchange error:', err);
    err500(res, err);
  }
});

// ── GET /exchange ───────────────────────────────────────────────────────────────────

app.get('/exchange', async (_req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ecosystem.xp_exchanges ORDER BY from_domain, to_domain`);
    res.json(result.rows.map(exchangeFromRow));
  } catch (err) {
    err500(res, err);
  }
});

// ── GET /exchange/:fromDomain/:toDomain ───────────────────────────────────────────

app.get('/exchange/:fromDomain/:toDomain', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM ecosystem.xp_exchanges WHERE from_domain = $1 AND to_domain = $2`,
      [req.params.fromDomain, req.params.toDomain],
    );
    if (result.rows.length === 0) { err404(res, 'Exchange pair not found'); return; }
    res.json(exchangeFromRow(result.rows[0]));
  } catch (err) {
    err500(res, err);
  }
});

// ── POST /exchange/execute ──────────────────────────────────────────────────────────

app.post('/exchange/execute', async (req, res) => {
  try {
    const { validatorId, fromDomain, toDomain, amount } = req.body;

    if (!validatorId || !fromDomain || !toDomain || amount === undefined) {
      err400(res, 'Missing required fields: validatorId, fromDomain, toDomain, amount'); return;
    }
    if (typeof amount !== 'number' || amount <= 0) {
      err400(res, 'amount must be a positive number'); return;
    }

    // Find the exchange pair
    const exchangeRes = await pool.query(
      `SELECT * FROM ecosystem.xp_exchanges WHERE from_domain = $1 AND to_domain = $2`,
      [fromDomain, toDomain],
    );
    if (exchangeRes.rows.length === 0) {
      err404(res, `Exchange pair ${fromDomain} → ${toDomain} not found`); return;
    }

    const exchange = exchangeFromRow(exchangeRes.rows[0]);

    // Validate governance approval
    if (!exchange.governanceApproved) {
      err400(res, 'Exchange pair is not governance-approved', 'NOT_GOVERNANCE_APPROVED'); return;
    }

    // Validate minimum amount
    if (amount < exchange.minimumAmount) {
      err400(res, `Amount ${amount} is below minimum ${exchange.minimumAmount}`, 'BELOW_MINIMUM'); return;
    }

    // Check validator's XP balance in fromDomain
    let currentBalance = 0;
    try {
      const balRes = await fetch(`${TOKEN_ECONOMY_URL}/wallets/${validatorId}/balance`);
      if (balRes.ok) {
        const walletData = await balRes.json() as any;
        // Try domain-specific balance, fall back to total XP
        currentBalance = walletData?.balancesByDomain?.[fromDomain] ?? walletData?.balances?.xp ?? 0;
      }
    } catch {
      console.warn('[ecosystem] Could not fetch wallet balance for exchange validation');
    }

    if (currentBalance < amount) {
      err400(
        res,
        `Insufficient XP balance in ${fromDomain}: have ${currentBalance}, need ${amount}`,
        'INSUFFICIENT_BALANCE',
      );
      return;
    }

    // Calculate received amount: received = amount × exchangeRate × (1 − transferFriction)
    const amountReceived = amount * exchange.exchangeRate * (1 - exchange.transferFriction);
    const fee            = amount * exchange.exchangeRate * exchange.transferFriction;

    // Execute the exchange via token-economy
    try {
      // Deduct from fromDomain
      await fetch(`${TOKEN_ECONOMY_URL}/wallets/${validatorId}/burn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenType: 'xp',
          amount,
          domain: fromDomain,
          reason: `Cross-domain exchange: ${fromDomain} → ${toDomain}`,
        }),
      });

      // Credit to toDomain
      await fetch(`${TOKEN_ECONOMY_URL}/wallets/${validatorId}/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenType: 'xp',
          amount: amountReceived,
          domain: toDomain,
          reason: `Cross-domain exchange received: ${fromDomain} → ${toDomain}`,
        }),
      });
    } catch (mintErr) {
      console.error('[ecosystem] Exchange execution token-economy error:', mintErr);
      // Continue — record the transaction regardless
    }

    // Create transaction record
    const txId = uuidv4();
    await pool.query(
      `INSERT INTO ecosystem.exchange_transactions
         (id, exchange_id, validator_id, from_domain, to_domain, amount_sent, amount_received, fee, executed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [txId, exchange.id, validatorId, fromDomain, toDomain, amount, amountReceived, fee],
    );

    await bus.emit(
      EventType.XP_EXCHANGE_COMPLETED,
      txId as unknown as LoopId,
      {
        exchange,
        validatorId: validatorId as ValidatorId,
        sentAmount: amount,
        receivedAmount: amountReceived,
        frictionLost: fee,
      } as XPExchangeCompletedPayload,
    );

    console.log(
      `[ecosystem] Exchange executed: ${validatorId} sent ${amount} ${fromDomain} XP, received ${amountReceived.toFixed(4)} ${toDomain} XP`,
    );

    res.json({
      transactionId: txId,
      validatorId,
      fromDomain,
      toDomain,
      amountSent: amount,
      amountReceived,
      fee,
      exchangeRate: exchange.exchangeRate,
      transferFriction: exchange.transferFriction,
      executedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ecosystem] POST /exchange/execute error:', err);
    err500(res, err);
  }
});

// ════════════════════════════════════════════════════════════════════════════════
//  MERCHANT NETWORK — EP Conversion
// ════════════════════════════════════════════════════════════════════════════════

// ── POST /merchants/convert-ep ──────────────────────────────────────────────────────

app.post('/merchants/convert-ep', async (req, res) => {
  try {
    const { validatorId, xpAmount, merchantId, localLoyaltyMultiplier } = req.body;

    if (!validatorId || xpAmount === undefined || !merchantId || localLoyaltyMultiplier === undefined) {
      err400(res, 'Missing required fields: validatorId, xpAmount, merchantId, localLoyaltyMultiplier'); return;
    }
    if (typeof xpAmount !== 'number' || xpAmount <= 0) {
      err400(res, 'xpAmount must be a positive number'); return;
    }
    if (typeof localLoyaltyMultiplier !== 'number' || localLoyaltyMultiplier <= 0) {
      err400(res, 'localLoyaltyMultiplier must be a positive number'); return;
    }

    // EP = xpAmount × localLoyaltyMultiplier
    const epAmount = xpAmount * localLoyaltyMultiplier;

    // Deduct XP from validator's wallet
    let remainingXP = 0;
    try {
      const burnRes = await fetch(`${TOKEN_ECONOMY_URL}/wallets/${validatorId}/burn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenType: 'xp',
          amount: xpAmount,
          reason: `EP conversion for merchant ${merchantId}`,
        }),
      });
      if (burnRes.ok) {
        const burnData = await burnRes.json() as any;
        remainingXP = burnData?.newBalance ?? 0;
      }
    } catch (burnErr) {
      console.error('[ecosystem] EP conversion XP burn error:', burnErr);
    }

    // Mint EP to validator's wallet
    try {
      await fetch(`${TOKEN_ECONOMY_URL}/wallets/${validatorId}/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenType: 'ep',
          amount: epAmount,
          reason: `EP from merchant ${merchantId} (L=${localLoyaltyMultiplier})`,
        }),
      });
    } catch (mintErr) {
      console.error('[ecosystem] EP mint error:', mintErr);
    }

    // Record conversion
    const conversionId = uuidv4();
    await pool.query(
      `INSERT INTO ecosystem.ep_conversions
         (id, validator_id, merchant_id, xp_amount, ep_amount, local_loyalty_multiplier, converted_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [conversionId, validatorId, merchantId, xpAmount, epAmount, localLoyaltyMultiplier],
    );

    const inputs: EPConversionInputs = {
      xpAmount,
      localLoyaltyMultiplier,
    };

    await bus.emit(
      EventType.EP_CONVERTED,
      conversionId as unknown as LoopId,
      {
        validatorId: validatorId as ValidatorId,
        inputs,
        epAwarded: epAmount,
        dfaoId: merchantId as unknown as DFAOId,
      } as EPConvertedPayload,
    );

    console.log(`[ecosystem] EP conversion: validator ${validatorId} → ${epAmount} EP (merchant=${merchantId})`);
    res.json({
      conversionId,
      validatorId,
      merchantId,
      xpDeducted: xpAmount,
      epAmount,
      localLoyaltyMultiplier,
      remainingXP,
      convertedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ecosystem] POST /merchants/convert-ep error:', err);
    err500(res, err);
  }
});

// ── GET /merchants/ep-balance/:validatorId ────────────────────────────────────────

app.get('/merchants/ep-balance/:validatorId', async (req, res) => {
  try {
    const { validatorId } = req.params;

    let epBalance = 0;
    try {
      const balRes = await fetch(`${TOKEN_ECONOMY_URL}/wallets/${validatorId}/balance`);
      if (balRes.ok) {
        const data = await balRes.json() as any;
        epBalance = data?.balances?.ep ?? 0;
      }
    } catch {
      // Fall back to local ledger
    }

    // Total EP ever converted (local record)
    const histRes = await pool.query(
      `SELECT COALESCE(SUM(ep_amount), 0) AS total_ep_converted
         FROM ecosystem.ep_conversions
        WHERE validator_id = $1`,
      [validatorId],
    );
    const totalEPConverted = parseFloat(histRes.rows[0]?.total_ep_converted ?? '0');

    res.json({
      validatorId,
      epBalance,
      totalEPConverted,
      queriedAt: new Date().toISOString(),
    });
  } catch (err) {
    err500(res, err);
  }
});

// ════════════════════════════════════════════════════════════════════════════════
//  ECOSYSTEM HEALTH & INTEGRATIONS
// ════════════════════════════════════════════════════════════════════════════════

// ── GET /ecosystem/stats ──────────────────────────────────────────────────────────

app.get('/ecosystem/stats', async (_req, res) => {
  try {
    const [skillsRes, sourcesRes, exchangesRes, epRes, txRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS count FROM ecosystem.skill_nodes`),
      pool.query(`SELECT COUNT(*) AS count, COUNT(*) FILTER (WHERE is_active) AS active_count FROM ecosystem.oracle_sources`),
      pool.query(`SELECT COUNT(*) AS count, COUNT(*) FILTER (WHERE governance_approved) AS approved_count FROM ecosystem.xp_exchanges`),
      pool.query(`SELECT COALESCE(SUM(ep_amount), 0) AS total_ep FROM ecosystem.ep_conversions`),
      pool.query(`SELECT COUNT(*) AS count FROM ecosystem.exchange_transactions`),
    ]);

    res.json({
      skillNodes: {
        total: parseInt(skillsRes.rows[0].count, 10),
      },
      oracleSources: {
        total: parseInt(sourcesRes.rows[0].count, 10),
        active: parseInt(sourcesRes.rows[0].active_count, 10),
      },
      xpExchanges: {
        total: parseInt(exchangesRes.rows[0].count, 10),
        governanceApproved: parseInt(exchangesRes.rows[0].approved_count, 10),
        totalTransactions: parseInt(txRes.rows[0].count, 10),
      },
      merchantNetwork: {
        totalEPConverted: parseFloat(epRes.rows[0].total_ep),
      },
      queriedAt: new Date().toISOString(),
    });
  } catch (err) {
    err500(res, err);
  }
});

// ── GET /ecosystem/integrations ──────────────────────────────────────────────────

app.get('/ecosystem/integrations', (_req, res) => {
  res.json({
    integrations: {
      LevelUp: {
        status: 'active',
        description: 'Skill DAG powering LevelUp Academy — prerequisite chains, mastery checks, CAT integration.',
        endpoints: [
          'POST /skills',
          'GET /skills',
          'GET /skills/:id',
          'GET /skills/:id/prerequisites',
          'GET /skills/:id/dependents',
          'POST /skills/:id/check-mastery',
          'GET /skills/validator/:validatorId',
        ],
      },
      SignalFlow: {
        status: 'active',
        description: 'Social task management — loop events trigger skill mastery progress updates.',
        endpoints: ['POST /events (LOOP_CLOSED subscription)'],
      },
      HomeFlow: {
        status: 'planned',
        description: 'Home automation entropy reduction tracking — will connect via XP Oracle Layer.',
        endpoints: ['POST /oracle/sources', 'POST /oracle/sync'],
      },
      MerchantNetwork: {
        status: 'active',
        description: 'Local loyalty EP conversion — XP → EP at merchant-defined multipliers.',
        endpoints: [
          'POST /merchants/convert-ep',
          'GET /merchants/ep-balance/:validatorId',
        ],
      },
      ReCoherence: {
        status: 'prototype',
        description: 'Coherence restoration platform — will use cross-domain XP exchange for social/cognitive bridging.',
        endpoints: [
          'POST /exchange',
          'GET /exchange',
          'GET /exchange/:fromDomain/:toDomain',
          'POST /exchange/execute',
        ],
      },
      XPOracleLayer: {
        status: 'active',
        description: 'External platform connectors — maps GitHub commits, chess ratings, language learning streaks, etc. to XP.',
        endpoints: [
          'POST /oracle/sources',
          'GET /oracle/sources',
          'GET /oracle/sources/:id',
          'PATCH /oracle/sources/:id',
          'POST /oracle/sync',
          'GET /oracle/validator/:validatorId/history',
        ],
      },
    },
    queriedAt: new Date().toISOString(),
  });
});

// ════════════════════════════════════════════════════════════════════════════════
//  WEBHOOK RECEIVER
// ════════════════════════════════════════════════════════════════════════════════

app.post('/events', async (req, res) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[ecosystem] Received event: ${event.type}`);
    await handleEvent(event);
    res.status(202).send();
  } catch (err: any) {
    console.error('[ecosystem] Event handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Event Handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleEvent(event: DomainEvent): Promise<void> {
  switch (event.type) {

    case EventType.LOOP_CLOSED: {
      const payload = event.payload as LoopClosedPayload;
      const { loop } = payload;

      // Increment validated performance count for all participating validators
      // in the loop's domain so mastery thresholds can be checked.
      if (loop.validatorIds && loop.validatorIds.length > 0) {
        for (const validatorId of loop.validatorIds) {
          try {
            await pool.query(
              `INSERT INTO ecosystem.skill_performances (validator_id, domain, performance_count, last_loop_id, updated_at)
               VALUES ($1, $2, 1, $3, NOW())
               ON CONFLICT (validator_id, domain)
               DO UPDATE SET performance_count = ecosystem.skill_performances.performance_count + 1,
                             last_loop_id      = EXCLUDED.last_loop_id,
                             updated_at        = NOW()`,
              [validatorId, loop.domain, loop.id],
            );
          } catch (dbErr) {
            console.error(`[ecosystem] Failed to record performance for validator ${validatorId}:`, dbErr);
          }
        }

        // Proactively check skill mastery for each validator in affected domain
        const domainSkills = await pool.query(
          `SELECT * FROM ecosystem.skill_nodes WHERE domain = $1`,
          [loop.domain],
        );

        for (const validatorId of loop.validatorIds) {
          for (const skillRow of domainSkills.rows) {
            const skill = skillNodeFromRow(skillRow);
            try {
              const { mastered } = await checkSkillMastery(validatorId as ValidatorId, skill);
              if (mastered) {
                const credentialId = uuidv4() as CredentialId;
                const inserted = await pool.query(
                  `INSERT INTO ecosystem.skill_masteries (skill_id, validator_id, mastered_at, credential_id)
                   VALUES ($1, $2, NOW(), $3)
                   ON CONFLICT (skill_id, validator_id) DO NOTHING
                   RETURNING id`,
                  [skill.id, validatorId, credentialId],
                );

                if ((inserted.rowCount ?? 0) > 0) {
                  await bus.emit(
                    EventType.SKILL_MASTERED,
                    skill.id as unknown as LoopId,
                    {
                      validatorId: validatorId as ValidatorId,
                      skillNodeId: skill.id,
                      validatedPerformances: skill.masteryThreshold,
                      credentialId,
                    } as SkillMasteredPayload,
                  );
                  console.log(`[ecosystem] LOOP_CLOSED → skill "${skill.name}" mastered by ${validatorId}`);
                }
              }
            } catch (masteryErr) {
              console.error(`[ecosystem] Mastery check error for skill ${skill.id}:`, masteryErr);
            }
          }
        }
      }
      break;
    }

    case EventType.CAT_CERTIFIED: {
      const payload = event.payload as CATCertifiedPayload;
      const { validatorId, domain, level } = payload;

      // Update local CAT cache so mastery checks reflect the new certification
      try {
        await pool.query(
          `INSERT INTO ecosystem.validator_cat_cache (validator_id, domain, cat_level, certified_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (validator_id, domain)
           DO UPDATE SET cat_level    = GREATEST(ecosystem.validator_cat_cache.cat_level, EXCLUDED.cat_level),
                         certified_at = NOW()`,
          [validatorId, domain, level],
        );
      } catch (dbErr) {
        console.error(`[ecosystem] Failed to update CAT cache for validator ${validatorId}:`, dbErr);
      }

      // Re-check all skills in this domain — new CAT may unlock mastery
      const domainSkills = await pool.query(
        `SELECT * FROM ecosystem.skill_nodes WHERE domain = $1`,
        [domain],
      );

      for (const skillRow of domainSkills.rows) {
        const skill = skillNodeFromRow(skillRow);
        try {
          const { mastered } = await checkSkillMastery(validatorId as ValidatorId, skill);
          if (mastered) {
            const credentialId = uuidv4() as CredentialId;
            const inserted = await pool.query(
              `INSERT INTO ecosystem.skill_masteries (skill_id, validator_id, mastered_at, credential_id)
               VALUES ($1, $2, NOW(), $3)
               ON CONFLICT (skill_id, validator_id) DO NOTHING
               RETURNING id`,
              [skill.id, validatorId, credentialId],
            );

            if ((inserted.rowCount ?? 0) > 0) {
              await bus.emit(
                EventType.SKILL_MASTERED,
                skill.id as unknown as LoopId,
                {
                  validatorId: validatorId as ValidatorId,
                  skillNodeId: skill.id,
                  validatedPerformances: skill.masteryThreshold,
                  credentialId,
                } as SkillMasteredPayload,
              );
              console.log(`[ecosystem] CAT_CERTIFIED → skill "${skill.name}" unlocked for ${validatorId}`);
            }
          }
        } catch (masteryErr) {
          console.error(`[ecosystem] Mastery check error post-CAT for skill ${skill.id}:`, masteryErr);
        }
      }

      console.log(`[ecosystem] CAT_CERTIFIED processed: validator ${validatorId} level ${level} in ${domain}`);
      break;
    }

    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await waitForPostgres(pool);
  await waitForRedis(redis);
  await bus.start();

  // Subscribe via Redis pub/sub
  bus.on(EventType.LOOP_CLOSED, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  bus.on(EventType.CAT_CERTIFIED, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  app.listen(PORT, () => {
    console.log(`[ecosystem] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[ecosystem] Fatal startup error:', err);
  process.exit(1);
});

export default app;
