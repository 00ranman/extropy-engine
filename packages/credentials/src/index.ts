/**
 * Credentials Service — Entrypoint
 *
 * Non-monetary reward and verifiable credential layer for the Extropy Engine.
 * Manages reputation levels 1–10, badges, titles, achievements, certifications,
 * leaderboards, and seasonal cosmetic resets.
 *
 * Port: 4013
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
  REPUTATION_LEVEL_THRESHOLDS,
  CredentialType,
} from '@extropy/contracts';
import type {
  Credential,
  CredentialId,
  ValidatorId,
  LoopId,
  SeasonId,
  EntropyDomain,
  DomainEvent,
  ServiceHealthResponse,
  LeaderboardEntry,
  ReputationAccruedPayload,
  LoopClosedPayload,
  CATCertifiedPayload,
  SeasonEndedPayload,
  GovernanceVoteCastPayload,
  CredentialIssuedPayload,
  CredentialRevokedPayload,
  LevelUpPayload,
  BadgeEarnedPayload,
  TitleAwardedPayload,
} from '@extropy/contracts';

const app: Express = express();
app.use(express.json());

const PORT   = process.env.PORT              || 4013;
const SERVICE = ServiceName.CREDENTIALS;
const REPUTATION_URL = process.env.REPUTATION_URL || 'http://reputation:4005';
const ECONOMY_URL    = process.env.ECONOMY_URL    || 'http://token-economy:4009';

const pool  = createPool();
const redis = createRedis();
const bus   = new EventBus(redis, pool, SERVICE);

// ─────────────────────────────────────────────────────────────────────────────────
//  DB Row → Domain Object
// ─────────────────────────────────────────────────────────────────────────────────

function credentialFromRow(row: any): Credential {
  return {
    id:                    row.id            as CredentialId,
    validatorId:           row.validator_id  as ValidatorId,
    type:                  row.type          as CredentialType,
    name:                  row.name,
    description:           row.description,
    level:                 row.level         ?? null,
    domain:                row.domain        ?? null,
    seasonId:              row.season_id     as SeasonId,
    persistsAcrossSeasons: row.persists_across_seasons,
    vertexId:              row.vertex_id,
    visualMetadata:        row.visual_metadata || {},
    issuedAt:              row.issued_at  ? new Date(row.issued_at).toISOString()  : new Date().toISOString(),
    expiresAt:             row.expires_at ? new Date(row.expires_at).toISOString() : null,
    revokedAt:             row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────────

/** Determine the reputation level (1–10) for a given aggregate reputation score. */
function computeLevel(aggregateReputation: number): number {
  let level = 1;
  for (let l = 10; l >= 1; l--) {
    if (aggregateReputation >= REPUTATION_LEVEL_THRESHOLDS[l].minReputation) {
      level = l;
      break;
    }
  }
  return level;
}

/** Return XP needed to reach the next level from the current one. */
function xpToNextLevel(currentLevel: number, currentXP: number): number {
  if (currentLevel >= 10) return 0;
  return REPUTATION_LEVEL_THRESHOLDS[currentLevel + 1].minReputation - currentXP;
}

/** Return level progress as a percentage [0–100]. */
function levelProgress(currentLevel: number, currentXP: number): number {
  if (currentLevel >= 10) return 100;
  const current  = REPUTATION_LEVEL_THRESHOLDS[currentLevel].minReputation;
  const next     = REPUTATION_LEVEL_THRESHOLDS[currentLevel + 1].minReputation;
  const progress = ((currentXP - current) / (next - current)) * 100;
  return Math.min(100, Math.max(0, Math.round(progress)));
}

/** Issue a credential and emit CREDENTIAL_ISSUED. Returns the saved credential. */
async function issueCredential(params: {
  validatorId:           ValidatorId;
  type:                  CredentialType;
  name:                  string;
  description:           string;
  level?:                number | null;
  domain?:               EntropyDomain | null;
  seasonId:              SeasonId;
  persistsAcrossSeasons: boolean;
  visualMetadata?:       Record<string, unknown>;
  expiresAt?:            string | null;
  correlationId?:        LoopId;
}): Promise<Credential> {
  const id         = uuidv4() as CredentialId;
  const vertexId   = uuidv4();
  const correlationId = (params.correlationId || uuidv4()) as LoopId;

  await pool.query(
    `INSERT INTO credentials.credentials
       (id, validator_id, type, name, description, level, domain,
        season_id, persists_across_seasons, vertex_id, visual_metadata, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      params.validatorId,
      params.type,
      params.name,
      params.description,
      params.level  ?? null,
      params.domain ?? null,
      params.seasonId,
      params.persistsAcrossSeasons,
      vertexId,
      JSON.stringify(params.visualMetadata || {}),
      params.expiresAt ? new Date(params.expiresAt) : null,
    ],
  );

  const row    = await pool.query('SELECT * FROM credentials.credentials WHERE id = $1', [id]);
  const credential = credentialFromRow(row.rows[0]);

  await bus.emit(
    EventType.CREDENTIAL_ISSUED,
    correlationId,
    { credential } as CredentialIssuedPayload,
  );

  console.log(`[credentials] Issued ${params.type} credential "${params.name}" → validator=${params.validatorId}`);
  return credential;
}

/** Check if a badge with the given name already exists for a validator. */
async function hasBadge(validatorId: ValidatorId, name: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT id FROM credentials.credentials
     WHERE validator_id = $1 AND type = $2 AND name = $3 AND revoked_at IS NULL`,
    [validatorId, CredentialType.BADGE, name],
  );
  return res.rows.length > 0;
}

/** Fetch the validator's current known level from DB (stored in level tracking table). */
async function getStoredLevel(validatorId: ValidatorId): Promise<number> {
  const res = await pool.query(
    `SELECT current_level FROM credentials.validator_levels WHERE validator_id = $1`,
    [validatorId],
  );
  return res.rows.length > 0 ? res.rows[0].current_level : 0;
}

