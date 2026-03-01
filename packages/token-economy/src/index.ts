/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Token Economy Service — Multi-Token Economy Layer
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Manages the six-token economy:
 *    XP  — Per-action entropy reduction score (non-transferable, per-action)
 *    CT  — Contribution Token (cross-platform, 2-week lockup on mint)
 *    CAT — Capability Token (skill certification, log-scale threshold levels)
 *    IT  — Influence Token (governance weight, non-transferable)
 *    DT  — Domain Token (subject-matter expertise)
 *    EP  — Emergence Points (merchant loyalty, derived from XP × L)
 *
 *  Port: 4012
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  EventBus,
  createPool,
  createRedis,
  waitForPostgres,
  waitForRedis,
  EventType,
  ServiceName,
  TokenType,
  TokenStatus,
  CAT_LEVEL_THRESHOLDS,
} from '@extropy/contracts';
import type {
  LoopId,
  ValidatorId,
  WalletId,
  TokenId,
  SeasonId,
  DFAOId,
  VertexId,
  EntropyDomain,
  Wallet,
  TokenBalance,
  TokenTransaction,
  CTFormulaInputs,
  EPConversionInputs,
  DomainEvent,
  ServiceHealthResponse,
  XPMintedProvisionalPayload,
  LoopClosedPayload,
} from '@extropy/contracts';

// ─────────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

const PORT    = process.env.PORT    || 4012;
const SERVICE = ServiceName.TOKEN_ECONOMY;

const pool  = createPool();
const redis = createRedis();
const bus   = new EventBus(redis, pool, SERVICE);

// ─────────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────────

const CT_LOCKUP_HOURS      = 336; // 2 weeks = 14 × 24
const CT_INACTIVITY_DAYS   = 365;
const CAT_RECERT_DAYS      = 180;
const SENTINEL_VERTEX_ID   = '00000000-0000-0000-0000-000000000000' as VertexId;
const SENTINEL_SEASON_ID   = '00000000-0000-0000-0000-000000000000' as SeasonId;

// Non-transferable token types
const NON_TRANSFERABLE_TYPES = new Set<TokenType>([TokenType.XP, TokenType.IT]);

// ─────────────────────────────────────────────────────────────────────────────────
//  Row → Domain-object mappers
// ─────────────────────────────────────────────────────────────────────────────────

function walletFromRow(row: any): Wallet {
  return {
    id:               row.id as WalletId,
    validatorId:      row.validator_id as ValidatorId,
    balances:         row.balances         || defaultBalances(),
    lockedBalances:   row.locked_balances  || defaultBalances(),
    nonTransferable:  row.non_transferable || defaultNonTransferable(),
    lastActivityAt:   row.last_activity_at?.toISOString() ?? new Date().toISOString(),
    createdAt:        row.created_at?.toISOString()       ?? new Date().toISOString(),
  };
}

function balanceFromRow(row: any): TokenBalance {
  return {
    id:              row.id as TokenId,
    walletId:        row.wallet_id as WalletId,
    validatorId:     row.validator_id as ValidatorId,
    tokenType:       row.token_type as TokenType,
    amount:          Number(row.amount),
    status:          row.status as TokenStatus,
    lockupExpiresAt: row.lockup_expires_at ? row.lockup_expires_at.toISOString() : null,
    lastActivityAt:  row.last_activity_at?.toISOString() ?? new Date().toISOString(),
    domain:          row.domain as EntropyDomain | null ?? null,
    dfaoId:          row.dfao_id as DFAOId | null ?? null,
    seasonId:        row.season_id as SeasonId | null ?? null,
    lastVertexId:    (row.last_vertex_id ?? SENTINEL_VERTEX_ID) as VertexId,
    createdAt:       row.created_at?.toISOString()   ?? new Date().toISOString(),
    updatedAt:       row.updated_at?.toISOString()   ?? new Date().toISOString(),
  };
}

function txFromRow(row: any): TokenTransaction {
  return {
    id:                row.id,
    tokenType:         row.token_type as TokenType,
    action:            row.action,
    amount:            Number(row.amount),
    fromWalletId:      row.from_wallet_id as WalletId | null ?? null,
    toWalletId:        row.to_wallet_id   as WalletId | null ?? null,
    relatedEntityId:   row.related_entity_id   ?? null,
    relatedEntityType: row.related_entity_type ?? null,
    reason:            row.reason,
    vertexId:          (row.vertex_id ?? SENTINEL_VERTEX_ID) as VertexId,
    seasonId:          (row.season_id ?? SENTINEL_SEASON_ID) as SeasonId,
    timestamp:         row.timestamp?.toISOString() ?? new Date().toISOString(),
  };
}

function defaultBalances(): Record<TokenType, number> {
  return {
    [TokenType.XP]:  0,
    [TokenType.CT]:  0,
    [TokenType.CAT]: 0,
    [TokenType.IT]:  0,
    [TokenType.DT]:  0,
    [TokenType.EP]:  0,
  };
}

