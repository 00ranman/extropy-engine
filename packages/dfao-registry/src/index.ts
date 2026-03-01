/**
 * DFAO Registry — Service Entrypoint
 *
 * Organizational fabric layer for the Extropy Engine.
 * Manages Decentralized Fractal Autonomous Organizations (DFAOs):
 * their lifecycle, membership, fractal nesting, and governance weights.
 *
 * Rollout phases: shadow → hybrid → active
 * Port: 4009
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
  DFAOStatus,
  DFAOScale,
  MembershipRole,
  MembershipStatus,
} from '@extropy/contracts';
import type {
  DFAO,
  DFAOId,
  DFAOMembership,
  DFAOGovernanceConfig,
  DFAOTokenConfig,
  ValidatorId,
  VertexId,
  EntropyDomain,
  DomainEvent,
  ServiceHealthResponse,
  PaginatedResponse,
  LoopClosedPayload,
  DFAOCreatedPayload,
  DFAOStatusChangedPayload,
  DFAOMemberJoinedPayload,
  DFAOMemberLeftPayload,
  DFAOMemberExpelledPayload,
  DFAODissolvedPayload,
  LoopId,
  ProposalId,
} from '@extropy/contracts';

const app = express();
app.use(express.json());

const PORT   = process.env.PORT || 4009;
const SERVICE = ServiceName.DFAO_REGISTRY;

const pool  = createPool();
const redis = createRedis();
const bus   = new EventBus(redis, pool, SERVICE);

// ─────────────────────────────────────────────────────────────────────────────
//  Default configs
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_GOVERNANCE_CONFIG: DFAOGovernanceConfig = {
  quorumMinMembers:          3,
  quorumPercentage:          0.51,
  deliberationPeriodHours:   72,
  votingMethod:              'linear_reputation',
  bindingProposals:          false,
  proposalThresholdParams: {
    complexityFactor:         1.0,
    impactRadiusMultiplier:   1.0,
  },
  emergencyThreshold:        0.75,
};

const DEFAULT_TOKEN_CONFIG: DFAOTokenConfig = {
  mintsDomainTokens:           false,
  ctMultiplier:                1.0,
  domainContributionExponent:  1.5,
  totalContributionExponent:   0.5,
};

// ─────────────────────────────────────────────────────────────────────────────
//  Row mappers
// ─────────────────────────────────────────────────────────────────────────────

function dfaoFromRow(row: any): DFAO {
  return {
    id:                row.id                 as DFAOId,
    name:              row.name,
    description:       row.description,
    status:            row.status             as DFAOStatus,
    scale:             row.scale              as DFAOScale,
    parentDFAOId:      (row.parent_dfao_id ?? null) as DFAOId | null,
    childDFAOIds:      (row.child_dfao_ids   || []) as DFAOId[],
    founderIds:        (row.founder_ids       || []) as ValidatorId[],
    memberCount:       row.member_count       || 0,
    primaryDomain:     row.primary_domain     as EntropyDomain,
    secondaryDomains:  (row.secondary_domains || []) as EntropyDomain[],
    governanceConfig:  row.governance_config  as DFAOGovernanceConfig,
    tokenConfig:       row.token_config       as DFAOTokenConfig,
    creationVertexId:  (row.creation_vertex_id || '') as VertexId,
    metadata:          row.metadata           || {},
    createdAt:         row.created_at.toISOString(),
    updatedAt:         row.updated_at.toISOString(),
  };
}

function membershipFromRow(row: any): DFAOMembership {
  return {
    dfaoId:              row.dfao_id             as DFAOId,
    validatorId:         row.validator_id        as ValidatorId,
    role:                row.role                as MembershipRole,
    status:              row.status              as MembershipStatus,
    governanceWeight:    row.governance_weight   || 0,
    domainContributions: row.domain_contributions || {},
    totalContributions:  row.total_contributions  || 0,
    joinedAt:            row.joined_at.toISOString(),
    lastActiveAt:        row.last_active_at.toISOString(),
    membershipVertexId:  (row.membership_vertex_id || '') as VertexId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Governance weight calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates governance weight for a membership record.
 *
 * weight = (domain_contribution^1.5) × (total_contribution^0.5) × recency_factor
 * recency_factor = exp(-0.05 × months_since_last_active)  [5% monthly decay]
 */