/** Upsert the stored level for a validator. */
async function setStoredLevel(validatorId: ValidatorId, level: number): Promise<void> {
  await pool.query(
    `INSERT INTO credentials.validator_levels (validator_id, current_level, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (validator_id)
     DO UPDATE SET current_level = $2, updated_at = NOW()`,
    [validatorId, level],
  );
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
      reputation:     'connected',
      'token-economy': 'connected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Credential Management
// ─────────────────────────────────────────────────────────────────────────────────

/** POST /credentials — Issue a credential */
app.post('/credentials', async (req, res) => {
  try {
    const {
      validatorId,
      type,
      name,
      description,
      level,
      domain,
      seasonId,
      persistsAcrossSeasons,
      visualMetadata,
      expiresAt,
    } = req.body;

    if (!validatorId || !type || !name || !description || !seasonId) {
      res.status(400).json({
        error:     'Missing required fields: validatorId, type, name, description, seasonId',
        code:      'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const credential = await issueCredential({
      validatorId,
      type,
      name,
      description,
      level:                 level ?? null,
      domain:                domain ?? null,
      seasonId,
      persistsAcrossSeasons: persistsAcrossSeasons ?? false,
      visualMetadata:        visualMetadata ?? {},
      expiresAt:             expiresAt ?? null,
    });

    res.status(201).json(credential);
  } catch (err: any) {
    console.error('[credentials] POST /credentials error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/** GET /credentials/:id — Get credential by ID */
app.get('/credentials/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM credentials.credentials WHERE id = $1',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Credential not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    res.json(credentialFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/** GET /credentials/validator/:validatorId — Get credentials for a validator */
app.get('/credentials/validator/:validatorId', async (req, res) => {
  try {
    const { type, season, domain } = req.query;
    let query = `SELECT * FROM credentials.credentials
                 WHERE validator_id = $1 AND revoked_at IS NULL
                   AND (expires_at IS NULL OR expires_at > NOW())`;
    const params: any[] = [req.params.validatorId];
    let idx = 1;

    if (type)   { idx++; query += ` AND type = $${idx}`;      params.push(type);   }
    if (season) { idx++; query += ` AND season_id = $${idx}`; params.push(season); }
    if (domain) { idx++; query += ` AND domain = $${idx}`;    params.push(domain); }

    query += ' ORDER BY issued_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows.map(credentialFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/** DELETE /credentials/:id — Revoke a credential */
app.delete('/credentials/:id', async (req, res) => {
  try {
    const { reason } = req.body || {};
    const result = await pool.query(
      `UPDATE credentials.credentials
       SET revoked_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING *`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Credential not found or already revoked', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    const credential = credentialFromRow(result.rows[0]);
    const correlationId = uuidv4() as LoopId;

    await bus.emit(
      EventType.CREDENTIAL_REVOKED,
      correlationId,
      {
        credentialId: credential.id,
        validatorId:  credential.validatorId,
        reason:       reason || 'Manual revocation',
        revokedAt:    credential.revokedAt!,
      } as CredentialRevokedPayload,
    );

    console.log(`[credentials] Revoked credential ${credential.id} (validator=${credential.validatorId})`);
    res.json(credential);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Level Management
// ─────────────────────────────────────────────────────────────────────────────────

/** POST /levels/check/:validatorId — Check and update reputation level */
app.post('/levels/check/:validatorId', async (req, res) => {
  try {
    const validatorId = req.params.validatorId as ValidatorId;

    // Query current reputation from reputation service
    let aggregateReputation = 0;
    let seasonId = 'season-1' as SeasonId;

    try {
      const repRes = await fetch(`${REPUTATION_URL}/validators/${validatorId}`);
      if (repRes.ok) {
        const validator = await repRes.json() as any;
        aggregateReputation = validator.aggregate_reputation ?? validator.reputation?.aggregate ?? 0;
        seasonId = validator.current_season_id || seasonId;
      }
    } catch (err) {
      console.warn(`[credentials] Could not fetch reputation for ${validatorId}:`, err);
    }

    const newLevel      = computeLevel(aggregateReputation);
    const previousLevel = await getStoredLevel(validatorId);

    const response: Record<string, any> = {
      validatorId,
      currentLevel:   newLevel,
      previousLevel,
      title:          REPUTATION_LEVEL_THRESHOLDS[newLevel].title,
      aggregateXP:    aggregateReputation,
      progress:       levelProgress(newLevel, aggregateReputation),
      xpToNextLevel:  xpToNextLevel(newLevel, aggregateReputation),
      leveledUp:      false,
    };

    if (newLevel > previousLevel) {
      // Issue LEVEL credential
      const levelCredential = await issueCredential({
        validatorId,
        type:                  CredentialType.LEVEL,
        name:                  `Level ${newLevel}`,
        description:           `Reached reputation level ${newLevel}: ${REPUTATION_LEVEL_THRESHOLDS[newLevel].title}`,
        level:                 newLevel,
        seasonId,
        persistsAcrossSeasons: true,
        visualMetadata:        { level: newLevel, color: getLevelColor(newLevel) },
      });

      // Issue TITLE credential
      const titleCredential = await issueCredential({
        validatorId,
        type:                  CredentialType.TITLE,
        name:                  REPUTATION_LEVEL_THRESHOLDS[newLevel].title,
        description:           `Earned the title "${REPUTATION_LEVEL_THRESHOLDS[newLevel].title}" at level ${newLevel}`,
        level:                 newLevel,
        seasonId,
        persistsAcrossSeasons: true,
        visualMetadata:        { title: REPUTATION_LEVEL_THRESHOLDS[newLevel].title },
      });

      await setStoredLevel(validatorId, newLevel);

      const correlationId = uuidv4() as LoopId;
      await bus.emit(
        EventType.LEVEL_UP,
        correlationId,
        {
          validatorId,
          previousLevel,
          newLevel,
          title:        REPUTATION_LEVEL_THRESHOLDS[newLevel].title,
          credentialId: levelCredential.id,
        } as LevelUpPayload,
      );

      response.leveledUp         = true;
      response.newLevelCredential = levelCredential;
      response.newTitleCredential = titleCredential;

      console.log(`[credentials] LEVEL UP: validator=${validatorId} ${previousLevel} → ${newLevel} (${REPUTATION_LEVEL_THRESHOLDS[newLevel].title})`);
    } else {
      // Ensure stored level is always up-to-date (handles first-time check)
      if (previousLevel === 0 && newLevel >= 1) {
        await setStoredLevel(validatorId, newLevel);
      }
    }

    res.json(response);
  } catch (err: any) {
    console.error('[credentials] POST /levels/check error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/** GET /levels/:validatorId — Get current level info */
app.get('/levels/:validatorId', async (req, res) => {
  try {
    const validatorId = req.params.validatorId as ValidatorId;

    let aggregateReputation = 0;
    try {
      const repRes = await fetch(`${REPUTATION_URL}/validators/${validatorId}`);
      if (repRes.ok) {
        const validator = await repRes.json() as any;
        aggregateReputation = validator.aggregate_reputation ?? validator.reputation?.aggregate ?? 0;
      }
    } catch {
      // Fall through with 0
    }

    const level    = computeLevel(aggregateReputation);
    const threshold = REPUTATION_LEVEL_THRESHOLDS[level];

    res.json({
      validatorId,
      level,
      title:         threshold.title,
      totalXP:       aggregateReputation,
      progress:      levelProgress(level, aggregateReputation),
      xpToNextLevel: xpToNextLevel(level, aggregateReputation),
      nextLevelTitle: level < 10 ? REPUTATION_LEVEL_THRESHOLDS[level + 1].title : null,
      maxLevel:      level >= 10,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/** GET /levels/leaderboard — Global level leaderboard */
app.get('/levels/leaderboard', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);

    const result = await pool.query(
      `SELECT
         vl.validator_id,
         vl.current_level,
         COUNT(DISTINCT c.id) FILTER (WHERE c.type = 'badge' AND c.revoked_at IS NULL) AS badge_count,
         (SELECT name FROM credentials.credentials
          WHERE validator_id = vl.validator_id AND type = 'title' AND revoked_at IS NULL
          ORDER BY issued_at DESC LIMIT 1) AS title
       FROM credentials.validator_levels vl
       LEFT JOIN credentials.credentials c ON c.validator_id = vl.validator_id
       GROUP BY vl.validator_id, vl.current_level
       ORDER BY vl.current_level DESC, vl.updated_at ASC
       LIMIT $1`,
      [limit],
    );

    const entries = result.rows.map((row: any, idx: number) => ({
      rank:            idx + 1,
      validatorId:     row.validator_id,
      reputationLevel: row.current_level,
      title:           row.title || REPUTATION_LEVEL_THRESHOLDS[row.current_level]?.title || 'Novice',
      badgeCount:      parseInt(row.badge_count, 10),
    }));

    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Badge Management
// ─────────────────────────────────────────────────────────────────────────────────

/** POST /badges/award — Award a badge to a validator */
app.post('/badges/award', async (req, res) => {
  try {
    const { validatorId, name, description, domain, seasonId, visualMetadata } = req.body;

    if (!validatorId || !name || !description || !seasonId) {
      res.status(400).json({
        error:     'Missing required fields: validatorId, name, description, seasonId',
        code:      'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const credential = await issueCredential({
      validatorId,
      type:                  CredentialType.BADGE,
      name,
      description,
      domain:                domain ?? null,
      seasonId,
      persistsAcrossSeasons: false,
      visualMetadata:        visualMetadata ?? {},
    });

    const correlationId = uuidv4() as LoopId;
    await bus.emit(
      EventType.BADGE_EARNED,
      correlationId,
      { credential, triggeredBy: 'manual' } as BadgeEarnedPayload,
    );

    res.status(201).json(credential);
  } catch (err: any) {
    console.error('[credentials] POST /badges/award error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/** GET /badges/validator/:validatorId — Get all badges for a validator */
app.get('/badges/validator/:validatorId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM credentials.credentials
       WHERE validator_id = $1 AND type = $2 AND revoked_at IS NULL
       ORDER BY issued_at DESC`,
      [req.params.validatorId, CredentialType.BADGE],
    );
    res.json(result.rows.map(credentialFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/** POST /badges/check-automated — Check and award automated milestone badges */
app.post('/badges/check-automated', async (req, res) => {
  try {
    const { validatorId, seasonId } = req.body;
    if (!validatorId || !seasonId) {
      res.status(400).json({
        error: 'Missing required fields: validatorId, seasonId',
        code:  'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const awarded: Credential[] = [];

    // Fetch validator stats from reputation service
    let stats: any = {};
    try {
      const repRes = await fetch(`${REPUTATION_URL}/validators/${validatorId}`);
      if (repRes.ok) stats = await repRes.json();
    } catch {
      // Proceed with empty stats
    }

    const loopsParticipated  = stats.loops_participated   ?? stats.loopsParticipated  ?? 0;
    const currentStreak      = stats.current_streak        ?? stats.reputation?.currentStreak ?? 0;
    const domains: string[]  = stats.domains || [];
    const seasonNumber       = stats.season_number         ?? 1;
    const mentorshipBonuses  = stats.mentorship_bonuses    ?? 0;

    // CAT levels per domain — try to fetch from token economy
    let catLevels: Record<string, number> = {};
    try {
      const catRes = await fetch(`${ECONOMY_URL}/wallets/validator/${validatorId}/cat-levels`);
      if (catRes.ok) catLevels = (await catRes.json()) as Record<string, number>;
    } catch {
      // Proceed without CAT data
    }

    // Governance participation badge is handled via event subscription (GOVERNANCE_VOTE_CAST)
    // so we don't need to re-check it in automated badge checks

    const milestones: Array<{
      name: string;
      description: string;
      condition: boolean;
      domain?: EntropyDomain;
    }> = [
      {
        name:        'First Loop',
        description: 'Participated in your first verification loop',
        condition:   loopsParticipated >= 1,
      },
      {
        name:        'Streak Master',
        description: 'Achieved 10 consecutive successful validations',
        condition:   currentStreak >= 10,
      },
      {
        name:        'Cross-Domain',
        description: 'Participated in 3 or more entropy domains',
        condition:   domains.length >= 3,
      },
      {
        name:        'Pioneer',
        description: 'Joined the Extropy Engine during the first season',
        condition:   seasonNumber === 1,
      },
      {
        name:        'Mentor',
        description: 'Awarded a mentorship bonus for helping other validators',
        condition:   mentorshipBonuses > 0,
      },
      {
        name:        'Century Club',
        description: 'Participated in 100 verification loops',
        condition:   loopsParticipated >= 100,
      },
      {
        name:        'Thousand Club',
        description: 'Participated in 1000 verification loops',
        condition:   loopsParticipated >= 1000,
      },
    ];

    // Domain Expert — CAT level 3+ in any domain
    for (const [domain, level] of Object.entries(catLevels)) {
      if (level >= 3) {
        milestones.push({
          name:        'Domain Expert',
          description: `Achieved CAT level 3 or above in the ${domain} domain`,
          condition:   true,
          domain:      domain as EntropyDomain,
        });
        break; // Award once per check; can be awarded separately per domain
      }
    }

    for (const milestone of milestones) {
      if (!milestone.condition) continue;
      const alreadyAwarded = await hasBadge(validatorId as ValidatorId, milestone.name);
      if (alreadyAwarded) continue;

      const credential = await issueCredential({
        validatorId:           validatorId as ValidatorId,
        type:                  CredentialType.BADGE,
        name:                  milestone.name,
        description:           milestone.description,
        domain:                milestone.domain ?? null,
        seasonId:              seasonId as SeasonId,
        persistsAcrossSeasons: milestone.name === 'Pioneer', // Pioneer persists
        visualMetadata:        { automated: true, milestone: milestone.name },
      });

      const correlationId = uuidv4() as LoopId;
      await bus.emit(
        EventType.BADGE_EARNED,
        correlationId,
        { credential, triggeredBy: `automated:${milestone.name}` } as BadgeEarnedPayload,
      );

      awarded.push(credential);
    }

    res.json({ awarded, count: awarded.length });
  } catch (err: any) {
    console.error('[credentials] POST /badges/check-automated error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Title Management
// ─────────────────────────────────────────────────────────────────────────────────

/** POST /titles/award — Award a title to a validator */
app.post('/titles/award', async (req, res) => {
  try {
    const { validatorId, title, description, seasonId, persistsAcrossSeasons } = req.body;

    if (!validatorId || !title || !description || !seasonId) {
      res.status(400).json({
        error:     'Missing required fields: validatorId, title, description, seasonId',
        code:      'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const credential = await issueCredential({
      validatorId:           validatorId as ValidatorId,
      type:                  CredentialType.TITLE,
      name:                  title,
      description,
      seasonId:              seasonId as SeasonId,
      persistsAcrossSeasons: persistsAcrossSeasons ?? false,
      visualMetadata:        { title },
    });

    const storedLevel = await getStoredLevel(validatorId as ValidatorId);
    const correlationId = uuidv4() as LoopId;

    await bus.emit(
      EventType.TITLE_AWARDED,
      correlationId,
      { credential, reputationLevel: storedLevel } as TitleAwardedPayload,
    );

    res.status(201).json(credential);
  } catch (err: any) {
    console.error('[credentials] POST /titles/award error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/** GET /titles/validator/:validatorId — Get all titles for a validator */
app.get('/titles/validator/:validatorId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM credentials.credentials
       WHERE validator_id = $1 AND type = $2 AND revoked_at IS NULL
       ORDER BY issued_at DESC`,
      [req.params.validatorId, CredentialType.TITLE],
    );
    res.json(result.rows.map(credentialFromRow));
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Seasonal Operations
// ─────────────────────────────────────────────────────────────────────────────────

/** POST /seasons/:seasonId/cosmetic-reset — Revoke non-persistent seasonal credentials */
app.post('/seasons/:seasonId/cosmetic-reset', async (req, res) => {
  try {
    const { seasonId } = req.params;
    const result = await pool.query(
      `UPDATE credentials.credentials
       SET revoked_at = NOW()
       WHERE season_id = $1
         AND persists_across_seasons = false
         AND revoked_at IS NULL
       RETURNING *`,
      [seasonId],
    );

    const revoked = result.rows.map(credentialFromRow);

    // Emit revocation events for each
    for (const credential of revoked) {
      const correlationId = uuidv4() as LoopId;
      await bus.emit(
        EventType.CREDENTIAL_REVOKED,
        correlationId,
        {
          credentialId: credential.id,
          validatorId:  credential.validatorId,
          reason:       `Seasonal cosmetic reset for season ${seasonId}`,
          revokedAt:    credential.revokedAt!,
        } as CredentialRevokedPayload,
      );
    }

    console.log(`[credentials] Cosmetic reset for season ${seasonId}: revoked ${revoked.length} credentials`);
    res.json({ seasonId, revokedCount: revoked.length, revoked });
  } catch (err: any) {
    console.error('[credentials] POST /seasons/:seasonId/cosmetic-reset error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/** POST /seasons/:seasonId/award-final-titles — Award end-of-season titles */
app.post('/seasons/:seasonId/award-final-titles', async (req, res) => {
  try {
    const { seasonId } = req.params;
    const { rankings } = req.body; // Optional: pre-computed rankings array [{validatorId, rank, totalXP}]

    const awarded: Credential[] = [];

    // Determine rankings — use provided or query leaderboard
    let rankedValidators: Array<{ validatorId: string; rank: number; totalXP: number }> = rankings || [];

    if (rankedValidators.length === 0) {
      // Fall back to DB-based ranking by reputation level + XP
      const leaderRes = await pool.query(
        `SELECT vl.validator_id, vl.current_level
         FROM credentials.validator_levels vl
         ORDER BY vl.current_level DESC, vl.updated_at ASC
         LIMIT 10`,
      );
      rankedValidators = leaderRes.rows.map((row: any, idx: number) => ({
        validatorId: row.validator_id,
        rank:        idx + 1,
        totalXP:     0,
      }));
    }

    for (const entry of rankedValidators) {
      const vId = entry.validatorId as ValidatorId;

      if (entry.rank === 1) {
        // Award "Ecosystem Pioneer" title to rank #1
        const titleCred = await issueCredential({
          validatorId:           vId,
          type:                  CredentialType.TITLE,
          name:                  'Ecosystem Pioneer',
          description:           `Season ${seasonId} champion — ranked #1 in the Extropy Engine`,
          seasonId:              seasonId as SeasonId,
          persistsAcrossSeasons: true,
          visualMetadata:        { rank: 1, season: seasonId, special: true },
        });
        const correlationId = uuidv4() as LoopId;
        await bus.emit(EventType.TITLE_AWARDED, correlationId, {
          credential: titleCred,
          reputationLevel: await getStoredLevel(vId),
        } as TitleAwardedPayload);
        awarded.push(titleCred);
      }

      if (entry.rank <= 3) {
        // Award "Season Champion" badge to top 3
        const alreadyHas = await hasBadge(vId, 'Season Champion');
        if (!alreadyHas) {
          const badgeCred = await issueCredential({
            validatorId:           vId,
            type:                  CredentialType.BADGE,
            name:                  'Season Champion',
            description:           `Ranked top 3 in season ${seasonId} of the Extropy Engine`,
            seasonId:              seasonId as SeasonId,
            persistsAcrossSeasons: true,
            visualMetadata:        { rank: entry.rank, season: seasonId },
          });
          const correlationId = uuidv4() as LoopId;
          await bus.emit(EventType.BADGE_EARNED, correlationId, {
            credential: badgeCred,
            triggeredBy: `season-end:top3:rank${entry.rank}`,
          } as BadgeEarnedPayload);
          awarded.push(badgeCred);
        }
      }

      if (entry.rank <= 10) {
        // Award "Top Contributor" badge to top 10
        const alreadyHas = await hasBadge(vId, 'Top Contributor');
        if (!alreadyHas) {
          const badgeCred = await issueCredential({
            validatorId:           vId,
            type:                  CredentialType.BADGE,
            name:                  'Top Contributor',
            description:           `Ranked top 10 in season ${seasonId} of the Extropy Engine`,
            seasonId:              seasonId as SeasonId,
            persistsAcrossSeasons: false,
            visualMetadata:        { rank: entry.rank, season: seasonId },
          });
          const correlationId = uuidv4() as LoopId;
          await bus.emit(EventType.BADGE_EARNED, correlationId, {
            credential: badgeCred,
            triggeredBy: `season-end:top10:rank${entry.rank}`,
          } as BadgeEarnedPayload);
          awarded.push(badgeCred);
        }
      }
    }

    console.log(`[credentials] Season ${seasonId} final titles: awarded ${awarded.length} credentials`);
    res.json({ seasonId, awardedCount: awarded.length, awarded });
  } catch (err: any) {
    console.error('[credentials] POST /seasons/:seasonId/award-final-titles error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Leaderboard
// ─────────────────────────────────────────────────────────────────────────────────

/** GET /leaderboard — Comprehensive leaderboard */
app.get('/leaderboard', async (req, res) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit  as string || '50', 10), 200);
    const seasonId = req.query.season as string | undefined;
    const domain   = req.query.domain as string | undefined;

    // Build leaderboard from validator_levels joined with credentials
    let levelQuery = `
      SELECT
        vl.validator_id,
        vl.current_level,
        vl.updated_at,
        ARRAY_AGG(DISTINCT c.id) FILTER (WHERE c.type = 'badge' AND c.revoked_at IS NULL) AS badge_ids,
        (SELECT name FROM credentials.credentials cc
         WHERE cc.validator_id = vl.validator_id AND cc.type = 'title' AND cc.revoked_at IS NULL
         ORDER BY cc.issued_at DESC LIMIT 1) AS current_title,
        ARRAY_AGG(DISTINCT c2.domain) FILTER (WHERE c2.domain IS NOT NULL AND c2.revoked_at IS NULL) AS domains
      FROM credentials.validator_levels vl
      LEFT JOIN credentials.credentials c  ON c.validator_id  = vl.validator_id
      LEFT JOIN credentials.credentials c2 ON c2.validator_id = vl.validator_id
    `;

    const params: any[] = [];
    const conditions: string[] = [];
    let idx = 0;

    if (seasonId) {
      idx++; conditions.push(`c.season_id = $${idx}`);  params.push(seasonId);
    }
    if (domain) {
      idx++; conditions.push(`c2.domain = $${idx}`); params.push(domain);
    }
    if (conditions.length > 0) {
      levelQuery += ' WHERE ' + conditions.join(' AND ');
    }

    levelQuery += `
      GROUP BY vl.validator_id, vl.current_level, vl.updated_at
      ORDER BY vl.current_level DESC, vl.updated_at ASC
    `;
    idx++;
    levelQuery += ` LIMIT $${idx}`;
    params.push(limit);

    const result = await pool.query(levelQuery, params);

    const entries: LeaderboardEntry[] = result.rows.map((row: any, i: number) => ({
      validatorId:     row.validator_id   as ValidatorId,
      validatorName:   row.validator_id,  // Name resolution would require joining validators table
      rank:            i + 1,
      reputationLevel: row.current_level,
      title:           row.current_title  || REPUTATION_LEVEL_THRESHOLDS[row.current_level]?.title || 'Novice',
      totalXP:         0,                 // Would be enriched from reputation service
      seasonXP:        0,
      badges:          (row.badge_ids || []).filter(Boolean) as CredentialId[],
      domains:         (row.domains   || []).filter(Boolean) as EntropyDomain[],
    }));

    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

/** GET /leaderboard/domain/:domain — Domain-specific leaderboard */
app.get('/leaderboard/domain/:domain', async (req, res) => {
  try {
    const { domain }    = req.params;
    const limit         = Math.min(parseInt(req.query.limit as string || '50', 10), 200);

    const result = await pool.query(
      `SELECT
         vl.validator_id,
         vl.current_level,
         COUNT(DISTINCT c.id) FILTER (WHERE c.type = 'badge' AND c.revoked_at IS NULL) AS badge_count,
         (SELECT name FROM credentials.credentials cc
          WHERE cc.validator_id = vl.validator_id AND cc.type = 'title' AND cc.revoked_at IS NULL
          ORDER BY cc.issued_at DESC LIMIT 1) AS current_title
       FROM credentials.validator_levels vl
       JOIN credentials.credentials c ON c.validator_id = vl.validator_id AND c.domain = $1
       GROUP BY vl.validator_id, vl.current_level
       ORDER BY vl.current_level DESC
       LIMIT $2`,
      [domain, limit],
    );

    const entries: LeaderboardEntry[] = result.rows.map((row: any, i: number) => ({
      validatorId:     row.validator_id  as ValidatorId,
      validatorName:   row.validator_id,
      rank:            i + 1,
      reputationLevel: row.current_level,
      title:           row.current_title || REPUTATION_LEVEL_THRESHOLDS[row.current_level]?.title || 'Novice',
      totalXP:         0,
      seasonXP:        0,
      badges:          [] as CredentialId[],
      domains:         [domain] as EntropyDomain[],
    }));

    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Profile
// ─────────────────────────────────────────────────────────────────────────────────

/** GET /profile/:validatorId — Full cosmetic profile */
app.get('/profile/:validatorId', async (req, res) => {
  try {
    const validatorId = req.params.validatorId as ValidatorId;

    // Fetch all active credentials grouped by type
    const credResult = await pool.query(
      `SELECT * FROM credentials.credentials
       WHERE validator_id = $1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY issued_at DESC`,
      [validatorId],
    );

    const allCredentials = credResult.rows.map(credentialFromRow);
    const byType = (type: CredentialType) => allCredentials.filter(c => c.type === type);

    // Current level & title
    const storedLevel   = await getStoredLevel(validatorId);
    const levelInfo     = REPUTATION_LEVEL_THRESHOLDS[storedLevel] || REPUTATION_LEVEL_THRESHOLDS[1];
    const latestTitle   = byType(CredentialType.TITLE)[0]?.name || levelInfo.title;

    // Fetch token balances from economy service
    let tokenBalances: Record<string, number> = {};
    try {
      const walletRes = await fetch(`${ECONOMY_URL}/wallets/validator/${validatorId}`);
      if (walletRes.ok) {
        const wallet = await walletRes.json() as any;
        tokenBalances = wallet.balances || {};
      }
    } catch {
      // Proceed without balances
    }

    // Fetch reputation/XP from reputation service
    let aggregateXP   = 0;
    let domainScores: Record<string, number> = {};
    try {
      const repRes = await fetch(`${REPUTATION_URL}/validators/${validatorId}`);
      if (repRes.ok) {
        const validator = await repRes.json() as any;
        aggregateXP  = validator.aggregate_reputation ?? validator.reputation?.aggregate ?? 0;
        domainScores = validator.reputation?.byDomain || {};
      }
    } catch {
      // Proceed without reputation data
    }

    const profile = {
      validatorId,
      level:           storedLevel || 1,
      title:           latestTitle,
      aggregateXP,
      domainScores,
      tokenBalances,
      badges:          byType(CredentialType.BADGE),
      titles:          byType(CredentialType.TITLE),
      levels:          byType(CredentialType.LEVEL),
      achievements:    byType(CredentialType.ACHIEVEMENT),
      certifications:  byType(CredentialType.CERTIFICATION),
      totalCredentials: allCredentials.length,
      progress: {
        currentLevel:  storedLevel || 1,
        nextLevel:     storedLevel < 10 ? storedLevel + 1 : null,
        percentage:    levelProgress(storedLevel || 1, aggregateXP),
        xpToNextLevel: xpToNextLevel(storedLevel || 1, aggregateXP),
      },
    };

    res.json(profile);
  } catch (err: any) {
    console.error('[credentials] GET /profile error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Inbound Event Webhook
// ─────────────────────────────────────────────────────────────────────────────────

app.post('/events', async (req, res) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[credentials] Received event: ${event.type}`);
    await handleEvent(event);
    res.status(202).send();
  } catch (err: any) {
    console.error('[credentials] Event handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Event Handler
// ─────────────────────────────────────────────────────────────────────────────────

async function handleEvent(event: DomainEvent): Promise<void> {
  switch (event.type) {

    // ── REPUTATION_ACCRUED: trigger level check ─────────────────────────────────────
    case EventType.REPUTATION_ACCRUED: {
      const payload      = event.payload as ReputationAccruedPayload;
      const { validatorId, newAggregate } = payload;

      const newLevel      = computeLevel(newAggregate);
      const previousLevel = await getStoredLevel(validatorId);

      if (newLevel > previousLevel) {
        // Issue level + title credentials, emit LEVEL_UP
        const seasonId = 'season-1' as SeasonId; // Best effort — season context not in payload

        const levelCredential = await issueCredential({
          validatorId,
          type:                  CredentialType.LEVEL,
          name:                  `Level ${newLevel}`,
          description:           `Reached reputation level ${newLevel}: ${REPUTATION_LEVEL_THRESHOLDS[newLevel].title}`,
          level:                 newLevel,
          seasonId,
          persistsAcrossSeasons: true,
          visualMetadata:        { level: newLevel, color: getLevelColor(newLevel) },
          correlationId:         event.correlationId,
        });

        await issueCredential({
          validatorId,
          type:                  CredentialType.TITLE,
          name:                  REPUTATION_LEVEL_THRESHOLDS[newLevel].title,
          description:           `Earned the title "${REPUTATION_LEVEL_THRESHOLDS[newLevel].title}" at level ${newLevel}`,
          level:                 newLevel,
          seasonId,
          persistsAcrossSeasons: true,
          visualMetadata:        { title: REPUTATION_LEVEL_THRESHOLDS[newLevel].title },
          correlationId:         event.correlationId,
        });

        await setStoredLevel(validatorId, newLevel);

        await bus.emit(
          EventType.LEVEL_UP,
          event.correlationId,
          {
            validatorId,
            previousLevel,
            newLevel,
            title:        REPUTATION_LEVEL_THRESHOLDS[newLevel].title,
            credentialId: levelCredential.id,
          } as LevelUpPayload,
        );

        console.log(`[credentials] LEVEL UP (event): validator=${validatorId} ${previousLevel} → ${newLevel}`);
      } else if (previousLevel === 0 && newLevel >= 1) {
        await setStoredLevel(validatorId, newLevel);
      }
      break;
    }

    // ── LOOP_CLOSED: check milestone badges ────────────────────────────────────
    case EventType.LOOP_CLOSED: {
      const payload = event.payload as LoopClosedPayload;
      const { loop } = payload;

      // Award milestone badges for each validator in the loop
      for (const validatorId of loop.validatorIds) {
        try {
          // Fire-and-forget to badge check — get stats from reputation
          let loopsParticipated = 0;
          let currentStreak     = 0;
          let seasonId          = 'season-1' as SeasonId;

          try {
            const repRes = await fetch(`${REPUTATION_URL}/validators/${validatorId}`);
            if (repRes.ok) {
              const rep       = await repRes.json() as any;
              loopsParticipated = rep.loops_participated ?? rep.loopsParticipated ?? 0;
              currentStreak    = rep.current_streak ?? rep.reputation?.currentStreak ?? 0;
              seasonId         = rep.current_season_id || seasonId;
            }
          } catch { /* proceed */ }

          const milestoneChecks: Array<{ name: string; description: string; condition: boolean }> = [
            { name: 'First Loop',    description: 'Participated in your first verification loop', condition: loopsParticipated >= 1 },
            { name: 'Streak Master', description: 'Achieved 10 consecutive successful validations', condition: currentStreak >= 10 },
            { name: 'Century Club',  description: 'Participated in 100 verification loops',        condition: loopsParticipated >= 100 },
            { name: 'Thousand Club', description: 'Participated in 1000 verification loops',       condition: loopsParticipated >= 1000 },
          ];

          for (const m of milestoneChecks) {
            if (!m.condition) continue;
            if (await hasBadge(validatorId as ValidatorId, m.name)) continue;

            const cred = await issueCredential({
              validatorId:           validatorId as ValidatorId,
              type:                  CredentialType.BADGE,
              name:                  m.name,
              description:           m.description,
              seasonId,
              persistsAcrossSeasons: m.name === 'First Loop' || m.name === 'Pioneer',
              visualMetadata:        { automated: true, milestone: m.name },
              correlationId:         event.correlationId,
            });

            await bus.emit(
              EventType.BADGE_EARNED,
              event.correlationId,
              { credential: cred, triggeredBy: `loop-closed:${m.name}` } as BadgeEarnedPayload,
            );
          }
        } catch (err) {
          console.error(`[credentials] Badge check error for validator ${validatorId}:`, err);
        }
      }
      break;
    }

    // ── CAT_CERTIFIED: award "Domain Expert" badge if level 3+ ─────────────────
    case EventType.CAT_CERTIFIED: {
      const payload = event.payload as CATCertifiedPayload;
      const { validatorId, domain, level, credentialId } = payload;

      if (level >= 3) {
        const alreadyHas = await hasBadge(validatorId, 'Domain Expert');
        if (!alreadyHas) {
          let seasonId = 'season-1' as SeasonId;
          try {
            const repRes = await fetch(`${REPUTATION_URL}/validators/${validatorId}`);
            if (repRes.ok) {
              const rep = await repRes.json() as any;
              seasonId  = rep.current_season_id || seasonId;
            }
          } catch { /* proceed */ }

          const badge = await issueCredential({
            validatorId,
            type:                  CredentialType.BADGE,
            name:                  'Domain Expert',
            description:           `Achieved CAT level ${level} certification in the ${domain} domain`,
            domain,
            seasonId,
            persistsAcrossSeasons: false,
            visualMetadata:        { domain, catLevel: level, catCredentialId: credentialId },
            correlationId:         event.correlationId,
          });

          await bus.emit(
            EventType.BADGE_EARNED,
            event.correlationId,
            { credential: badge, triggeredBy: `cat-certified:level${level}:${domain}` } as BadgeEarnedPayload,
          );
        }
      }
      break;
    }

    // ── SEASON_ENDED: cosmetic reset + final title awards ────────────────────
    case EventType.SEASON_ENDED: {
      const payload = event.payload as SeasonEndedPayload;
      const { season, finalRankings } = payload;

      console.log(`[credentials] Season ${season.id} ended — running cosmetic reset and awarding final titles`);

      // Cosmetic reset
      const resetResult = await pool.query(
        `UPDATE credentials.credentials
         SET revoked_at = NOW()
         WHERE season_id = $1
           AND persists_across_seasons = false
           AND revoked_at IS NULL
         RETURNING *`,
        [season.id],
      );
      console.log(`[credentials] Season ${season.id} reset: revoked ${resetResult.rows.length} cosmetics`);

      // Award final titles from season rankings
      if (finalRankings && finalRankings.length > 0) {
        for (const ranking of finalRankings.slice(0, 10)) {
          const vId = ranking.validatorId;

          if (ranking.rank === 1) {
            const titleCred = await issueCredential({
              validatorId:           vId,
              type:                  CredentialType.TITLE,
              name:                  'Ecosystem Pioneer',
              description:           `Season ${season.id} champion — ranked #1 with ${ranking.totalXP} XP`,
              seasonId:              season.id,
              persistsAcrossSeasons: true,
              visualMetadata:        { rank: 1, season: season.id, totalXP: ranking.totalXP },
              correlationId:         event.correlationId,
            });
            await bus.emit(EventType.TITLE_AWARDED, event.correlationId, {
              credential:      titleCred,
              reputationLevel: await getStoredLevel(vId),
            } as TitleAwardedPayload);
          }

          if (ranking.rank <= 3) {
            if (!(await hasBadge(vId, 'Season Champion'))) {
              const badge = await issueCredential({
                validatorId:           vId,
                type:                  CredentialType.BADGE,
                name:                  'Season Champion',
                description:           `Ranked top 3 in season ${season.id}`,
                seasonId:              season.id,
                persistsAcrossSeasons: true,
                visualMetadata:        { rank: ranking.rank, season: season.id },
                correlationId:         event.correlationId,
              });
              await bus.emit(EventType.BADGE_EARNED, event.correlationId, {
                credential: badge, triggeredBy: `season-ended:top3`,
              } as BadgeEarnedPayload);
            }
          }

          if (ranking.rank <= 10) {
            if (!(await hasBadge(vId, 'Top Contributor'))) {
              const badge = await issueCredential({
                validatorId:           vId,
                type:                  CredentialType.BADGE,
                name:                  'Top Contributor',
                description:           `Ranked top 10 in season ${season.id}`,
                seasonId:              season.id,
                persistsAcrossSeasons: false,
                visualMetadata:        { rank: ranking.rank, season: season.id },
                correlationId:         event.correlationId,
              });
              await bus.emit(EventType.BADGE_EARNED, event.correlationId, {
                credential: badge, triggeredBy: `season-ended:top10`,
              } as BadgeEarnedPayload);
            }
          }
        }
      }
      break;
    }

    // ── GOVERNANCE_VOTE_CAST: award "Governance Participant" on first vote ──────────
    case EventType.GOVERNANCE_VOTE_CAST: {
      const payload    = event.payload as GovernanceVoteCastPayload;
      const validatorId = payload.vote.voterId;

      const alreadyHas = await hasBadge(validatorId, 'Governance Participant');
      if (!alreadyHas) {
        let seasonId = 'season-1' as SeasonId;
        try {
          const repRes = await fetch(`${REPUTATION_URL}/validators/${validatorId}`);
          if (repRes.ok) {
            const rep = await repRes.json() as any;
            seasonId  = rep.current_season_id || seasonId;
          }
        } catch { /* proceed */ }

        const badge = await issueCredential({
          validatorId,
          type:                  CredentialType.BADGE,
          name:                  'Governance Participant',
          description:           'Cast your first governance vote in the Extropy Engine',
          seasonId,
          persistsAcrossSeasons: true,
          visualMetadata:        { proposalId: payload.vote.proposalId, dfaoId: payload.vote.dfaoId },
          correlationId:         event.correlationId,
        });

        await bus.emit(
          EventType.BADGE_EARNED,
          event.correlationId,
          { credential: badge, triggeredBy: 'governance-vote-cast:first' } as BadgeEarnedPayload,
        );
      }
      break;
    }

    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
//  Visual Metadata Helper
// ─────────────────────────────────────────────────────────────────────────────────

function getLevelColor(level: number): string {
  const colors: Record<number, string> = {
    1:  '#9ca3af', // gray
    2:  '#6b7280', // dark gray
    3:  '#10b981', // green
    4:  '#06b6d4', // cyan
    5:  '#3b82f6', // blue
    6:  '#8b5cf6', // violet
    7:  '#d97706', // amber
    8:  '#f59e0b', // yellow
    9:  '#ef4444', // red
    10: '#f97316', // orange-gold (Ecosystem Pioneer)
  };
  return colors[level] || '#9ca3af';
}

// ─────────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────────

async function ensureSchema(): Promise<void> {
  // Create schema + tables if they don't already exist
  await pool.query(`CREATE SCHEMA IF NOT EXISTS credentials`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credentials.credentials (
      id                      TEXT        PRIMARY KEY,
      validator_id            TEXT        NOT NULL,
      type                    TEXT        NOT NULL,
      name                    TEXT        NOT NULL,
      description             TEXT        NOT NULL,
      level                   INTEGER,
      domain                  TEXT,
      season_id               TEXT        NOT NULL,
      persists_across_seasons BOOLEAN     NOT NULL DEFAULT false,
      vertex_id               TEXT        NOT NULL,
      visual_metadata         JSONB       NOT NULL DEFAULT '{}',
      issued_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at              TIMESTAMPTZ,
      revoked_at              TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_credentials_validator_id ON credentials.credentials (validator_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_credentials_type ON credentials.credentials (type)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_credentials_season_id ON credentials.credentials (season_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS credentials.validator_levels (
      validator_id  TEXT        PRIMARY KEY,
      current_level INTEGER     NOT NULL DEFAULT 1,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log('[credentials] Schema ready');
}

async function main() {
  await waitForPostgres(pool);
  await waitForRedis(redis);
  await ensureSchema();
  await bus.start();

  // Subscribe to events via Redis pub/sub
  bus.on(EventType.REPUTATION_ACCRUED,   async (event) => { await handleEvent(event as DomainEvent); });
  bus.on(EventType.LOOP_CLOSED,          async (event) => { await handleEvent(event as DomainEvent); });
  bus.on(EventType.CAT_CERTIFIED,        async (event) => { await handleEvent(event as DomainEvent); });
  bus.on(EventType.SEASON_ENDED,         async (event) => { await handleEvent(event as DomainEvent); });
  bus.on(EventType.GOVERNANCE_VOTE_CAST, async (event) => { await handleEvent(event as DomainEvent); });

  app.listen(PORT, () => {
    console.log(`[credentials] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[credentials] Fatal startup error:', err);
  process.exit(1);
});

export default app;