function defaultNonTransferable(): Record<TokenType, boolean> {
  return {
    [TokenType.XP]:  true,
    [TokenType.CT]:  false,
    [TokenType.CAT]: false,
    [TokenType.IT]:  true,
    [TokenType.DT]:  false,
    [TokenType.EP]:  false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────────

/** Return the next CAT threshold for a given level (1-indexed). */
function nextCATThreshold(level: number): number {
  return CAT_LEVEL_THRESHOLDS[level] ?? CAT_LEVEL_THRESHOLDS[CAT_LEVEL_THRESHOLDS.length - 1];
}

/** Standard JSON error response. */
function errBody(message: string, code: string, details?: Record<string, unknown>) {
  return { error: message, code, details, timestamp: new Date().toISOString() };
}

/**
 * Ensure a wallet row exists for the given validator.
 * Returns the wallet row's id.
 */
async function ensureWallet(validatorId: ValidatorId): Promise<WalletId> {
  const existing = await pool.query(
    'SELECT id FROM economy.wallets WHERE validator_id = $1',
    [validatorId],
  );
  if (existing.rows.length > 0) return existing.rows[0].id as WalletId;

  const walletId = uuidv4() as WalletId;
  await pool.query(
    `INSERT INTO economy.wallets
       (id, validator_id, balances, locked_balances, non_transferable, last_activity_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (validator_id) DO NOTHING`,
    [
      walletId,
      validatorId,
      JSON.stringify(defaultBalances()),
      JSON.stringify(defaultBalances()),
      JSON.stringify(defaultNonTransferable()),
    ],
  );
  // Re-fetch in case ON CONFLICT triggered
  const res = await pool.query(
    'SELECT id FROM economy.wallets WHERE validator_id = $1',
    [validatorId],
  );
  return res.rows[0].id as WalletId;
}

/**
 * Record a TokenTransaction and return it.
 */
async function recordTransaction(params: {
  tokenType:         TokenType;
  action:            TokenTransaction['action'];
  amount:            number;
  fromWalletId?:     WalletId | null;
  toWalletId?:       WalletId | null;
  relatedEntityId?:  string | null;
  relatedEntityType?: string | null;
  reason:            string;
  seasonId?:         SeasonId;
}): Promise<TokenTransaction> {
  const txId = uuidv4();
  const res = await pool.query(
    `INSERT INTO economy.token_transactions
       (id, token_type, action, amount, from_wallet_id, to_wallet_id,
        related_entity_id, related_entity_type, reason, vertex_id, season_id, timestamp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     RETURNING *`,
    [
      txId,
      params.tokenType,
      params.action,
      params.amount,
      params.fromWalletId   ?? null,
      params.toWalletId     ?? null,
      params.relatedEntityId   ?? null,
      params.relatedEntityType ?? null,
      params.reason,
      SENTINEL_VERTEX_ID,
      params.seasonId ?? SENTINEL_SEASON_ID,
    ],
  );
  return txFromRow(res.rows[0]);
}

/**
 * Core mint logic: add `amount` to a wallet's active balance for `tokenType`.
 * Handles CT locked-mint separately via `locked` flag.
 */
async function mintTokens(params: {
  validatorId:       ValidatorId;
  tokenType:         TokenType;
  amount:            number;
  reason:            string;
  locked?:           boolean;
  lockupExpiresAt?:  Date;
  relatedEntityId?:  string | null;
  relatedEntityType?: string | null;
  dfaoId?:           DFAOId;
  seasonId?:         SeasonId;
}): Promise<{ wallet: Wallet; balance: TokenBalance; tx: TokenTransaction }> {
  const walletId = await ensureWallet(params.validatorId);

  const status       = params.locked ? TokenStatus.LOCKED : TokenStatus.ACTIVE;
  const balanceField = params.locked ? 'locked_balances' : 'balances';
  const lockupAt     = params.lockupExpiresAt ?? null;

  // Upsert balance record in economy.token_balances
  const balRes = await pool.query(
    `INSERT INTO economy.token_balances
       (id, wallet_id, validator_id, token_type, amount, status,
        lockup_expires_at, last_activity_at, domain, dfao_id, season_id,
        last_vertex_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9,$10,$11,NOW(),NOW())
     ON CONFLICT (wallet_id, token_type, status)
     DO UPDATE SET
       amount           = economy.token_balances.amount + EXCLUDED.amount,
       last_activity_at = NOW(),
       updated_at       = NOW()
     RETURNING *`,
    [
      uuidv4(),
      walletId,
      params.validatorId,
      params.tokenType,
      params.amount,
      status,
      lockupAt,
      null,                         // domain — not set at wallet level
      params.dfaoId  ?? null,
      params.seasonId ?? null,
      SENTINEL_VERTEX_ID,
    ],
  );
  const balance = balanceFromRow(balRes.rows[0]);

  // Update wallet aggregate balances
  await pool.query(
    `UPDATE economy.wallets
     SET ${balanceField} = jsonb_set(
           ${balanceField},
           ARRAY[$1],
           to_jsonb(COALESCE((${balanceField}->>$1)::numeric, 0) + $2)
         ),
         last_activity_at = NOW()
     WHERE id = $3`,
    [params.tokenType, params.amount, walletId],
  );

  const tx = await recordTransaction({
    tokenType:         params.tokenType,
    action:            'mint',
    amount:            params.amount,
    toWalletId:        walletId,
    relatedEntityId:   params.relatedEntityId  ?? null,
    relatedEntityType: params.relatedEntityType ?? null,
    reason:            params.reason,
    seasonId:          params.seasonId,
  });

  const walletRes = await pool.query(
    'SELECT * FROM economy.wallets WHERE id = $1',
    [walletId],
  );
  const wallet = walletFromRow(walletRes.rows[0]);

  // Emit TOKEN_MINTED
  await bus.emit(
    EventType.TOKEN_MINTED,
    uuidv4() as LoopId,
    { transaction: tx, newBalance: balance.amount },
  );

  // Emit TOKEN_LOCKED if this mint was into a locked state
  if (params.locked && lockupAt) {
    await bus.emit(
      EventType.TOKEN_LOCKED,
      uuidv4() as LoopId,
      {
        walletId,
        tokenType: params.tokenType,
        amount:    params.amount,
        lockupExpiresAt: lockupAt.toISOString(),
      },
    );
  }

  return { wallet, balance, tx };
}

/**
 * Core burn logic: deduct `amount` from active balance.
 */
async function burnTokens(params: {
  validatorId: ValidatorId;
  tokenType:   TokenType;
  amount:      number;
  reason:      string;
  seasonId?:   SeasonId;
}): Promise<{ wallet: Wallet; tx: TokenTransaction }> {
  const walletRes = await pool.query(
    'SELECT * FROM economy.wallets WHERE validator_id = $1',
    [params.validatorId],
  );
  if (walletRes.rows.length === 0) {
    throw new Error(`Wallet not found for validator ${params.validatorId}`);
  }
  const wallet      = walletFromRow(walletRes.rows[0]);
  const walletId    = wallet.id;
  const activeBalance = wallet.balances[params.tokenType] ?? 0;

  if (activeBalance < params.amount) {
    throw new Error(
      `Insufficient balance: have ${activeBalance} active ${params.tokenType}, need ${params.amount}`,
    );
  }

  // Deduct from wallet aggregate
  await pool.query(
    `UPDATE economy.wallets
     SET balances = jsonb_set(
           balances,
           ARRAY[$1],
           to_jsonb(COALESCE((balances->>$1)::numeric, 0) - $2)
         ),
         last_activity_at = NOW()
     WHERE id = $3`,
    [params.tokenType, params.amount, walletId],
  );

  // Deduct from balance record
  await pool.query(
    `UPDATE economy.token_balances
     SET amount = amount - $1, updated_at = NOW()
     WHERE wallet_id = $2 AND token_type = $3 AND status = 'active'`,
    [params.amount, walletId, params.tokenType],
  );

  const tx = await recordTransaction({
    tokenType:   params.tokenType,
    action:      'burn',
    amount:      params.amount,
    fromWalletId: walletId,
    reason:       params.reason,
    seasonId:     params.seasonId,
  });

  const updatedRes = await pool.query(
    'SELECT * FROM economy.wallets WHERE id = $1',
    [walletId],
  );
  const updatedWallet = walletFromRow(updatedRes.rows[0]);

  await bus.emit(
    EventType.TOKEN_BURNED,
    uuidv4() as LoopId,
    { transaction: tx, previousBalance: activeBalance },
  );

  return { wallet: updatedWallet, tx };
}

// ─────────────────────────────────────────────────────────────────────────────────
//  CAT helpers
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * Ensure a cat_certification row exists for validatorId+domain.
 * Returns the current row.
 */
async function ensureCATCert(
  validatorId: ValidatorId,
  domain: EntropyDomain,
): Promise<any> {
  const existing = await pool.query(
    'SELECT * FROM economy.cat_certifications WHERE validator_id = $1 AND domain = $2',
    [validatorId, domain],
  );
  if (existing.rows.length > 0) return existing.rows[0];

  await pool.query(
    `INSERT INTO economy.cat_certifications
       (id, validator_id, domain, level, validated_performances, next_level_threshold,
        last_certified_at, recertification_due, mentorship_bonuses)
     VALUES ($1,$2,$3,0,0,$4,NOW(),false,0)
     ON CONFLICT (validator_id, domain) DO NOTHING`,
    [uuidv4(), validatorId, domain, nextCATThreshold(0)],
  );
  const res = await pool.query(
    'SELECT * FROM economy.cat_certifications WHERE validator_id = $1 AND domain = $2',
    [validatorId, domain],
  );
  return res.rows[0];
}

/**
 * Run certification check. If threshold met, increment level and mint 1 CAT.
 */
async function runCATCertify(
  validatorId: ValidatorId,
  domain: EntropyDomain,
): Promise<{ certified: boolean; level: number; validatedPerformances: number }> {
  const cert = await ensureCATCert(validatorId, domain);
  const performances = Number(cert.validated_performances);
  const threshold    = Number(cert.next_level_threshold);
  const currentLevel = Number(cert.level);

  if (performances < threshold) {
    return { certified: false, level: currentLevel, validatedPerformances: performances };
  }

  const newLevel    = currentLevel + 1;
  const newThreshold = nextCATThreshold(newLevel);

  await pool.query(
    `UPDATE economy.cat_certifications
     SET level = $1, next_level_threshold = $2, last_certified_at = NOW(), recertification_due = false
     WHERE validator_id = $3 AND domain = $4`,
    [newLevel, newThreshold, validatorId, domain],
  );

  // Mint 1 CAT
  await mintTokens({
    validatorId,
    tokenType: TokenType.CAT,
    amount:    1,
    reason:    `CAT certification — domain=${domain}, level=${newLevel}`,
  });

  // Emit CAT_CERTIFIED
  await bus.emit(
    EventType.CAT_CERTIFIED,
    uuidv4() as LoopId,
    {
      validatorId,
      domain,
      level:                newLevel,
      validatedPerformances: performances,
      credentialId:          uuidv4() as any,
    },
  );

  console.log(`[token-economy] CAT certified: validator=${validatorId} domain=${domain} level=${newLevel}`);
  return { certified: true, level: newLevel, validatedPerformances: performances };
}

// ─────────────────────────────────────────────────────────────────────────────────
//  Health
// ─────────────────────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  const health: ServiceHealthResponse = {
    service:   SERVICE,
    status:    'healthy',
    version:   '0.1.0',
    uptime:    process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: {
      'loop-ledger': 'connected',
      'xp-mint':     'connected',
      'reputation':  'connected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Wallet Management
// ─────────────────────────────────────────────────────────────────────────────────

/** POST /wallets — Create a wallet for a validator */
app.post('/wallets', async (req: Request, res: Response) => {
  try {
    const { validatorId } = req.body;
    if (!validatorId) {
      res.status(400).json(errBody('Missing validatorId', 'VALIDATION_ERROR'));
      return;
    }

    const walletId = uuidv4() as WalletId;
    await pool.query(
      `INSERT INTO economy.wallets
         (id, validator_id, balances, locked_balances, non_transferable, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (validator_id) DO NOTHING`,
      [
        walletId,
        validatorId,
        JSON.stringify(defaultBalances()),
        JSON.stringify(defaultBalances()),
        JSON.stringify(defaultNonTransferable()),
      ],
    );

    const res2 = await pool.query(
      'SELECT * FROM economy.wallets WHERE validator_id = $1',
      [validatorId],
    );
    res.status(201).json(walletFromRow(res2.rows[0]));
  } catch (err: any) {
    console.error('[token-economy] POST /wallets:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

/** GET /wallets/:validatorId — Get wallet by validator ID */
app.get('/wallets/:validatorId', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM economy.wallets WHERE validator_id = $1',
      [req.params.validatorId],
    );
    if (result.rows.length === 0) {
      res.status(404).json(errBody('Wallet not found', 'NOT_FOUND'));
      return;
    }
    res.json(walletFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

/** GET /wallets/:validatorId/balances — Get all token balances summary */
app.get('/wallets/:validatorId/balances', async (req: Request, res: Response) => {
  try {
    const walletRes = await pool.query(
      'SELECT * FROM economy.wallets WHERE validator_id = $1',
      [req.params.validatorId],
    );
    if (walletRes.rows.length === 0) {
      res.status(404).json(errBody('Wallet not found', 'NOT_FOUND'));
      return;
    }
    const wallet = walletFromRow(walletRes.rows[0]);
    res.json({
      validatorId: req.params.validatorId,
      active: wallet.balances,
      locked: wallet.lockedBalances,
      summary: Object.values(TokenType).reduce((acc, tt) => {
        acc[tt] = {
          active: wallet.balances[tt]       ?? 0,
          locked: wallet.lockedBalances[tt] ?? 0,
          total:  (wallet.balances[tt] ?? 0) + (wallet.lockedBalances[tt] ?? 0),
        };
        return acc;
      }, {} as Record<string, { active: number; locked: number; total: number }>),
    });
  } catch (err: any) {
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Token Minting
// ─────────────────────────────────────────────────────────────────────────────────

/** POST /tokens/mint — Generic mint endpoint */
app.post('/tokens/mint', async (req: Request, res: Response) => {
  try {
    const {
      validatorId, tokenType, amount, reason,
      relatedEntityId, relatedEntityType, dfaoId, seasonId,
    } = req.body;

    if (!validatorId || !tokenType || amount == null || !reason) {
      res.status(400).json(errBody('Missing required fields: validatorId, tokenType, amount, reason', 'VALIDATION_ERROR'));
      return;
    }
    if (!Object.values(TokenType).includes(tokenType)) {
      res.status(400).json(errBody(`Unknown tokenType: ${tokenType}`, 'VALIDATION_ERROR'));
      return;
    }
    if (amount <= 0) {
      res.status(400).json(errBody('amount must be > 0', 'VALIDATION_ERROR'));
      return;
    }

    let locked          = false;
    let lockupExpiresAt: Date | undefined;

    // CT: apply 2-week lockup
    if (tokenType === TokenType.CT) {
      locked = true;
      lockupExpiresAt = new Date(Date.now() + CT_LOCKUP_HOURS * 3600 * 1000);
    }

    // CAT: validate certification threshold
    if (tokenType === TokenType.CAT) {
      // Certification route should be used; direct mint is an admin override
      console.warn(`[token-economy] Direct CAT mint for validator=${validatorId} — bypasses certification check`);
    }

    const { wallet, balance, tx } = await mintTokens({
      validatorId:       validatorId as ValidatorId,
      tokenType:         tokenType as TokenType,
      amount:            Number(amount),
      reason,
      locked,
      lockupExpiresAt,
      relatedEntityId:   relatedEntityId  ?? null,
      relatedEntityType: relatedEntityType ?? null,
      dfaoId:            dfaoId  as DFAOId   | undefined,
      seasonId:          seasonId as SeasonId | undefined,
    });

    res.status(201).json({ wallet, balance, transaction: tx });
  } catch (err: any) {
    console.error('[token-economy] POST /tokens/mint:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

/** POST /tokens/burn — Burn tokens */
app.post('/tokens/burn', async (req: Request, res: Response) => {
  try {
    const { validatorId, tokenType, amount, reason } = req.body;

    if (!validatorId || !tokenType || amount == null || !reason) {
      res.status(400).json(errBody('Missing required fields', 'VALIDATION_ERROR'));
      return;
    }
    if (amount <= 0) {
      res.status(400).json(errBody('amount must be > 0', 'VALIDATION_ERROR'));
      return;
    }

    const { wallet, tx } = await burnTokens({
      validatorId: validatorId as ValidatorId,
      tokenType:   tokenType   as TokenType,
      amount:      Number(amount),
      reason,
    });

    res.json({ wallet, transaction: tx });
  } catch (err: any) {
    console.error('[token-economy] POST /tokens/burn:', err);
    const status = err.message.startsWith('Insufficient') ? 400 : 500;
    res.status(status).json(errBody(err.message, 'INSUFFICIENT_BALANCE'));
  }
});

/** POST /tokens/lock — Lock tokens */
app.post('/tokens/lock', async (req: Request, res: Response) => {
  try {
    const { validatorId, tokenType, amount, lockupExpiresAt } = req.body;

    if (!validatorId || !tokenType || amount == null || !lockupExpiresAt) {
      res.status(400).json(errBody('Missing required fields: validatorId, tokenType, amount, lockupExpiresAt', 'VALIDATION_ERROR'));
      return;
    }

    const walletRes = await pool.query(
      'SELECT * FROM economy.wallets WHERE validator_id = $1',
      [validatorId],
    );
    if (walletRes.rows.length === 0) {
      res.status(404).json(errBody('Wallet not found', 'NOT_FOUND'));
      return;
    }
    const wallet   = walletFromRow(walletRes.rows[0]);
    const walletId = wallet.id;
    const active   = wallet.balances[tokenType as TokenType] ?? 0;

    if (active < amount) {
      res.status(400).json(errBody(`Insufficient active balance: ${active} < ${amount}`, 'INSUFFICIENT_BALANCE'));
      return;
    }

    const lockExpiry = new Date(lockupExpiresAt);

    // Move active → locked in wallet aggregates
    await pool.query(
      `UPDATE economy.wallets
       SET balances        = jsonb_set(balances,        ARRAY[$1], to_jsonb(COALESCE((balances->>$1)::numeric,0) - $2)),
           locked_balances = jsonb_set(locked_balances, ARRAY[$1], to_jsonb(COALESCE((locked_balances->>$1)::numeric,0) + $2)),
           last_activity_at = NOW()
       WHERE id = $3`,
      [tokenType, amount, walletId],
    );

    // Update / insert token_balance record
    await pool.query(
      `UPDATE economy.token_balances
       SET amount = amount - $1, updated_at = NOW()
       WHERE wallet_id = $2 AND token_type = $3 AND status = 'active'`,
      [amount, walletId, tokenType],
    );
    await pool.query(
      `INSERT INTO economy.token_balances
         (id, wallet_id, validator_id, token_type, amount, status, lockup_expires_at, last_activity_at,
          domain, dfao_id, season_id, last_vertex_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'locked',$6,NOW(),null,null,null,$7,NOW(),NOW())
       ON CONFLICT (wallet_id, token_type, status)
       DO UPDATE SET amount = economy.token_balances.amount + EXCLUDED.amount,
                     lockup_expires_at = EXCLUDED.lockup_expires_at,
                     updated_at = NOW()`,
      [uuidv4(), walletId, validatorId, tokenType, amount, lockExpiry, SENTINEL_VERTEX_ID],
    );

    await recordTransaction({
      tokenType:   tokenType as TokenType,
      action:      'lock',
      amount:      Number(amount),
      fromWalletId: walletId,
      toWalletId:   walletId,
      reason:      `Manual lock until ${lockExpiry.toISOString()}`,
    });

    await bus.emit(
      EventType.TOKEN_LOCKED,
      uuidv4() as LoopId,
      {
        walletId,
        tokenType: tokenType as TokenType,
        amount:    Number(amount),
        lockupExpiresAt: lockExpiry.toISOString(),
      },
    );

    const updated = await pool.query('SELECT * FROM economy.wallets WHERE id = $1', [walletId]);
    res.json(walletFromRow(updated.rows[0]));
  } catch (err: any) {
    console.error('[token-economy] POST /tokens/lock:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

/** POST /tokens/unlock — Unlock tokens */
app.post('/tokens/unlock', async (req: Request, res: Response) => {
  try {
    const { validatorId, tokenType, amount } = req.body;

    if (!validatorId || !tokenType || amount == null) {
      res.status(400).json(errBody('Missing required fields: validatorId, tokenType, amount', 'VALIDATION_ERROR'));
      return;
    }

    const walletRes = await pool.query(
      'SELECT * FROM economy.wallets WHERE validator_id = $1',
      [validatorId],
    );
    if (walletRes.rows.length === 0) {
      res.status(404).json(errBody('Wallet not found', 'NOT_FOUND'));
      return;
    }
    const wallet   = walletFromRow(walletRes.rows[0]);
    const walletId = wallet.id;
    const locked   = wallet.lockedBalances[tokenType as TokenType] ?? 0;

    if (locked < amount) {
      res.status(400).json(errBody(`Insufficient locked balance: ${locked} < ${amount}`, 'INSUFFICIENT_BALANCE'));
      return;
    }

    // Move locked → active in wallet aggregates
    await pool.query(
      `UPDATE economy.wallets
       SET locked_balances = jsonb_set(locked_balances, ARRAY[$1], to_jsonb(COALESCE((locked_balances->>$1)::numeric,0) - $2)),
           balances        = jsonb_set(balances,        ARRAY[$1], to_jsonb(COALESCE((balances->>$1)::numeric,0) + $2)),
           last_activity_at = NOW()
       WHERE id = $3`,
      [tokenType, amount, walletId],
    );

    await pool.query(
      `UPDATE economy.token_balances
       SET amount = amount - $1, updated_at = NOW()
       WHERE wallet_id = $2 AND token_type = $3 AND status = 'locked'`,
      [amount, walletId, tokenType],
    );
    await pool.query(
      `INSERT INTO economy.token_balances
         (id, wallet_id, validator_id, token_type, amount, status, lockup_expires_at, last_activity_at,
          domain, dfao_id, season_id, last_vertex_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'active',null,NOW(),null,null,null,$6,NOW(),NOW())
       ON CONFLICT (wallet_id, token_type, status)
       DO UPDATE SET amount = economy.token_balances.amount + EXCLUDED.amount, updated_at = NOW()`,
      [uuidv4(), walletId, validatorId, tokenType, amount, SENTINEL_VERTEX_ID],
    );

    await recordTransaction({
      tokenType:   tokenType as TokenType,
      action:      'unlock',
      amount:      Number(amount),
      fromWalletId: walletId,
      toWalletId:   walletId,
      reason:      'Token unlock',
    });

    await bus.emit(
      EventType.TOKEN_UNLOCKED,
      uuidv4() as LoopId,
      {
        walletId,
        tokenType: tokenType as TokenType,
        amount:    Number(amount),
        vertexId:  SENTINEL_VERTEX_ID,
      },
    );

    const updated = await pool.query('SELECT * FROM economy.wallets WHERE id = $1', [walletId]);
    res.json(walletFromRow(updated.rows[0]));
  } catch (err: any) {
    console.error('[token-economy] POST /tokens/unlock:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  CT-Specific Operations
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * POST /ct/mint — Mint Contribution Tokens using CT formula
 * CT = context × feedbackClosure × reputation × delta
 * (essentiality is governance-adjustable; included as multiplier)
 */
app.post('/ct/mint', async (req: Request, res: Response) => {
  try {
    const {
      validatorId,
      context, feedbackClosure, reputation, delta, essentiality,
      relatedLoopId, seasonId,
    } = req.body;

    if (!validatorId || context == null || feedbackClosure == null
        || reputation == null || delta == null || essentiality == null) {
      res.status(400).json(errBody(
        'Missing required fields: validatorId, context, feedbackClosure, reputation, delta, essentiality',
        'VALIDATION_ERROR',
      ));
      return;
    }

    const inputs: CTFormulaInputs = {
      context:        Number(context),
      feedbackClosure: Number(feedbackClosure),
      reputation:     Number(reputation),
      delta:          Number(delta),
      essentiality:   Number(essentiality),
    };

    // CT = C × F × R × Δ  (E is a governance-adjustable multiplier)
    const ctAmount = inputs.context * inputs.feedbackClosure * inputs.reputation * inputs.delta * inputs.essentiality;

    if (ctAmount <= 0) {
      res.status(400).json(errBody('CT formula produced zero or negative amount', 'INVALID_FORMULA'));
      return;
    }

    const lockupExpiresAt = new Date(Date.now() + CT_LOCKUP_HOURS * 3600 * 1000);

    const { wallet, balance, tx } = await mintTokens({
      validatorId:       validatorId as ValidatorId,
      tokenType:         TokenType.CT,
      amount:            ctAmount,
      reason:            `CT formula mint: C=${context} F=${feedbackClosure} R=${reputation} Δ=${delta} E=${essentiality}`,
      locked:            true,
      lockupExpiresAt,
      relatedEntityId:   relatedLoopId ?? null,
      relatedEntityType: relatedLoopId ? 'loop' : null,
      seasonId:          seasonId as SeasonId | undefined,
    });

    console.log(`[token-economy] CT minted: validator=${validatorId} amount=${ctAmount.toFixed(4)} locked until ${lockupExpiresAt.toISOString()}`);
    res.status(201).json({ wallet, balance, transaction: tx, ctAmount, inputs, lockupExpiresAt });
  } catch (err: any) {
    console.error('[token-economy] POST /ct/mint:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

/** POST /ct/check-lockup-expiry — Unlock expired CT lockups (cron trigger) */
app.post('/ct/check-lockup-expiry', async (_req: Request, res: Response) => {
  try {
    const expired = await pool.query(
      `SELECT tb.*, w.validator_id AS vid
       FROM economy.token_balances tb
       JOIN economy.wallets w ON w.id = tb.wallet_id
       WHERE tb.token_type = 'ct'
         AND tb.status     = 'locked'
         AND tb.lockup_expires_at <= NOW()`,
    );

    const unlocked: string[] = [];

    for (const row of expired.rows) {
      const walletId   = row.wallet_id as WalletId;
      const validatorId = row.vid as ValidatorId;
      const amount     = Number(row.amount);

      // Move locked → active
      await pool.query(
        `UPDATE economy.wallets
         SET locked_balances = jsonb_set(locked_balances, '{ct}', to_jsonb(COALESCE((locked_balances->>'ct')::numeric,0) - $1)),
             balances        = jsonb_set(balances,        '{ct}', to_jsonb(COALESCE((balances->>'ct')::numeric,0) + $1)),
             last_activity_at = NOW()
         WHERE id = $2`,
        [amount, walletId],
      );
      await pool.query(
        `UPDATE economy.token_balances SET status = 'active', lockup_expires_at = null, updated_at = NOW()
         WHERE id = $1`,
        [row.id],
      );

      await bus.emit(
        EventType.CT_LOCKUP_EXPIRED,
        uuidv4() as LoopId,
        {
          walletId,
          validatorId,
          amount,
          seasonId: (row.season_id ?? SENTINEL_SEASON_ID) as SeasonId,
        },
      );

      await bus.emit(
        EventType.TOKEN_UNLOCKED,
        uuidv4() as LoopId,
        { walletId, tokenType: TokenType.CT, amount, vertexId: SENTINEL_VERTEX_ID },
      );

      unlocked.push(validatorId);
      console.log(`[token-economy] CT lockup expired: validator=${validatorId} amount=${amount}`);
    }

    res.json({ unlockedCount: unlocked.length, validators: unlocked });
  } catch (err: any) {
    console.error('[token-economy] POST /ct/check-lockup-expiry:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

/** POST /ct/inactivity-burn — Burn CT in wallets inactive > 365 days (cron) */
app.post('/ct/inactivity-burn', async (_req: Request, res: Response) => {
  try {
    const cutoff = new Date(Date.now() - CT_INACTIVITY_DAYS * 24 * 3600 * 1000);

    const inactive = await pool.query(
      `SELECT * FROM economy.wallets
       WHERE last_activity_at < $1
         AND (balances->>'ct')::numeric > 0`,
      [cutoff],
    );

    const burned: Array<{ validatorId: string; amount: number }> = [];

    for (const row of inactive.rows) {
      const wallet      = walletFromRow(row);
      const ctAmount    = wallet.balances[TokenType.CT] ?? 0;
      const inactiveDays = Math.floor(
        (Date.now() - new Date(wallet.lastActivityAt).getTime()) / (24 * 3600 * 1000),
      );

      if (ctAmount <= 0) continue;

      await burnTokens({
        validatorId: wallet.validatorId,
        tokenType:   TokenType.CT,
        amount:      ctAmount,
        reason:      `CT inactivity burn after ${inactiveDays} days`,
      });

      await bus.emit(
        EventType.CT_INACTIVITY_BURN,
        uuidv4() as LoopId,
        {
          walletId:     wallet.id,
          validatorId:  wallet.validatorId,
          burnedAmount: ctAmount,
          inactiveDays,
          vertexId:     SENTINEL_VERTEX_ID,
        },
      );

      burned.push({ validatorId: wallet.validatorId, amount: ctAmount });
      console.log(`[token-economy] CT inactivity burn: validator=${wallet.validatorId} amount=${ctAmount} days=${inactiveDays}`);
    }

    res.json({ burnedCount: burned.length, burned });
  } catch (err: any) {
    console.error('[token-economy] POST /ct/inactivity-burn:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  CAT Operations
// ─────────────────────────────────────────────────────────────────────────────────

/** POST /cat/certify — Issue CAT certification if threshold is met */
app.post('/cat/certify', async (req: Request, res: Response) => {
  try {
    const { validatorId, domain } = req.body;
    if (!validatorId || !domain) {
      res.status(400).json(errBody('Missing required fields: validatorId, domain', 'VALIDATION_ERROR'));
      return;
    }

    const result = await runCATCertify(validatorId as ValidatorId, domain as EntropyDomain);
    const cert   = await ensureCATCert(validatorId as ValidatorId, domain as EntropyDomain);

    res.json({
      validatorId,
      domain,
      certified:            result.certified,
      level:                result.level,
      validatedPerformances: result.validatedPerformances,
      nextLevelThreshold:   Number(cert.next_level_threshold),
      recertificationDue:   cert.recertification_due,
      lastCertifiedAt:      cert.last_certified_at?.toISOString(),
    });
  } catch (err: any) {
    console.error('[token-economy] POST /cat/certify:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

/** POST /cat/record-performance — Record a validated performance */
app.post('/cat/record-performance', async (req: Request, res: Response) => {
  try {
    const { validatorId, domain } = req.body;
    if (!validatorId || !domain) {
      res.status(400).json(errBody('Missing required fields: validatorId, domain', 'VALIDATION_ERROR'));
      return;
    }

    await ensureCATCert(validatorId as ValidatorId, domain as EntropyDomain);

    await pool.query(
      `UPDATE economy.cat_certifications
       SET validated_performances = validated_performances + 1
       WHERE validator_id = $1 AND domain = $2`,
      [validatorId, domain],
    );

    // Auto-certify if threshold met
    const cert = await pool.query(
      'SELECT * FROM economy.cat_certifications WHERE validator_id = $1 AND domain = $2',
      [validatorId, domain],
    );
    const row          = cert.rows[0];
    const performances = Number(row.validated_performances);
    const threshold    = Number(row.next_level_threshold);

    let certResult = null;
    if (performances >= threshold) {
      certResult = await runCATCertify(validatorId as ValidatorId, domain as EntropyDomain);
    }

    res.json({
      validatorId,
      domain,
      validatedPerformances: performances,
      nextLevelThreshold:    threshold,
      level:                 Number(row.level),
      autoCertified:         certResult?.certified ?? false,
    });
  } catch (err: any) {
    console.error('[token-economy] POST /cat/record-performance:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

/** POST /cat/check-recertification — Mark overdue CATs (cron) */
app.post('/cat/check-recertification', async (_req: Request, res: Response) => {
  try {
    const cutoff = new Date(Date.now() - CAT_RECERT_DAYS * 24 * 3600 * 1000);

    const overdue = await pool.query(
      `UPDATE economy.cat_certifications
       SET recertification_due = true
       WHERE last_certified_at < $1 AND recertification_due = false
       RETURNING *`,
      [cutoff],
    );

    const flagged: string[] = [];
    for (const row of overdue.rows) {
      const dueBy = new Date(
        new Date(row.last_certified_at).getTime() + CAT_RECERT_DAYS * 24 * 3600 * 1000,
      );

      await bus.emit(
        EventType.CAT_RECERTIFICATION_DUE,
        uuidv4() as LoopId,
        {
          validatorId:     row.validator_id as ValidatorId,
          domain:          row.domain       as EntropyDomain,
          lastCertifiedAt: row.last_certified_at.toISOString(),
          dueBy:           dueBy.toISOString(),
        },
      );
      flagged.push(row.validator_id);
    }

    res.json({ flaggedCount: flagged.length, validators: flagged });
  } catch (err: any) {
    console.error('[token-economy] POST /cat/check-recertification:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

/** POST /cat/mentorship-bonus — Award 0.1 CAT mentorship bonus to mentor */
app.post('/cat/mentorship-bonus', async (req: Request, res: Response) => {
  try {
    const { mentorId, menteeId, domain } = req.body;
    if (!mentorId || !menteeId || !domain) {
      res.status(400).json(errBody('Missing required fields: mentorId, menteeId, domain', 'VALIDATION_ERROR'));
      return;
    }

    const bonusAmount = 0.1;

    await mintTokens({
      validatorId: mentorId as ValidatorId,
      tokenType:   TokenType.CAT,
      amount:      bonusAmount,
      reason:      `Mentorship bonus for mentoring ${menteeId} in domain ${domain}`,
    });

    // Record mentorship bonus
    await pool.query(
      `INSERT INTO economy.mentorship_bonuses (id, mentor_id, mentee_id, domain, bonus_amount, awarded_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT DO NOTHING`,
      [uuidv4(), mentorId, menteeId, domain, bonusAmount],
    );

    // Update cat_certifications mentorship_bonuses counter
    await pool.query(
      `UPDATE economy.cat_certifications
       SET mentorship_bonuses = mentorship_bonuses + 1
       WHERE validator_id = $1 AND domain = $2`,
      [mentorId, domain],
    );

    res.json({
      mentorId,
      menteeId,
      domain,
      bonusAmount,
      message: `Awarded ${bonusAmount} CAT to ${mentorId} for mentoring ${menteeId} in ${domain}`,
    });
  } catch (err: any) {
    console.error('[token-economy] POST /cat/mentorship-bonus:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  IT Operations
// ─────────────────────────────────────────────────────────────────────────────────

/** POST /it/derive — Derive IT from governance weight in a DFAO */
app.post('/it/derive', async (req: Request, res: Response) => {
  try {
    const { validatorId, dfaoId } = req.body;
    if (!validatorId || !dfaoId) {
      res.status(400).json(errBody('Missing required fields: validatorId, dfaoId', 'VALIDATION_ERROR'));
      return;
    }

    // Query governance weight from dfao_registry (gracefully fall back to 1.0)
    let governanceWeight = 1.0;
    try {
      const dfaoRegistryUrl = process.env.DFAO_REGISTRY_URL || 'http://dfao-registry:4006';
      const memberRes = await fetch(
        `${dfaoRegistryUrl}/dfaos/${dfaoId}/members/${validatorId}`,
      );
      if (memberRes.ok) {
        const member = await memberRes.json() as any;
        governanceWeight = member.governanceWeight ?? 1.0;
      }
    } catch {
      console.warn(`[token-economy] Could not fetch DFAO governance weight for ${validatorId}@${dfaoId} — using 1.0`);
    }

    if (governanceWeight <= 0) {
      res.status(400).json(errBody('Governance weight is zero — no IT to derive', 'ZERO_WEIGHT'));
      return;
    }

    const { wallet, balance, tx } = await mintTokens({
      validatorId: validatorId as ValidatorId,
      tokenType:   TokenType.IT,
      amount:      governanceWeight,
      reason:      `IT derived from governance weight in DFAO ${dfaoId}`,
      dfaoId:      dfaoId as DFAOId,
    });

    res.status(201).json({ wallet, balance, transaction: tx, governanceWeight });
  } catch (err: any) {
    console.error('[token-economy] POST /it/derive:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  EP Operations
// ─────────────────────────────────────────────────────────────────────────────────

/** POST /ep/convert — Convert XP to Emergence Points: EP = xpAmount × L */
app.post('/ep/convert', async (req: Request, res: Response) => {
  try {
    const { validatorId, xpAmount, localLoyaltyMultiplier } = req.body;

    if (!validatorId || xpAmount == null || localLoyaltyMultiplier == null) {
      res.status(400).json(errBody(
        'Missing required fields: validatorId, xpAmount, localLoyaltyMultiplier',
        'VALIDATION_ERROR',
      ));
      return;
    }
    if (xpAmount <= 0) {
      res.status(400).json(errBody('xpAmount must be > 0', 'VALIDATION_ERROR'));
      return;
    }
    if (localLoyaltyMultiplier <= 0) {
      res.status(400).json(errBody('localLoyaltyMultiplier must be > 0', 'VALIDATION_ERROR'));
      return;
    }

    const inputs: EPConversionInputs = {
      xpAmount:               Number(xpAmount),
      localLoyaltyMultiplier: Number(localLoyaltyMultiplier),
    };

    const epAmount = inputs.xpAmount * inputs.localLoyaltyMultiplier;

    // Burn XP
    const { tx: burnTx } = await burnTokens({
      validatorId: validatorId as ValidatorId,
      tokenType:   TokenType.XP,
      amount:      inputs.xpAmount,
      reason:      `XP→EP conversion: ${inputs.xpAmount} XP × L=${inputs.localLoyaltyMultiplier}`,
    });

    // Mint EP
    const { wallet: updatedWallet, balance: epBalance, tx: mintTx } = await mintTokens({
      validatorId: validatorId as ValidatorId,
      tokenType:   TokenType.EP,
      amount:      epAmount,
      reason:      `EP from XP conversion: ${epAmount} EP (L=${inputs.localLoyaltyMultiplier})`,
    });

    // Emit EP_CONVERTED
    await bus.emit(
      EventType.EP_CONVERTED,
      uuidv4() as LoopId,
      {
        validatorId: validatorId as ValidatorId,
        inputs,
        epAwarded:   epAmount,
        dfaoId:      ('00000000-0000-0000-0000-000000000000' as DFAOId),
      },
    );

    // Emit TOKEN_CONVERTED
    await bus.emit(
      EventType.TOKEN_CONVERTED,
      uuidv4() as LoopId,
      {
        transaction: mintTx,
        fromType:    TokenType.XP,
        toType:      TokenType.EP,
        fromAmount:  inputs.xpAmount,
        toAmount:    epAmount,
      },
    );

    res.status(201).json({
      wallet:        updatedWallet,
      epBalance,
      epAmount,
      xpBurned:      inputs.xpAmount,
      burnTransaction: burnTx,
      mintTransaction: mintTx,
      inputs,
    });
  } catch (err: any) {
    console.error('[token-economy] POST /ep/convert:', err);
    const status = err.message.startsWith('Insufficient') ? 400 : 500;
    res.status(status).json(errBody(err.message, 'INSUFFICIENT_BALANCE'));
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  XP Non-Transferability Audit
// ─────────────────────────────────────────────────────────────────────────────────

/** POST /xp/verify-non-transferable — Audit endpoint confirming XP is non-transferable */
app.post('/xp/verify-non-transferable', (_req: Request, res: Response) => {
  res.json({
    tokenType:        TokenType.XP,
    nonTransferable:  true,
    enforced:         true,
    transferEndpoint: null,
    message:          'XP is permanently non-transferable. No transfer mechanism exists for this token type.',
    auditTimestamp:   new Date().toISOString(),
    nonTransferableTypes: Array.from(NON_TRANSFERABLE_TYPES),
  });
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Reporting
// ─────────────────────────────────────────────────────────────────────────────────

/** GET /tokens/stats — Global token economy stats */
app.get('/tokens/stats', async (_req: Request, res: Response) => {
  try {
    // Per-type totals from transactions
    const txStats = await pool.query(
      `SELECT
         token_type,
         SUM(CASE WHEN action = 'mint' THEN amount ELSE 0 END)   AS total_minted,
         SUM(CASE WHEN action = 'burn' THEN amount ELSE 0 END)   AS total_burned,
         SUM(CASE WHEN action = 'lock' THEN amount ELSE 0 END)   AS total_locked_events
       FROM economy.token_transactions
       GROUP BY token_type`,
    );

    // Active supply by scanning wallet balances
    const activeSupply = await pool.query(
      `SELECT
         tb.token_type,
         SUM(CASE WHEN tb.status = 'active' THEN tb.amount ELSE 0 END) AS active,
         SUM(CASE WHEN tb.status = 'locked' THEN tb.amount ELSE 0 END) AS locked
       FROM economy.token_balances tb
       GROUP BY tb.token_type`,
    );

    const statsMap: Record<string, any> = {};
    for (const row of txStats.rows) {
      statsMap[row.token_type] = {
        totalMinted: Number(row.total_minted),
        totalBurned: Number(row.total_burned),
        active:      0,
        locked:      0,
      };
    }
    for (const row of activeSupply.rows) {
      if (!statsMap[row.token_type]) {
        statsMap[row.token_type] = { totalMinted: 0, totalBurned: 0, active: 0, locked: 0 };
      }
      statsMap[row.token_type].active = Number(row.active);
      statsMap[row.token_type].locked = Number(row.locked);
    }

    const walletCount = await pool.query('SELECT COUNT(*) AS cnt FROM economy.wallets');

    res.json({
      stats:       statsMap,
      totalWallets: Number(walletCount.rows[0].cnt),
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[token-economy] GET /tokens/stats:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

/** GET /tokens/leaderboard/:tokenType — Top holders for any token type */
app.get('/tokens/leaderboard/:tokenType', async (req: Request, res: Response) => {
  try {
    const { tokenType } = req.params;
    if (!Object.values(TokenType).includes(tokenType as TokenType)) {
      res.status(400).json(errBody(`Unknown tokenType: ${tokenType}`, 'VALIDATION_ERROR'));
      return;
    }

    const page     = Math.max(1, Number(req.query.page)     || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);
    const offset   = (page - 1) * pageSize;

    const rows = await pool.query(
      `SELECT
         w.validator_id,
         COALESCE((w.balances->>$1)::numeric, 0)        AS active_balance,
         COALESCE((w.locked_balances->>$1)::numeric, 0) AS locked_balance,
         COALESCE((w.balances->>$1)::numeric, 0) + COALESCE((w.locked_balances->>$1)::numeric, 0) AS total_balance
       FROM economy.wallets w
       ORDER BY total_balance DESC
       LIMIT $2 OFFSET $3`,
      [tokenType, pageSize, offset],
    );

    const total = await pool.query(
      `SELECT COUNT(*) AS cnt FROM economy.wallets
       WHERE COALESCE((balances->>$1)::numeric, 0) + COALESCE((locked_balances->>$1)::numeric, 0) > 0`,
      [tokenType],
    );

    const data = rows.rows.map((row, idx) => ({
      rank:           offset + idx + 1,
      validatorId:    row.validator_id,
      activeBalance:  Number(row.active_balance),
      lockedBalance:  Number(row.locked_balance),
      totalBalance:   Number(row.total_balance),
    }));

    res.json({
      data,
      tokenType,
      total:    Number(total.rows[0].cnt),
      page,
      pageSize,
      hasMore:  offset + pageSize < Number(total.rows[0].cnt),
    });
  } catch (err: any) {
    console.error('[token-economy] GET /tokens/leaderboard:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Inbound Event Webhook
// ─────────────────────────────────────────────────────────────────────────────────

app.post('/events', async (req: Request, res: Response) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[token-economy] Received event: ${event.type}`);
    await handleEvent(event);
    res.status(202).send();
  } catch (err: any) {
    console.error('[token-economy] Event handler error:', err);
    res.status(500).json(errBody(err.message, 'INTERNAL_ERROR'));
  }
});

// ─────────────────────────────────────────────────────────────────────────────────
//  Event Handler
// ─────────────────────────────────────────────────────────────────────────────────

async function handleEvent(event: DomainEvent): Promise<void> {
  switch (event.type) {

    // XP_MINTED_PROVISIONAL: auto-create wallet, credit XP
    case EventType.XP_MINTED_PROVISIONAL: {
      const payload = event.payload as XPMintedProvisionalPayload;
      const { mintEvent } = payload;

      for (const dist of mintEvent.distribution) {
        try {
          await ensureWallet(dist.validatorId);
          await mintTokens({
            validatorId: dist.validatorId,
            tokenType:   TokenType.XP,
            amount:      dist.xpAmount,
            reason:      `XP from loop ${mintEvent.loopId} (provisional mint)`,
            relatedEntityId:   mintEvent.loopId,
            relatedEntityType: 'loop',
          });
          console.log(`[token-economy] XP credited: validator=${dist.validatorId} xp=${dist.xpAmount} loop=${mintEvent.loopId}`);
        } catch (err) {
          console.error(`[token-economy] Failed to credit XP for ${dist.validatorId}:`, err);
        }
      }
      break;
    }

    // LOOP_CLOSED: record CAT performance for each participant
    case EventType.LOOP_CLOSED: {
      const payload = event.payload as LoopClosedPayload;
      const { loop } = payload;

      for (const validatorId of loop.validatorIds) {
        try {
          // Record performance in the loop's domain
          await ensureCATCert(validatorId as ValidatorId, loop.domain);
          await pool.query(
            `UPDATE economy.cat_certifications
             SET validated_performances = validated_performances + 1
             WHERE validator_id = $1 AND domain = $2`,
            [validatorId, loop.domain],
          );

          // Auto-certify if threshold met
          const certRes = await pool.query(
            'SELECT * FROM economy.cat_certifications WHERE validator_id = $1 AND domain = $2',
            [validatorId, loop.domain],
          );
          if (certRes.rows.length > 0) {
            const certRow = certRes.rows[0];
            if (Number(certRow.validated_performances) >= Number(certRow.next_level_threshold)) {
              await runCATCertify(validatorId as ValidatorId, loop.domain);
            }
          }
        } catch (err) {
          console.error(`[token-economy] Failed to record CAT performance for ${validatorId}:`, err);
        }
      }
      break;
    }

    // REPUTATION_ACCRUED: could trigger IT derivation (log and let external caller invoke /it/derive)
    case EventType.REPUTATION_ACCRUED: {
      console.log(`[token-economy] REPUTATION_ACCRUED received for validator=${(event.payload as any).validatorId} — IT derivation can be triggered via POST /it/derive`);
      break;
    }

    default:
      break;
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
  bus.on(EventType.XP_MINTED_PROVISIONAL, async (event) => {
    await handleEvent(event as DomainEvent);
  });
  bus.on(EventType.LOOP_CLOSED, async (event) => {
    await handleEvent(event as DomainEvent);
  });
  bus.on(EventType.REPUTATION_ACCRUED, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  app.listen(PORT, () => {
    console.log(`[token-economy] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[token-economy] Fatal startup error:', err);
  process.exit(1);
});

export default app;