function computeGovernanceWeight(
  membership: DFAOMembership,
  tokenConfig: DFAOTokenConfig,
): number {
  const domainContrib = Object.values(membership.domainContributions).reduce((s, v) => s + v, 0);
  const totalContrib  = membership.totalContributions;

  const domainExp = tokenConfig.domainContributionExponent ?? 1.5;
  const totalExp  = tokenConfig.totalContributionExponent  ?? 0.5;

  const lastActive     = new Date(membership.lastActiveAt).getTime();
  const now            = Date.now();
  const monthsInactive = (now - lastActive) / (1000 * 60 * 60 * 24 * 30);
  const recencyFactor  = Math.exp(-0.05 * monthsInactive);

  const domainPart = domainContrib > 0 ? Math.pow(domainContrib, domainExp) : 0;
  const totalPart  = totalContrib  > 0 ? Math.pow(totalContrib,  totalExp)  : 0;

  return domainPart * totalPart * recencyFactor;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Valid status transitions
// ─────────────────────────────────────────────────────────────────────────────

const VALID_STATUS_TRANSITIONS: Record<DFAOStatus, DFAOStatus[]> = {
  [DFAOStatus.SHADOW]:    [DFAOStatus.HYBRID,     DFAOStatus.SUSPENDED, DFAOStatus.DISSOLVED],
  [DFAOStatus.HYBRID]:    [DFAOStatus.ACTIVE,     DFAOStatus.SUSPENDED, DFAOStatus.DISSOLVED],
  [DFAOStatus.ACTIVE]:    [DFAOStatus.SUSPENDED,  DFAOStatus.DISSOLVED],
  [DFAOStatus.SUSPENDED]: [DFAOStatus.ACTIVE,     DFAOStatus.DISSOLVED],
  [DFAOStatus.DISSOLVED]: [],
};

function isValidTransition(from: DFAOStatus, to: DFAOStatus): boolean {
  return VALID_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Health
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  const health: ServiceHealthResponse = {
    service:    SERVICE,
    status:     'healthy',
    version:    '0.1.0',
    uptime:     process.uptime(),
    timestamp:  new Date().toISOString(),
    dependencies: {
      'loop-ledger': 'connected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /dfaos — Create a DFAO
// ─────────────────────────────────────────────────────────────────────────────

app.post('/dfaos', async (req, res) => {
  try {
    const {
      name,
      description,
      scale,
      primaryDomain,
      secondaryDomains,
      founderIds,
      parentDFAOId,
      governanceConfig: rawGovConfig,
      tokenConfig:      rawTokenConfig,
    } = req.body;

    if (!name || !description || !scale || !primaryDomain || !founderIds || founderIds.length === 0) {
      res.status(400).json({
        error:     'Missing required fields: name, description, scale, primaryDomain, founderIds',
        code:      'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!Object.values(DFAOScale).includes(scale)) {
      res.status(400).json({ error: `Invalid scale: ${scale}`, code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    // Validate parent if provided
    if (parentDFAOId) {
      const parentRes = await pool.query('SELECT id FROM dfao.organizations WHERE id = $1', [parentDFAOId]);
      if (parentRes.rows.length === 0) {
        res.status(404).json({ error: `Parent DFAO ${parentDFAOId} not found`, code: 'NOT_FOUND', timestamp: new Date().toISOString() });
        return;
      }
    }

    const dfaoId = uuidv4() as DFAOId;
    const now    = new Date();

    const governanceConfig: DFAOGovernanceConfig = rawGovConfig
      ? { ...DEFAULT_GOVERNANCE_CONFIG, ...rawGovConfig }
      : { ...DEFAULT_GOVERNANCE_CONFIG };

    const tokenConfig: DFAOTokenConfig = rawTokenConfig
      ? { ...DEFAULT_TOKEN_CONFIG, ...rawTokenConfig }
      : { ...DEFAULT_TOKEN_CONFIG };

    await pool.query(
      `INSERT INTO dfao.organizations (
         id, name, description, status, scale,
         parent_dfao_id, child_dfao_ids, founder_ids,
         member_count, primary_domain, secondary_domains,
         governance_config, token_config,
         creation_vertex_id, metadata, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8,
         $9, $10, $11,
         $12, $13,
         $14, $15, $16, $17
       )`,
      [
        dfaoId,
        name,
        description,
        DFAOStatus.SHADOW,
        scale,
        parentDFAOId ?? null,
        [],
        founderIds,
        founderIds.length,
        primaryDomain,
        secondaryDomains || [],
        JSON.stringify(governanceConfig),
        JSON.stringify(tokenConfig),
        '',          // creationVertexId — populated by DAG substrate later
        JSON.stringify({}),
        now,
        now,
      ],
    );

    // If has parent, add this DFAO as a child of the parent
    if (parentDFAOId) {
      await pool.query(
        `UPDATE dfao.organizations
         SET child_dfao_ids = array_append(child_dfao_ids, $1), updated_at = NOW()
         WHERE id = $2`,
        [dfaoId, parentDFAOId],
      );
    }

    // Create membership records for all founders
    for (const founderId of founderIds as ValidatorId[]) {
      const membershipVertexId = '' as VertexId;
      await pool.query(
        `INSERT INTO dfao.memberships (
           dfao_id, validator_id, role, status,
           governance_weight, domain_contributions, total_contributions,
           joined_at, last_active_at, membership_vertex_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (dfao_id, validator_id) DO NOTHING`,
        [
          dfaoId,
          founderId,
          MembershipRole.FOUNDER,
          MembershipStatus.ACTIVE,
          0,
          JSON.stringify({}),
          0,
          now,
          now,
          membershipVertexId,
        ],
      );
    }

    const dfaoRes = await pool.query('SELECT * FROM dfao.organizations WHERE id = $1', [dfaoId]);
    const dfao    = dfaoFromRow(dfaoRes.rows[0]);

    await bus.emit(EventType.DFAO_CREATED, dfaoId as unknown as LoopId, {
      dfao,
      creatorId: founderIds[0] as ValidatorId,
    } as DFAOCreatedPayload);

    console.log(`[dfao-registry] DFAO ${dfaoId} CREATED: "${name}" (scale=${scale}, founders=${founderIds.length})`);
    res.status(201).json(dfao);
  } catch (err: any) {
    console.error('[dfao-registry] POST /dfaos error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /dfaos/:id — Get a DFAO by ID
// ─────────────────────────────────────────────────────────────────────────────

app.get('/dfaos/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM dfao.organizations WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'DFAO not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }
    res.json(dfaoFromRow(result.rows[0]));
  } catch (err: any) {
    console.error('[dfao-registry] GET /dfaos/:id error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /dfaos — List DFAOs with filters
// ─────────────────────────────────────────────────────────────────────────────

app.get('/dfaos', async (req, res) => {
  try {
    const { status, scale, domain, parentDFAOId } = req.query;
    const page     = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize as string) || 20);
    const offset   = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 0;

    if (status)       { idx++; where += ` AND status = $${idx}`;          params.push(status); }
    if (scale)        { idx++; where += ` AND scale = $${idx}`;           params.push(scale); }
    if (domain)       { idx++; where += ` AND primary_domain = $${idx}`;  params.push(domain); }
    if (parentDFAOId) { idx++; where += ` AND parent_dfao_id = $${idx}`;  params.push(parentDFAOId); }

    const countResult  = await pool.query(`SELECT COUNT(*) FROM dfao.organizations ${where}`, params);
    const total        = parseInt(countResult.rows[0].count, 10);

    idx++;
    idx++;
    const dataResult = await pool.query(
      `SELECT * FROM dfao.organizations ${where} ORDER BY created_at DESC LIMIT $${idx - 1} OFFSET $${idx}`,
      [...params, pageSize, offset],
    );

    const response: PaginatedResponse<DFAO> = {
      data:     dataResult.rows.map(dfaoFromRow),
      total,
      page,
      pageSize,
      hasMore:  offset + dataResult.rows.length < total,
    };

    res.json(response);
  } catch (err: any) {
    console.error('[dfao-registry] GET /dfaos error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH /dfaos/:id/status — Change DFAO status
// ─────────────────────────────────────────────────────────────────────────────

app.patch('/dfaos/:id/status', async (req, res) => {
  try {
    const dfaoId    = req.params.id as DFAOId;
    const { status: newStatus, proposalId } = req.body;

    if (!newStatus) {
      res.status(400).json({ error: 'Missing required field: status', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    if (!Object.values(DFAOStatus).includes(newStatus)) {
      res.status(400).json({ error: `Invalid status: ${newStatus}`, code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const dfaoRes = await pool.query('SELECT * FROM dfao.organizations WHERE id = $1', [dfaoId]);
    if (dfaoRes.rows.length === 0) {
      res.status(404).json({ error: 'DFAO not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const dfao           = dfaoFromRow(dfaoRes.rows[0]);
    const previousStatus = dfao.status;

    if (!isValidTransition(previousStatus, newStatus as DFAOStatus)) {
      res.status(422).json({
        error: `Invalid status transition: ${previousStatus} → ${newStatus}`,
        code:  'INVALID_TRANSITION',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // If transitioning from SHADOW → HYBRID, enable binding proposals
    let govConfigUpdate: Partial<DFAOGovernanceConfig> = {};
    if (previousStatus === DFAOStatus.SHADOW && newStatus === DFAOStatus.HYBRID) {
      govConfigUpdate.bindingProposals = true;
    }

    const updatedGovConfig = Object.keys(govConfigUpdate).length > 0
      ? JSON.stringify({ ...dfao.governanceConfig, ...govConfigUpdate })
      : null;

    if (updatedGovConfig) {
      await pool.query(
        `UPDATE dfao.organizations SET status = $1, governance_config = $2, updated_at = NOW() WHERE id = $3`,
        [newStatus, updatedGovConfig, dfaoId],
      );
    } else {
      await pool.query(
        `UPDATE dfao.organizations SET status = $1, updated_at = NOW() WHERE id = $2`,
        [newStatus, dfaoId],
      );
    }

    await bus.emit(EventType.DFAO_STATUS_CHANGED, dfaoId as unknown as LoopId, {
      dfaoId,
      previousStatus,
      newStatus:               newStatus as DFAOStatus,
      triggeredByProposalId:   proposalId as ProposalId | null ?? null,
    } as DFAOStatusChangedPayload);

    const updatedRes = await pool.query('SELECT * FROM dfao.organizations WHERE id = $1', [dfaoId]);
    console.log(`[dfao-registry] DFAO ${dfaoId} status: ${previousStatus} → ${newStatus}`);
    res.json(dfaoFromRow(updatedRes.rows[0]));
  } catch (err: any) {
    console.error('[dfao-registry] PATCH /dfaos/:id/status error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /dfaos/:id/members — Add a member
// ─────────────────────────────────────────────────────────────────────────────

app.post('/dfaos/:id/members', async (req, res) => {
  try {
    const dfaoId      = req.params.id as DFAOId;
    const { validatorId, role: rawRole } = req.body;

    if (!validatorId) {
      res.status(400).json({ error: 'Missing required field: validatorId', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const role = (rawRole || MembershipRole.MEMBER) as MembershipRole;

    if (!Object.values(MembershipRole).includes(role)) {
      res.status(400).json({ error: `Invalid role: ${role}`, code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const dfaoRes = await pool.query('SELECT * FROM dfao.organizations WHERE id = $1', [dfaoId]);
    if (dfaoRes.rows.length === 0) {
      res.status(404).json({ error: 'DFAO not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const dfao = dfaoFromRow(dfaoRes.rows[0]);

    if (dfao.status === DFAOStatus.DISSOLVED) {
      res.status(422).json({ error: 'Cannot add member to a dissolved DFAO', code: 'DFAO_DISSOLVED', timestamp: new Date().toISOString() });
      return;
    }

    // Check if already an active member
    const existingRes = await pool.query(
      `SELECT * FROM dfao.memberships WHERE dfao_id = $1 AND validator_id = $2`,
      [dfaoId, validatorId],
    );

    if (existingRes.rows.length > 0 && existingRes.rows[0].status === MembershipStatus.ACTIVE) {
      res.status(409).json({ error: 'Validator is already an active member', code: 'ALREADY_MEMBER', timestamp: new Date().toISOString() });
      return;
    }

    const membershipVertexId = '' as VertexId;
    const now                = new Date();

    if (existingRes.rows.length > 0) {
      // Re-activate inactive membership
      await pool.query(
        `UPDATE dfao.memberships
         SET role = $1, status = $2, last_active_at = $3
         WHERE dfao_id = $4 AND validator_id = $5`,
        [role, MembershipStatus.ACTIVE, now, dfaoId, validatorId],
      );
    } else {
      await pool.query(
        `INSERT INTO dfao.memberships (
           dfao_id, validator_id, role, status,
           governance_weight, domain_contributions, total_contributions,
           joined_at, last_active_at, membership_vertex_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          dfaoId,
          validatorId,
          role,
          MembershipStatus.ACTIVE,
          0,
          JSON.stringify({}),
          0,
          now,
          now,
          membershipVertexId,
        ],
      );
    }

    // Increment member_count
    await pool.query(
      `UPDATE dfao.organizations SET member_count = member_count + 1, updated_at = NOW() WHERE id = $1`,
      [dfaoId],
    );

    const membershipRes  = await pool.query(
      `SELECT * FROM dfao.memberships WHERE dfao_id = $1 AND validator_id = $2`,
      [dfaoId, validatorId],
    );
    const membership = membershipFromRow(membershipRes.rows[0]);

    await bus.emit(EventType.DFAO_MEMBER_JOINED, dfaoId as unknown as LoopId, {
      dfaoId,
      validatorId: validatorId as ValidatorId,
      role,
      membershipVertexId,
    } as DFAOMemberJoinedPayload);

    console.log(`[dfao-registry] Validator ${validatorId} joined DFAO ${dfaoId} as ${role}`);
    res.status(201).json(membership);
  } catch (err: any) {
    console.error('[dfao-registry] POST /dfaos/:id/members error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE /dfaos/:id/members/:validatorId — Remove a member
// ─────────────────────────────────────────────────────────────────────────────

app.delete('/dfaos/:id/members/:validatorId', async (req, res) => {
  try {
    const dfaoId      = req.params.id          as DFAOId;
    const validatorId = req.params.validatorId as ValidatorId;

    const memberRes = await pool.query(
      `SELECT * FROM dfao.memberships WHERE dfao_id = $1 AND validator_id = $2`,
      [dfaoId, validatorId],
    );

    if (memberRes.rows.length === 0) {
      res.status(404).json({ error: 'Membership not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const membership = membershipFromRow(memberRes.rows[0]);

    if (membership.status === MembershipStatus.INACTIVE) {
      res.status(409).json({ error: 'Member is already inactive', code: 'ALREADY_INACTIVE', timestamp: new Date().toISOString() });
      return;
    }

    await pool.query(
      `UPDATE dfao.memberships SET status = $1 WHERE dfao_id = $2 AND validator_id = $3`,
      [MembershipStatus.INACTIVE, dfaoId, validatorId],
    );

    // Decrement member_count (floor at 0)
    await pool.query(
      `UPDATE dfao.organizations
       SET member_count = GREATEST(member_count - 1, 0), updated_at = NOW()
       WHERE id = $1`,
      [dfaoId],
    );

    await bus.emit(EventType.DFAO_MEMBER_LEFT, dfaoId as unknown as LoopId, {
      dfaoId,
      validatorId,
      reason: 'voluntary_exit',
    } as DFAOMemberLeftPayload);

    console.log(`[dfao-registry] Validator ${validatorId} left DFAO ${dfaoId}`);
    res.status(204).send();
  } catch (err: any) {
    console.error('[dfao-registry] DELETE /dfaos/:id/members/:validatorId error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /dfaos/:id/members/:validatorId/expel — Expel a member
// ─────────────────────────────────────────────────────────────────────────────

app.post('/dfaos/:id/members/:validatorId/expel', async (req, res) => {
  try {
    const dfaoId      = req.params.id          as DFAOId;
    const validatorId = req.params.validatorId as ValidatorId;
    const { proposalId, reason } = req.body;

    if (!proposalId) {
      res.status(400).json({ error: 'Missing required field: proposalId', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const memberRes = await pool.query(
      `SELECT * FROM dfao.memberships WHERE dfao_id = $1 AND validator_id = $2`,
      [dfaoId, validatorId],
    );

    if (memberRes.rows.length === 0) {
      res.status(404).json({ error: 'Membership not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const membership = membershipFromRow(memberRes.rows[0]);

    if (membership.status === MembershipStatus.EXPELLED) {
      res.status(409).json({ error: 'Member is already expelled', code: 'ALREADY_EXPELLED', timestamp: new Date().toISOString() });
      return;
    }

    await pool.query(
      `UPDATE dfao.memberships SET status = $1 WHERE dfao_id = $2 AND validator_id = $3`,
      [MembershipStatus.EXPELLED, dfaoId, validatorId],
    );

    // Decrement member_count only if was active
    if (membership.status === MembershipStatus.ACTIVE) {
      await pool.query(
        `UPDATE dfao.organizations
         SET member_count = GREATEST(member_count - 1, 0), updated_at = NOW()
         WHERE id = $1`,
        [dfaoId],
      );
    }

    await bus.emit(EventType.DFAO_MEMBER_EXPELLED, dfaoId as unknown as LoopId, {
      dfaoId,
      validatorId,
      proposalId: proposalId as ProposalId,
      reason:     reason || 'Governance expulsion',
    } as DFAOMemberExpelledPayload);

    console.log(`[dfao-registry] Validator ${validatorId} EXPELLED from DFAO ${dfaoId} (proposal=${proposalId})`);
    res.status(200).json({ dfaoId, validatorId, status: MembershipStatus.EXPELLED, proposalId });
  } catch (err: any) {
    console.error('[dfao-registry] POST .../expel error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /dfaos/:id/members — List members
// ─────────────────────────────────────────────────────────────────────────────

app.get('/dfaos/:id/members', async (req, res) => {
  try {
    const dfaoId = req.params.id as DFAOId;
    const { status, role } = req.query;

    let where = 'WHERE dfao_id = $1';
    const params: any[] = [dfaoId];
    let idx = 1;

    if (status) { idx++; where += ` AND status = $${idx}`; params.push(status); }
    if (role)   { idx++; where += ` AND role = $${idx}`;   params.push(role); }

    const result = await pool.query(
      `SELECT * FROM dfao.memberships ${where} ORDER BY joined_at ASC`,
      params,
    );

    res.json(result.rows.map(membershipFromRow));
  } catch (err: any) {
    console.error('[dfao-registry] GET /dfaos/:id/members error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH /dfaos/:id/members/:validatorId/role — Update member role
// ─────────────────────────────────────────────────────────────────────────────

app.patch('/dfaos/:id/members/:validatorId/role', async (req, res) => {
  try {
    const dfaoId      = req.params.id          as DFAOId;
    const validatorId = req.params.validatorId as ValidatorId;
    const { role }    = req.body;

    if (!role) {
      res.status(400).json({ error: 'Missing required field: role', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    if (!Object.values(MembershipRole).includes(role)) {
      res.status(400).json({ error: `Invalid role: ${role}`, code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const memberRes = await pool.query(
      `SELECT * FROM dfao.memberships WHERE dfao_id = $1 AND validator_id = $2`,
      [dfaoId, validatorId],
    );

    if (memberRes.rows.length === 0) {
      res.status(404).json({ error: 'Membership not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const membership = membershipFromRow(memberRes.rows[0]);

    // Founders cannot have their role changed downward — only lateral transitions allowed
    // (FOUNDER role is permanent unless explicitly overridden by governance)
    if (membership.role === MembershipRole.FOUNDER && role !== MembershipRole.FOUNDER) {
      res.status(422).json({
        error:     'Founder role cannot be changed via this endpoint; use governance proposal',
        code:      'FOUNDER_ROLE_LOCKED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    await pool.query(
      `UPDATE dfao.memberships SET role = $1 WHERE dfao_id = $2 AND validator_id = $3`,
      [role, dfaoId, validatorId],
    );

    const updatedRes = await pool.query(
      `SELECT * FROM dfao.memberships WHERE dfao_id = $1 AND validator_id = $2`,
      [dfaoId, validatorId],
    );

    console.log(`[dfao-registry] Validator ${validatorId} role updated to ${role} in DFAO ${dfaoId}`);
    res.json(membershipFromRow(updatedRes.rows[0]));
  } catch (err: any) {
    console.error('[dfao-registry] PATCH .../role error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /dfaos/:id/children — Get child DFAOs
// ─────────────────────────────────────────────────────────────────────────────

app.get('/dfaos/:id/children', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM dfao.organizations WHERE parent_dfao_id = $1 ORDER BY created_at ASC`,
      [req.params.id],
    );
    res.json(result.rows.map(dfaoFromRow));
  } catch (err: any) {
    console.error('[dfao-registry] GET /dfaos/:id/children error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /dfaos/:id/ancestry — Get full ancestry chain up to root
// ─────────────────────────────────────────────────────────────────────────────

app.get('/dfaos/:id/ancestry', async (req, res) => {
  try {
    const startId = req.params.id;

    // Verify the starting DFAO exists
    const startRes = await pool.query('SELECT id, parent_dfao_id FROM dfao.organizations WHERE id = $1', [startId]);
    if (startRes.rows.length === 0) {
      res.status(404).json({ error: 'DFAO not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    // Walk the parent chain iteratively (guards against cycles via a visited set)
    const ancestry: DFAO[] = [];
    const visited          = new Set<string>();
    let currentParentId: string | null = startRes.rows[0].parent_dfao_id;

    while (currentParentId && !visited.has(currentParentId)) {
      visited.add(currentParentId);
      const parentRes = await pool.query('SELECT * FROM dfao.organizations WHERE id = $1', [currentParentId]);
      if (parentRes.rows.length === 0) break;
      const parent = dfaoFromRow(parentRes.rows[0]);
      ancestry.push(parent);
      currentParentId = parentRes.rows[0].parent_dfao_id ?? null;
    }

    // ancestry[0] is the direct parent, ancestry[last] is the root
    res.json(ancestry);
  } catch (err: any) {
    console.error('[dfao-registry] GET /dfaos/:id/ancestry error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /dfaos/:id/governance-weight — Recalculate governance weights
// ─────────────────────────────────────────────────────────────────────────────

app.post('/dfaos/:id/governance-weight', async (req, res) => {
  try {
    const dfaoId = req.params.id as DFAOId;

    const dfaoRes = await pool.query('SELECT * FROM dfao.organizations WHERE id = $1', [dfaoId]);
    if (dfaoRes.rows.length === 0) {
      res.status(404).json({ error: 'DFAO not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const dfao        = dfaoFromRow(dfaoRes.rows[0]);
    const tokenConfig = dfao.tokenConfig;

    const membersRes = await pool.query(
      `SELECT * FROM dfao.memberships WHERE dfao_id = $1 AND status = $2`,
      [dfaoId, MembershipStatus.ACTIVE],
    );

    const updates: Array<{ validatorId: ValidatorId; weight: number }> = [];

    for (const row of membersRes.rows) {
      const membership = membershipFromRow(row);
      const weight     = computeGovernanceWeight(membership, tokenConfig);

      await pool.query(
        `UPDATE dfao.memberships SET governance_weight = $1 WHERE dfao_id = $2 AND validator_id = $3`,
        [weight, dfaoId, membership.validatorId],
      );

      updates.push({ validatorId: membership.validatorId, weight });
    }

    console.log(`[dfao-registry] Recalculated governance weights for DFAO ${dfaoId}: ${updates.length} member(s) updated`);
    res.json({ dfaoId, updatedCount: updates.length, updates });
  } catch (err: any) {
    console.error('[dfao-registry] POST /governance-weight error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /dfaos/:id/stats — DFAO statistics
// ─────────────────────────────────────────────────────────────────────────────

app.get('/dfaos/:id/stats', async (req, res) => {
  try {
    const dfaoId = req.params.id as DFAOId;

    const dfaoRes = await pool.query('SELECT * FROM dfao.organizations WHERE id = $1', [dfaoId]);
    if (dfaoRes.rows.length === 0) {
      res.status(404).json({ error: 'DFAO not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const statsRes = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'active')                  AS active_members,
         COUNT(*)                                                    AS total_members,
         COALESCE(SUM(total_contributions), 0)                      AS total_contributions,
         COALESCE(AVG(governance_weight) FILTER (WHERE status = 'active'), 0) AS avg_governance_weight,
         COALESCE(MAX(governance_weight), 0)                        AS max_governance_weight
       FROM dfao.memberships
       WHERE dfao_id = $1`,
      [dfaoId],
    );

    const dfao = dfaoFromRow(dfaoRes.rows[0]);
    const s    = statsRes.rows[0];

    res.json({
      dfaoId,
      memberCount:          dfao.memberCount,
      activeMembers:        parseInt(s.active_members,   10),
      totalMembers:         parseInt(s.total_members,    10),
      totalContributions:   parseFloat(s.total_contributions),
      avgGovernanceWeight:  parseFloat(s.avg_governance_weight),
      maxGovernanceWeight:  parseFloat(s.max_governance_weight),
      status:               dfao.status,
      scale:                dfao.scale,
      childDFAOCount:       dfao.childDFAOIds.length,
    });
  } catch (err: any) {
    console.error('[dfao-registry] GET /dfaos/:id/stats error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /dfaos/:id/dissolve — Dissolve a DFAO
// ─────────────────────────────────────────────────────────────────────────────

app.post('/dfaos/:id/dissolve', async (req, res) => {
  try {
    const dfaoId = req.params.id as DFAOId;
    const { proposalId } = req.body;

    if (!proposalId) {
      res.status(400).json({ error: 'Missing required field: proposalId', code: 'VALIDATION_ERROR', timestamp: new Date().toISOString() });
      return;
    }

    const dfaoRes = await pool.query('SELECT * FROM dfao.organizations WHERE id = $1', [dfaoId]);
    if (dfaoRes.rows.length === 0) {
      res.status(404).json({ error: 'DFAO not found', code: 'NOT_FOUND', timestamp: new Date().toISOString() });
      return;
    }

    const dfao = dfaoFromRow(dfaoRes.rows[0]);

    if (dfao.status === DFAOStatus.DISSOLVED) {
      res.status(409).json({ error: 'DFAO is already dissolved', code: 'ALREADY_DISSOLVED', timestamp: new Date().toISOString() });
      return;
    }

    // Set all active memberships to INACTIVE
    await pool.query(
      `UPDATE dfao.memberships
       SET status = $1
       WHERE dfao_id = $2 AND status IN ('active', 'suspended')`,
      [MembershipStatus.INACTIVE, dfaoId],
    );

    // Get final active member count before dissolving
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM dfao.memberships WHERE dfao_id = $1 AND status = $2`,
      [dfaoId, MembershipStatus.ACTIVE],
    );
    const finalMemberCount = parseInt(countRes.rows[0].count, 10);

    // Set DFAO to DISSOLVED
    await pool.query(
      `UPDATE dfao.organizations SET status = $1, member_count = 0, updated_at = NOW() WHERE id = $2`,
      [DFAOStatus.DISSOLVED, dfaoId],
    );

    await bus.emit(EventType.DFAO_DISSOLVED, dfaoId as unknown as LoopId, {
      dfaoId,
      proposalId: proposalId as ProposalId,
      finalMemberCount,
    } as DFAODissolvedPayload);

    const updatedRes = await pool.query('SELECT * FROM dfao.organizations WHERE id = $1', [dfaoId]);
    console.log(`[dfao-registry] DFAO ${dfaoId} DISSOLVED (proposal=${proposalId}, finalMembers=${finalMemberCount})`);
    res.json(dfaoFromRow(updatedRes.rows[0]));
  } catch (err: any) {
    console.error('[dfao-registry] POST /dfaos/:id/dissolve error:', err);
    res.status(500).json({ error: err.message, code: 'INTERNAL_ERROR', timestamp: new Date().toISOString() });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /events — Inbound event webhook
// ─────────────────────────────────────────────────────────────────────────────

app.post('/events', async (req, res) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[dfao-registry] Received event: ${event.type}`);
    await handleEvent(event);
    res.status(202).send();
  } catch (err: any) {
    console.error('[dfao-registry] Event handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Event handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleEvent(event: DomainEvent): Promise<void> {
  switch (event.type) {
    case EventType.LOOP_CLOSED: {
      const payload = event.payload as LoopClosedPayload;
      const loop    = payload.loop;

      if (!loop.validatorIds || loop.validatorIds.length === 0) break;

      // Find all DFAO memberships for the validators involved in this loop
      const validatorIds = loop.validatorIds.filter((v) => v != null);
      if (validatorIds.length === 0) break;

      // Build a parameterized list for the IN clause
      const placeholders = validatorIds.map((_: any, i: number) => `$${i + 1}`).join(', ');
      const membershipsRes = await pool.query(
        `SELECT * FROM dfao.memberships
         WHERE validator_id IN (${placeholders}) AND status = 'active'`,
        validatorIds,
      );

      if (membershipsRes.rows.length === 0) break;

      const domain = loop.domain as EntropyDomain;

      for (const row of membershipsRes.rows) {
        const membership = membershipFromRow(row);

        // Increment domain contribution for the loop's domain
        const currentContributions = { ...membership.domainContributions } as Record<EntropyDomain, number>;
        currentContributions[domain] = (currentContributions[domain] || 0) + 1;
        const newTotalContributions  = membership.totalContributions + 1;

        // Recalculate governance weight inline
        const dfaoRes = await pool.query(
          'SELECT token_config FROM dfao.organizations WHERE id = $1',
          [membership.dfaoId],
        );
        const tokenConfig: DFAOTokenConfig = dfaoRes.rows.length > 0
          ? dfaoRes.rows[0].token_config
          : DEFAULT_TOKEN_CONFIG;

        const updatedMembership: DFAOMembership = {
          ...membership,
          domainContributions: currentContributions,
          totalContributions:  newTotalContributions,
          lastActiveAt:        new Date().toISOString(),
        };
        const newWeight = computeGovernanceWeight(updatedMembership, tokenConfig);

        await pool.query(
          `UPDATE dfao.memberships
           SET domain_contributions = $1,
               total_contributions  = $2,
               governance_weight    = $3,
               last_active_at       = NOW()
           WHERE dfao_id = $4 AND validator_id = $5`,
          [
            JSON.stringify(currentContributions),
            newTotalContributions,
            newWeight,
            membership.dfaoId,
            membership.validatorId,
          ],
        );
      }

      const affectedDfaos = [...new Set(membershipsRes.rows.map((r: any) => r.dfao_id))];
      console.log(
        `[dfao-registry] LOOP_CLOSED ${loop.id}: updated contributions for ${membershipsRes.rows.length} membership(s) across ${affectedDfaos.length} DFAO(s)`,
      );
      break;
    }

    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await waitForPostgres(pool);
  await waitForRedis(redis);
  await bus.start();

  // Subscribe to LOOP_CLOSED via Redis pub/sub
  bus.on(EventType.LOOP_CLOSED, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  app.listen(PORT, () => {
    console.log(`[dfao-registry] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[dfao-registry] Fatal startup error:', err);
  process.exit(1);
});

export default app;
