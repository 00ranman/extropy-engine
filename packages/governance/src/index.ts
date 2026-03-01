/**
 * Governance Service — Service Entrypoint
 *
 * Manages the full lifecycle of governance proposals within DFAOs:
 * creation, deliberation, voting, resolution, implementation, and veto.
 *
 * Port: 4010
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
  ProposalStatus,
  ProposalType,
} from '@extropy/contracts';
import type {
  GovernanceProposal,
  GovernanceVote,
  GovernanceTally,
  ProposalChange,
  ProposalId,
  DFAOId,
  ValidatorId,
  VertexId,
  SeasonId,
  LoopId,
  DomainEvent,
  ServiceHealthResponse,
  PaginatedResponse,
  ProposalCreatedPayload,
  ProposalVotingStartedPayload,
  GovernanceVoteCastPayload,
  ProposalPassedPayload,
  ProposalRejectedPayload,
  ProposalImplementedPayload,
  EmergencyInterventionPayload,
  SeasonEndedPayload,
} from '@extropy/contracts';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4010;
const SERVICE = ServiceName.GOVERNANCE;
const DFAO_REGISTRY_URL = process.env.DFAO_REGISTRY_URL || 'http://dfao-registry:4006';

const pool = createPool();
const redis = createRedis();
const bus = new EventBus(redis, pool, SERVICE);

// ── Pure calculation helpers ──────────────────────────────────────────────────

/**
 * Aggregate votes into a tally. quorumMet and passed are resolved separately
 * once the active member count is known.
 */
function calculateTally(votes: GovernanceVote[]): GovernanceTally {
  let totalWeightFor = 0;
  let totalWeightAgainst = 0;
  let totalWeightAbstain = 0;

  for (const v of votes) {
    if (v.vote === 'approve') totalWeightFor += v.weight;
    else if (v.vote === 'reject') totalWeightAgainst += v.weight;
    else totalWeightAbstain += v.weight;
  }

  return {
    totalWeightFor,
    totalWeightAgainst,
    totalWeightAbstain,
    totalVoters: votes.length,
    quorumMet: false,  // resolved by resolveQuorum()
    passed: false,     // resolved by resolveQuorum()
  };
}

/**
 * Finalise quorum and majority for a tally given the current active member count
 * and the required quorum percentage (0–1).
 */
function resolveQuorum(
  tally: GovernanceTally,
  activeMemberCount: number,
  quorumPercentage: number,
): GovernanceTally {
  const quorumMet =
    activeMemberCount > 0 &&
    tally.totalVoters / activeMemberCount >= quorumPercentage;
  const passed = quorumMet && tally.totalWeightFor > tally.totalWeightAgainst;
  return { ...tally, quorumMet, passed };
}

/** Linear reputation weight (1:1). */
function linearWeight(governanceWeight: number): number {
  return Math.max(0, governanceWeight);
}

/** Quadratic vote weight: sqrt(governance_weight). */
function quadraticWeight(rawReputation: number): number {
  return Math.sqrt(Math.max(0, rawReputation));
}

/**
 * Conviction weight: governance_weight x time_held_hours (simplified).
 * time_held_hours is approximated as the hours since the voter joined the DFAO.
 */
function convictionWeight(governanceWeight: number, joinedAtIso: string): number {
  const hoursHeld = (Date.now() - new Date(joinedAtIso).getTime()) / 3_600_000;
  return Math.max(0, governanceWeight) * Math.max(1, hoursHeld);
}

/**
 * Proposal threshold formula:
 *   threshold = log(memberCount) x complexityFactor x impactRadiusMultiplier
 */
function calculateProposalThreshold(
  memberCount: number,
  complexityFactor: number,
  impactRadiusMultiplier: number,
): number {
  return Math.log(Math.max(1, memberCount)) * complexityFactor * impactRadiusMultiplier;
}

// ── Row mappers ───────────────────────────────────────────────────────────────────────────

function proposalFromRow(row: any): GovernanceProposal {
  return {
    id: row.id as ProposalId,
    dfaoId: row.dfao_id as DFAOId,
    type: row.type as ProposalType,
    title: row.title,
    description: row.description,
    changes: row.changes || [],
    proposerId: row.proposer_id as ValidatorId,
    status: row.status as ProposalStatus,
    deliberationStartedAt: row.deliberation_started_at
      ? new Date(row.deliberation_started_at).toISOString()
      : null,
    votingStartedAt: row.voting_started_at
      ? new Date(row.voting_started_at).toISOString()
      : null,
    votingDeadline: row.voting_deadline
      ? new Date(row.voting_deadline).toISOString()
      : null,
    votes: row.votes || [],
    tally: row.tally || {
      totalWeightFor: 0,
      totalWeightAgainst: 0,
      totalWeightAbstain: 0,
      totalVoters: 0,
      quorumMet: false,
      passed: false,
    },
    requiredQuorum: row.required_quorum ?? 0,
    proposalThreshold: row.proposal_threshold ?? 0,
    vertexId: (row.vertex_id || '') as VertexId,
    seasonId: (row.season_id || '') as SeasonId,
    createdAt: new Date(row.created_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
  };
}

function voteFromRow(row: any): GovernanceVote {
  return {
    proposalId: row.proposal_id as ProposalId,
    voterId: row.voter_id as ValidatorId,
    dfaoId: row.dfao_id as DFAOId,
    vote: row.vote as 'approve' | 'reject' | 'abstain',
    weight: row.weight,
    rawReputation: row.raw_reputation,
    justification: row.justification || undefined,
    vertexId: (row.vertex_id || '') as VertexId,
    timestamp: new Date(row.timestamp).toISOString(),
  };
}

// ── DFAO registry helpers ──────────────────────────────────────────────────────────

/** Fetch DFAO details from the registry service. Returns null on failure. */
async function fetchDFAO(dfaoId: DFAOId): Promise<any | null> {
  try {
    const res = await fetch(`${DFAO_REGISTRY_URL}/dfaos/${dfaoId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Fetch a single membership record for a validator in a DFAO. Returns null if not a member. */
async function fetchMembership(dfaoId: DFAOId, validatorId: ValidatorId): Promise<any | null> {
  try {
    const res = await fetch(
      `${DFAO_REGISTRY_URL}/dfaos/${dfaoId}/memberships/${validatorId}`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Fetch all active memberships for a DFAO. Returns empty array on failure. */
async function fetchMemberships(dfaoId: DFAOId): Promise<any[]> {
  try {
    const res = await fetch(`${DFAO_REGISTRY_URL}/dfaos/${dfaoId}/memberships`);
    if (!res.ok) return [];
    return (await res.json()) as any[];
  } catch {
    return [];
  }
}

// ── Internal resolve helper ──────────────────────────────────────────────────────────

/**
 * Resolve a proposal: compute final tally, determine pass/fail, persist, emit events.
 * Can be called from the explicit /resolve endpoint or auto-triggered after a vote.
 */
async function resolveProposal(proposalId: ProposalId): Promise<GovernanceProposal> {
  const propRes = await pool.query(
    'SELECT * FROM governance.proposals WHERE id = $1',
    [proposalId],
  );
  if (propRes.rows.length === 0) throw new Error('Proposal not found');
  const proposal = proposalFromRow(propRes.rows[0]);

  if (
    proposal.status !== ProposalStatus.VOTING &&
    proposal.status !== ProposalStatus.PASSED &&
    proposal.status !== ProposalStatus.REJECTED
  ) {
    throw new Error(`Cannot resolve proposal in status: ${proposal.status}`);
  }

  // Fetch all votes
  const votesRes = await pool.query(
    'SELECT * FROM governance.votes WHERE proposal_id = $1',
    [proposalId],
  );
  const votes: GovernanceVote[] = votesRes.rows.map(voteFromRow);

  // Compute raw tally
  const rawTally = calculateTally(votes);

  // Get active member count from DFAO registry
  const memberships = await fetchMemberships(proposal.dfaoId);
  const activeMemberCount = memberships.filter((m: any) => m.status === 'active').length;

  // Resolve quorum using DFAO's governance config
  let quorumPercentage = 0.5; // sensible default
  const dfao = await fetchDFAO(proposal.dfaoId);
  if (dfao?.governanceConfig?.quorumPercentage != null) {
    quorumPercentage = dfao.governanceConfig.quorumPercentage;
  }

  const finalTally = resolveQuorum(rawTally, activeMemberCount, quorumPercentage);

  const newStatus = finalTally.passed ? ProposalStatus.PASSED : ProposalStatus.REJECTED;
  const now = new Date().toISOString();

  await pool.query(
    `UPDATE governance.proposals
     SET status = $1, tally = $2, resolved_at = $3, votes = $4
     WHERE id = $5`,
    [newStatus, JSON.stringify(finalTally), now, JSON.stringify(votes), proposalId],
  );

  const updatedRes = await pool.query(
    'SELECT * FROM governance.proposals WHERE id = $1',
    [proposalId],
  );
  const resolved = proposalFromRow(updatedRes.rows[0]);

  // Emit outcome event
  if (newStatus === ProposalStatus.PASSED) {
    await bus.emit(
      EventType.PROPOSAL_PASSED,
      proposalId as unknown as LoopId,
      {
        proposalId,
        dfaoId: resolved.dfaoId,
        tally: finalTally,
      } as ProposalPassedPayload,
    );
    console.log(`[governance] Proposal ${proposalId} PASSED`);
  } else {
    const rejectionReason = !finalTally.quorumMet
      ? 'Quorum not reached'
      : 'Majority voted against';
    await bus.emit(
      EventType.PROPOSAL_REJECTED,
      proposalId as unknown as LoopId,
      {
        proposalId,
        dfaoId: resolved.dfaoId,
        tally: finalTally,
        reason: rejectionReason,
      } as ProposalRejectedPayload,
    );
    console.log(`[governance] Proposal ${proposalId} REJECTED: ${rejectionReason}`);
  }

  return resolved;
}

// ── Health ────────────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  const health: ServiceHealthResponse = {
    service: SERVICE,
    status: 'healthy',
    version: '0.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: {
      'dfao-registry': 'connected',
    } as Record<ServiceName, 'connected' | 'disconnected'>,
  };
  res.json(health);
});

// ── POST /proposals ───────────────────────────────────────────────────────────────────────────

app.post('/proposals', async (req, res) => {
  try {
    const { dfaoId, type, title, description, changes, proposerId } = req.body;

    if (!dfaoId || !type || !title || !description || !proposerId) {
      res.status(400).json({
        error: 'Missing required fields: dfaoId, type, title, description, proposerId',
        code: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Validate proposal type
    if (!Object.values(ProposalType).includes(type)) {
      res.status(400).json({
        error: `Invalid proposal type: ${type}`,
        code: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Fetch DFAO to validate membership and get governance config
    const dfao = await fetchDFAO(dfaoId as DFAOId);
    if (!dfao) {
      res.status(404).json({
        error: `DFAO not found: ${dfaoId}`,
        code: 'DFAO_NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Validate proposer is a member
    const membership = await fetchMembership(dfaoId as DFAOId, proposerId as ValidatorId);
    if (!membership || membership.status !== 'active') {
      res.status(403).json({
        error: 'Proposer is not an active member of this DFAO',
        code: 'NOT_A_MEMBER',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Calculate proposal threshold
    const { complexityFactor, impactRadiusMultiplier } =
      dfao.governanceConfig?.proposalThresholdParams ?? {
        complexityFactor: 1,
        impactRadiusMultiplier: 1,
      };
    const memberCount: number = dfao.memberCount ?? 1;
    const threshold = calculateProposalThreshold(
      memberCount,
      complexityFactor,
      impactRadiusMultiplier,
    );

    // Check proposer's governance weight meets threshold
    const proposerWeight: number = membership.governanceWeight ?? 0;
    if (proposerWeight < threshold) {
      res.status(403).json({
        error: `Proposer's governance weight (${proposerWeight.toFixed(2)}) does not meet proposal threshold (${threshold.toFixed(2)})`,
        code: 'INSUFFICIENT_GOVERNANCE_WEIGHT',
        details: { proposerWeight, threshold },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const proposalId = uuidv4() as ProposalId;
    const now = new Date().toISOString();
    const emptyTally: GovernanceTally = {
      totalWeightFor: 0,
      totalWeightAgainst: 0,
      totalWeightAbstain: 0,
      totalVoters: 0,
      quorumMet: false,
      passed: false,
    };

    await pool.query(
      `INSERT INTO governance.proposals
         (id, dfao_id, type, title, description, changes, proposer_id, status, tally,
          required_quorum, proposal_threshold, votes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        proposalId,
        dfaoId,
        type,
        title,
        description,
        JSON.stringify(changes || []),
        proposerId,
        ProposalStatus.DRAFT,
        JSON.stringify(emptyTally),
        dfao.governanceConfig?.quorumPercentage ?? 0.5,
        threshold,
        JSON.stringify([]),
        now,
      ],
    );

    const propRes = await pool.query(
      'SELECT * FROM governance.proposals WHERE id = $1',
      [proposalId],
    );
    const proposal = proposalFromRow(propRes.rows[0]);

    await bus.emit(
      EventType.PROPOSAL_CREATED,
      proposalId as unknown as LoopId,
      { proposal } as ProposalCreatedPayload,
    );

    console.log(`[governance] Proposal ${proposalId} CREATED (type=${type}, dfao=${dfaoId})`);
    res.status(201).json(proposal);
  } catch (err: any) {
    console.error('[governance] POST /proposals error:', err);
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── POST /proposals/:id/deliberation ─────────────────────────────────────────────────

app.post('/proposals/:id/deliberation', async (req, res) => {
  try {
    const proposalId = req.params.id as ProposalId;

    const propRes = await pool.query(
      'SELECT * FROM governance.proposals WHERE id = $1',
      [proposalId],
    );
    if (propRes.rows.length === 0) {
      res.status(404).json({
        error: 'Proposal not found',
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const proposal = proposalFromRow(propRes.rows[0]);

    if (proposal.status !== ProposalStatus.DRAFT) {
      res.status(409).json({
        error: `Proposal must be in DRAFT status to start deliberation, current: ${proposal.status}`,
        code: 'INVALID_STATUS_TRANSITION',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Fetch DFAO for deliberation_period_hours
    const dfao = await fetchDFAO(proposal.dfaoId);
    const deliberationPeriodHours: number =
      dfao?.governanceConfig?.deliberationPeriodHours ?? 24;

    const now = new Date();
    const votingDeadlineMs =
      now.getTime() + deliberationPeriodHours * 3_600_000;
    const votingDeadline = new Date(votingDeadlineMs).toISOString();

    await pool.query(
      `UPDATE governance.proposals
       SET status = $1, deliberation_started_at = $2, voting_deadline = $3
       WHERE id = $4`,
      [ProposalStatus.DELIBERATION, now.toISOString(), votingDeadline, proposalId],
    );

    const updated = await pool.query(
      'SELECT * FROM governance.proposals WHERE id = $1',
      [proposalId],
    );
    const updatedProposal = proposalFromRow(updated.rows[0]);

    console.log(
      `[governance] Proposal ${proposalId} entered DELIBERATION ` +
      `(voting_deadline=${votingDeadline})`,
    );
    res.json(updatedProposal);
  } catch (err: any) {
    console.error('[governance] POST /proposals/:id/deliberation error:', err);
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── POST /proposals/:id/voting ────────────────────────────────────────────────────────────────────

app.post('/proposals/:id/voting', async (req, res) => {
  try {
    const proposalId = req.params.id as ProposalId;

    const propRes = await pool.query(
      'SELECT * FROM governance.proposals WHERE id = $1',
      [proposalId],
    );
    if (propRes.rows.length === 0) {
      res.status(404).json({
        error: 'Proposal not found',
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const proposal = proposalFromRow(propRes.rows[0]);

    if (proposal.status !== ProposalStatus.DELIBERATION) {
      res.status(409).json({
        error: `Proposal must be in DELIBERATION status to start voting, current: ${proposal.status}`,
        code: 'INVALID_STATUS_TRANSITION',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Validate deliberation period has passed
    if (!proposal.deliberationStartedAt) {
      res.status(409).json({
        error: 'Deliberation has not been started',
        code: 'DELIBERATION_NOT_STARTED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const dfao = await fetchDFAO(proposal.dfaoId);
    const deliberationPeriodHours: number =
      dfao?.governanceConfig?.deliberationPeriodHours ?? 24;
    const deliberationEndMs =
      new Date(proposal.deliberationStartedAt).getTime() +
      deliberationPeriodHours * 3_600_000;

    if (Date.now() < deliberationEndMs) {
      const hoursRemaining = ((deliberationEndMs - Date.now()) / 3_600_000).toFixed(1);
      res.status(409).json({
        error: `Deliberation period has not ended yet. ${hoursRemaining} hours remaining.`,
        code: 'DELIBERATION_PERIOD_ACTIVE',
        details: { hoursRemaining },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const now = new Date();
    // Voting deadline: deliberation end + another deliberation period (or use the already-set one)
    const votingDeadlineMs =
      deliberationEndMs + deliberationPeriodHours * 3_600_000;
    const votingDeadline = new Date(votingDeadlineMs).toISOString();

    await pool.query(
      `UPDATE governance.proposals
       SET status = $1, voting_started_at = $2, voting_deadline = $3
       WHERE id = $4`,
      [ProposalStatus.VOTING, now.toISOString(), votingDeadline, proposalId],
    );

    const updated = await pool.query(
      'SELECT * FROM governance.proposals WHERE id = $1',
      [proposalId],
    );
    const updatedProposal = proposalFromRow(updated.rows[0]);

    await bus.emit(
      EventType.PROPOSAL_VOTING_STARTED,
      proposalId as unknown as LoopId,
      {
        proposalId,
        dfaoId: updatedProposal.dfaoId,
        votingDeadline,
      } as ProposalVotingStartedPayload,
    );

    console.log(`[governance] Proposal ${proposalId} entered VOTING (deadline=${votingDeadline})`);
    res.json(updatedProposal);
  } catch (err: any) {
    console.error('[governance] POST /proposals/:id/voting error:', err);
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── POST /proposals/:id/votes ────────────────────────────────────────────────────────────────────

app.post('/proposals/:id/votes', async (req, res) => {
  try {
    const proposalId = req.params.id as ProposalId;
    const { voterId, vote, justification } = req.body;

    if (!voterId || !vote) {
      res.status(400).json({
        error: 'Missing required fields: voterId, vote',
        code: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!['approve', 'reject', 'abstain'].includes(vote)) {
      res.status(400).json({
        error: `Invalid vote value: ${vote}. Must be approve, reject, or abstain`,
        code: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const propRes = await pool.query(
      'SELECT * FROM governance.proposals WHERE id = $1',
      [proposalId],
    );
    if (propRes.rows.length === 0) {
      res.status(404).json({
        error: 'Proposal not found',
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const proposal = proposalFromRow(propRes.rows[0]);

    // Validate proposal is in VOTING status
    if (proposal.status !== ProposalStatus.VOTING) {
      res.status(409).json({
        error: `Proposal is not in VOTING status, current: ${proposal.status}`,
        code: 'VOTING_NOT_ACTIVE',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Validate voting deadline has not passed
    if (proposal.votingDeadline && new Date() > new Date(proposal.votingDeadline)) {
      res.status(409).json({
        error: 'Voting deadline has passed',
        code: 'VOTING_DEADLINE_PASSED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Validate voter is an active DFAO member
    const membership = await fetchMembership(proposal.dfaoId, voterId as ValidatorId);
    if (!membership || membership.status !== 'active') {
      res.status(403).json({
        error: 'Voter is not an active member of this DFAO',
        code: 'NOT_A_MEMBER',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Validate voter has not already voted
    const existingVoteRes = await pool.query(
      'SELECT id FROM governance.votes WHERE proposal_id = $1 AND voter_id = $2',
      [proposalId, voterId],
    );
    if (existingVoteRes.rows.length > 0) {
      res.status(409).json({
        error: 'Voter has already cast a vote on this proposal',
        code: 'ALREADY_VOTED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Fetch DFAO for voting method config
    const dfao = await fetchDFAO(proposal.dfaoId);
    const votingMethod: string =
      dfao?.governanceConfig?.votingMethod ?? 'linear_reputation';
    const rawReputation: number = membership.governanceWeight ?? 0;

    // Calculate vote weight based on voting method
    let weight: number;
    switch (votingMethod) {
      case 'quadratic':
        weight = quadraticWeight(rawReputation);
        break;
      case 'conviction':
        weight = convictionWeight(rawReputation, membership.joinedAt);
        break;
      case 'linear_reputation':
      default:
        weight = linearWeight(rawReputation);
        break;
    }

    const voteId = uuidv4();
    const now = new Date().toISOString();

    await pool.query(
      `INSERT INTO governance.votes
         (id, proposal_id, voter_id, dfao_id, vote, weight, raw_reputation, justification, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        voteId,
        proposalId,
        voterId,
        proposal.dfaoId,
        vote,
        weight,
        rawReputation,
        justification || null,
        now,
      ],
    );

    // Reload all votes to compute updated tally
    const allVotesRes = await pool.query(
      'SELECT * FROM governance.votes WHERE proposal_id = $1',
      [proposalId],
    );
    const allVotes: GovernanceVote[] = allVotesRes.rows.map(voteFromRow);
    const rawTally = calculateTally(allVotes);

    // Resolve quorum to check for auto-resolution
    const memberships = await fetchMemberships(proposal.dfaoId);
    const activeMemberCount = memberships.filter((m: any) => m.status === 'active').length;
    const quorumPercentage: number =
      dfao?.governanceConfig?.quorumPercentage ?? 0.5;
    const currentTally = resolveQuorum(rawTally, activeMemberCount, quorumPercentage);

    // Persist updated tally and votes snapshot on proposal
    await pool.query(
      `UPDATE governance.proposals SET tally = $1, votes = $2 WHERE id = $3`,
      [JSON.stringify(currentTally), JSON.stringify(allVotes), proposalId],
    );

    const castVote = voteFromRow(allVotesRes.rows.find((r: any) => r.id === voteId));

    await bus.emit(
      EventType.GOVERNANCE_VOTE_CAST,
      proposalId as unknown as LoopId,
      {
        vote: castVote,
        currentTally,
      } as GovernanceVoteCastPayload,
    );

    console.log(
      `[governance] Vote cast on ${proposalId} by ${voterId} ` +
      `(vote=${vote}, weight=${weight.toFixed(4)})`,
    );

    // Auto-resolve if quorum met and clear majority
    if (currentTally.quorumMet) {
      console.log(`[governance] Quorum met for proposal ${proposalId} -- auto-resolving`);
      try {
        const resolved = await resolveProposal(proposalId);
        res.status(201).json({ vote: castVote, tally: resolved.tally, autoResolved: true });
        return;
      } catch (resolveErr: any) {
        console.error(`[governance] Auto-resolve failed for ${proposalId}:`, resolveErr);
      }
    }

    res.status(201).json({ vote: castVote, tally: currentTally });
  } catch (err: any) {
    console.error('[governance] POST /proposals/:id/votes error:', err);
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── POST /proposals/:id/resolve ───────────────────────────────────────────────────────────────────

app.post('/proposals/:id/resolve', async (req, res) => {
  try {
    const proposalId = req.params.id as ProposalId;
    const resolved = await resolveProposal(proposalId);
    res.json(resolved);
  } catch (err: any) {
    console.error('[governance] POST /proposals/:id/resolve error:', err);
    const status = err.message === 'Proposal not found' ? 404 : 500;
    res.status(status).json({
      error: err.message,
      code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── POST /proposals/:id/implement ──────────────────────────────────────────────────────────────────

app.post('/proposals/:id/implement', async (req, res) => {
  try {
    const proposalId = req.params.id as ProposalId;

    const propRes = await pool.query(
      'SELECT * FROM governance.proposals WHERE id = $1',
      [proposalId],
    );
    if (propRes.rows.length === 0) {
      res.status(404).json({
        error: 'Proposal not found',
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const proposal = proposalFromRow(propRes.rows[0]);

    if (proposal.status !== ProposalStatus.PASSED) {
      res.status(409).json({
        error: `Only PASSED proposals can be implemented, current status: ${proposal.status}`,
        code: 'PROPOSAL_NOT_PASSED',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const implementedChanges: ProposalChange[] = [];

    if (proposal.type === ProposalType.PARAMETER_CHANGE) {
      // Apply each change to governance.parameters
      for (const change of proposal.changes) {
        await pool.query(
          `INSERT INTO governance.parameters (key, value, updated_at, updated_by_proposal_id)
           VALUES ($1, $2, NOW(), $3)
           ON CONFLICT (key) DO UPDATE
             SET value = $2, updated_at = NOW(), updated_by_proposal_id = $3`,
          [
            change.target,
            JSON.stringify(change.proposedValue),
            proposalId,
          ],
        );
        implementedChanges.push(change);
        console.log(`[governance] Parameter updated: ${change.target} => ${JSON.stringify(change.proposedValue)}`);
      }
    } else if (proposal.type === ProposalType.MEMBERSHIP_ACTION) {
      // Delegate member actions to DFAO registry
      for (const change of proposal.changes) {
        try {
          const memberActionRes = await fetch(
            `${DFAO_REGISTRY_URL}/dfaos/${proposal.dfaoId}/membership-actions`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: change.target,
                value: change.proposedValue,
                proposalId,
              }),
            },
          );
          if (memberActionRes.ok) {
            implementedChanges.push(change);
          } else {
            console.warn(
              `[governance] Membership action failed for change ${change.target}: ${memberActionRes.status}`,
            );
          }
        } catch (actionErr) {
          console.error(`[governance] Error executing membership action ${change.target}:`, actionErr);
        }
      }
    } else {
      // For all other proposal types, record the changes as implemented
      implementedChanges.push(...proposal.changes);
    }

    await pool.query(
      `UPDATE governance.proposals SET status = $1 WHERE id = $2`,
      [ProposalStatus.IMPLEMENTED, proposalId],
    );

    const updatedRes = await pool.query(
      'SELECT * FROM governance.proposals WHERE id = $1',
      [proposalId],
    );
    const implemented = proposalFromRow(updatedRes.rows[0]);

    await bus.emit(
      EventType.PROPOSAL_IMPLEMENTED,
      proposalId as unknown as LoopId,
      {
        proposalId,
        dfaoId: implemented.dfaoId,
        changes: implementedChanges,
      } as ProposalImplementedPayload,
    );

    console.log(
      `[governance] Proposal ${proposalId} IMPLEMENTED ` +
      `(${implementedChanges.length} change(s))`,
    );
    res.json({ proposal: implemented, implementedChanges });
  } catch (err: any) {
    console.error('[governance] POST /proposals/:id/implement error:', err);
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── POST /proposals/:id/veto ──────────────────────────────────────────────────────────────────────

app.post('/proposals/:id/veto', async (req, res) => {
  try {
    const proposalId = req.params.id as ProposalId;
    const { initiatorId, description } = req.body;

    if (!initiatorId) {
      res.status(400).json({
        error: 'Missing required field: initiatorId',
        code: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const propRes = await pool.query(
      'SELECT * FROM governance.proposals WHERE id = $1',
      [proposalId],
    );
    if (propRes.rows.length === 0) {
      res.status(404).json({
        error: 'Proposal not found',
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const proposal = proposalFromRow(propRes.rows[0]);

    // Cannot veto terminal states
    if (
      proposal.status === ProposalStatus.IMPLEMENTED ||
      proposal.status === ProposalStatus.VETOED ||
      proposal.status === ProposalStatus.EXPIRED
    ) {
      res.status(409).json({
        error: `Cannot veto proposal in status: ${proposal.status}`,
        code: 'INVALID_STATUS_TRANSITION',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Validate initiator has sufficient reputation for emergency threshold
    const dfao = await fetchDFAO(proposal.dfaoId);
    const emergencyThreshold: number =
      dfao?.governanceConfig?.emergencyThreshold ?? 0.8;

    const membership = await fetchMembership(
      proposal.dfaoId,
      initiatorId as ValidatorId,
    );
    if (!membership || membership.status !== 'active') {
      res.status(403).json({
        error: 'Veto initiator is not an active member of this DFAO',
        code: 'NOT_A_MEMBER',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Compute initiator's share of total governance weight (simplified emergency check)
    const allMemberships = await fetchMemberships(proposal.dfaoId);
    const totalWeight = allMemberships.reduce(
      (sum: number, m: any) => sum + (m.governanceWeight ?? 0),
      0,
    );
    const initiatorWeight: number = membership.governanceWeight ?? 0;
    const initiatorFraction = totalWeight > 0 ? initiatorWeight / totalWeight : 0;

    if (initiatorFraction < emergencyThreshold) {
      res.status(403).json({
        error:
          `Initiator's governance weight fraction (${(initiatorFraction * 100).toFixed(1)}%) ` +
          `is below the emergency threshold (${(emergencyThreshold * 100).toFixed(1)}%)`,
        code: 'INSUFFICIENT_EMERGENCY_AUTHORITY',
        details: { initiatorFraction, emergencyThreshold },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    await pool.query(
      `UPDATE governance.proposals SET status = $1, resolved_at = NOW() WHERE id = $2`,
      [ProposalStatus.VETOED, proposalId],
    );

    const updatedRes = await pool.query(
      'SELECT * FROM governance.proposals WHERE id = $1',
      [proposalId],
    );
    const vetoed = proposalFromRow(updatedRes.rows[0]);

    await bus.emit(
      EventType.EMERGENCY_INTERVENTION,
      proposalId as unknown as LoopId,
      {
        dfaoId: vetoed.dfaoId,
        proposalId,
        triggeredByValidatorId: initiatorId as ValidatorId,
        description: description || `Emergency veto of proposal ${proposalId}`,
      } as EmergencyInterventionPayload,
    );

    console.log(
      `[governance] Proposal ${proposalId} VETOED by ${initiatorId}`,
    );
    res.json(vetoed);
  } catch (err: any) {
    console.error('[governance] POST /proposals/:id/veto error:', err);
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── GET /proposals/:id ──────────────────────────────────────────────────────────────────────────

app.get('/proposals/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM governance.proposals WHERE id = $1',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({
        error: 'Proposal not found',
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    res.json(proposalFromRow(result.rows[0]));
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── GET /proposals ────────────────────────────────────────────────────────────────────────────

app.get('/proposals', async (req, res) => {
  try {
    let query = 'SELECT * FROM governance.proposals WHERE 1=1';
    const params: any[] = [];
    let idx = 0;

    if (req.query.dfaoId) {
      idx++;
      query += ` AND dfao_id = $${idx}`;
      params.push(req.query.dfaoId);
    }
    if (req.query.status) {
      idx++;
      query += ` AND status = $${idx}`;
      params.push(req.query.status);
    }
    if (req.query.type) {
      idx++;
      query += ` AND type = $${idx}`;
      params.push(req.query.type);
    }
    if (req.query.seasonId) {
      idx++;
      query += ` AND season_id = $${idx}`;
      params.push(req.query.seasonId);
    }

    // Count total for pagination
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM governance.proposals WHERE 1=1` +
        (req.query.dfaoId ? ` AND dfao_id = '${String(req.query.dfaoId).replace(/'/g, "''")}'` : '') +
        (req.query.status ? ` AND status = '${String(req.query.status).replace(/'/g, "''")}'` : '') +
        (req.query.type ? ` AND type = '${String(req.query.type).replace(/'/g, "''")}'` : '') +
        (req.query.seasonId ? ` AND season_id = '${String(req.query.seasonId).replace(/'/g, "''")}'` : ''),
    );
    const total = parseInt(countResult.rows[0].count, 10);

    // Pagination
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
    const offset = (page - 1) * pageSize;

    idx++;
    query += ` ORDER BY created_at DESC LIMIT $${idx}`;
    params.push(pageSize);
    idx++;
    query += ` OFFSET $${idx}`;
    params.push(offset);

    const result = await pool.query(query, params);
    const response: PaginatedResponse<GovernanceProposal> = {
      data: result.rows.map(proposalFromRow),
      total,
      page,
      pageSize,
      hasMore: offset + result.rows.length < total,
    };

    res.json(response);
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── GET /proposals/:id/votes ────────────────────────────────────────────────────────────────────

app.get('/proposals/:id/votes', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM governance.votes WHERE proposal_id = $1 ORDER BY timestamp ASC',
      [req.params.id],
    );
    res.json(result.rows.map(voteFromRow));
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── GET /parameters ───────────────────────────────────────────────────────────────────────────

app.get('/parameters', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM governance.parameters ORDER BY key ASC',
    );
    // Return as a key=>value map for convenience
    const params: Record<string, unknown> = {};
    for (const row of result.rows) {
      try {
        params[row.key] = JSON.parse(row.value);
      } catch {
        params[row.key] = row.value;
      }
    }
    res.json(params);
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── GET /parameters/:key ──────────────────────────────────────────────────────────────────────

app.get('/parameters/:key', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM governance.parameters WHERE key = $1',
      [req.params.key],
    );
    if (result.rows.length === 0) {
      res.status(404).json({
        error: `Parameter not found: ${req.params.key}`,
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    const row = result.rows[0];
    let value: unknown;
    try {
      value = JSON.parse(row.value);
    } catch {
      value = row.value;
    }
    res.json({
      key: row.key,
      value,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      updatedByProposalId: row.updated_by_proposal_id || null,
    });
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── POST /parameters/bulk-update ────────────────────────────────────────────────────────────

app.post('/parameters/bulk-update', async (req, res) => {
  try {
    const { updates, proposalId } = req.body as {
      updates: Array<{ key: string; value: unknown }>;
      proposalId?: string;
    };

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({
        error: 'Missing or empty updates array',
        code: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const applied: string[] = [];
    for (const { key, value } of updates) {
      if (!key) continue;
      await pool.query(
        `INSERT INTO governance.parameters (key, value, updated_at, updated_by_proposal_id)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (key) DO UPDATE
           SET value = $2, updated_at = NOW(), updated_by_proposal_id = $3`,
        [key, JSON.stringify(value), proposalId || null],
      );
      applied.push(key);
    }

    console.log(
      `[governance] Bulk parameter update: ${applied.join(', ')}` +
      (proposalId ? ` (proposal=${proposalId})` : ''),
    );
    res.json({ applied, count: applied.length });
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── POST /events ────────────────────────────────────────────────────────────────────────────

app.post('/events', async (req, res) => {
  try {
    const event = req.body as DomainEvent;
    console.log(`[governance] Received event: ${event.type}`);
    await handleEvent(event);
    res.status(202).send();
  } catch (err: any) {
    console.error('[governance] Event handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Event handler ──────────────────────────────────────────────────────────────────────────

async function handleEvent(event: DomainEvent): Promise<void> {
  switch (event.type) {
    case EventType.SEASON_ENDED: {
      const payload = event.payload as SeasonEndedPayload;
      const seasonId = payload.season.id;
      console.log(`[governance] Season ${seasonId} ended -- expiring active VOTING proposals`);

      // Find all proposals in VOTING status that belong to this season
      const expireRes = await pool.query(
        `UPDATE governance.proposals
         SET status = $1, resolved_at = NOW()
         WHERE status = $2 AND season_id = $3
         RETURNING id`,
        [ProposalStatus.EXPIRED, ProposalStatus.VOTING, seasonId],
      );

      if (expireRes.rowCount && expireRes.rowCount > 0) {
        const expiredIds = expireRes.rows.map((r: any) => r.id).join(', ');
        console.log(`[governance] Expired ${expireRes.rowCount} proposal(s): ${expiredIds}`);
      }

      // Also expire any DELIBERATION proposals for this season
      const expireDelibRes = await pool.query(
        `UPDATE governance.proposals
         SET status = $1, resolved_at = NOW()
         WHERE status = $2 AND season_id = $3
         RETURNING id`,
        [ProposalStatus.EXPIRED, ProposalStatus.DELIBERATION, seasonId],
      );
      if (expireDelibRes.rowCount && expireDelibRes.rowCount > 0) {
        console.log(
          `[governance] Expired ${expireDelibRes.rowCount} deliberation proposal(s) from season ${seasonId}`,
        );
      }
      break;
    }

    default:
      break;
  }
}

// ── Database schema initialisation ────────────────────────────────────────────────────────────

async function ensureSchema(): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS governance`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS governance.proposals (
      id                    TEXT PRIMARY KEY,
      dfao_id               TEXT NOT NULL,
      type                  TEXT NOT NULL,
      title                 TEXT NOT NULL,
      description           TEXT NOT NULL,
      changes               JSONB NOT NULL DEFAULT '[]',
      proposer_id           TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'draft',
      deliberation_started_at TIMESTAMPTZ,
      voting_started_at     TIMESTAMPTZ,
      voting_deadline       TIMESTAMPTZ,
      votes                 JSONB NOT NULL DEFAULT '[]',
      tally                 JSONB NOT NULL DEFAULT '{}',
      required_quorum       NUMERIC NOT NULL DEFAULT 0.5,
      proposal_threshold    NUMERIC NOT NULL DEFAULT 0,
      vertex_id             TEXT,
      season_id             TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at           TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_proposals_dfao_id
      ON governance.proposals (dfao_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_proposals_status
      ON governance.proposals (status)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_proposals_season_id
      ON governance.proposals (season_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS governance.votes (
      id             TEXT PRIMARY KEY,
      proposal_id    TEXT NOT NULL REFERENCES governance.proposals(id),
      voter_id       TEXT NOT NULL,
      dfao_id        TEXT NOT NULL,
      vote           TEXT NOT NULL,
      weight         NUMERIC NOT NULL DEFAULT 0,
      raw_reputation NUMERIC NOT NULL DEFAULT 0,
      justification  TEXT,
      vertex_id      TEXT,
      timestamp      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (proposal_id, voter_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_votes_proposal_id
      ON governance.votes (proposal_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS governance.parameters (
      key                    TEXT PRIMARY KEY,
      value                  TEXT NOT NULL,
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_proposal_id TEXT
    )
  `);

  console.log('[governance] Schema ready');
}

// ── Start ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await waitForPostgres(pool);
  await waitForRedis(redis);
  await ensureSchema();
  await bus.start();

  // Subscribe to SEASON_ENDED via Redis pub/sub
  bus.on(EventType.SEASON_ENDED, async (event) => {
    await handleEvent(event as DomainEvent);
  });

  app.listen(PORT, () => {
    console.log(`[governance] listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[governance] Fatal startup error:', err);
  process.exit(1);
});

export default app;
