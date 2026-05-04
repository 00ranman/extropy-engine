/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Shared Domain Contracts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Core formula:  XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 *
 *  Where:
 *    R   = Validator reputation (compressed evidence of past accuracy)
 *    F   = Feedback closure strength [0,1]
 *    ΔS  = Net entropy reduction (Joule/Kelvin) across a closed causal loop
 *    w   = Domain-authority weight vector
 *    E   = Essentiality factor (how critical the task is to the loop)
 *    Tₛ  = Settlement time (time to close the verification loop)
 *
 *  Invariant: XP is minted if and only if a Loop closes with verified ΔS > 0.
 *             No loop closure → no value → no mint.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Primitives & Identifiers
// ─────────────────────────────────────────────────────────────────────────────

/** Branded ID types to prevent accidental cross-assignment */
export type LoopId        = string & { readonly __brand: 'LoopId' };
export type ClaimId       = string & { readonly __brand: 'ClaimId' };
export type SubClaimId    = string & { readonly __brand: 'SubClaimId' };
export type ValidatorId   = string & { readonly __brand: 'ValidatorId' };
export type TaskId        = string & { readonly __brand: 'TaskId' };
export type MintEventId   = string & { readonly __brand: 'MintEventId' };
export type MeasurementId = string & { readonly __brand: 'MeasurementId' };

/** ISO-8601 timestamp string */
export type Timestamp = string;

/** Entropy domain categories — each has its own measurement protocol & c_L */
export enum EntropyDomain {
  COGNITIVE      = 'cognitive',
  CODE           = 'code',
  SOCIAL         = 'social',
  ECONOMIC       = 'economic',
  THERMODYNAMIC  = 'thermodynamic',
  INFORMATIONAL  = 'informational',
  GOVERNANCE     = 'governance',
  TEMPORAL       = 'temporal',
}

/**
 * Domain-specific causal-closure speeds.
 * c_L² appears in the denominator of the irreducible form XP = ΔS / c_L².
 * Higher c_L → faster expected closure → lower XP per unit ΔS (easier loops).
 */
export const CAUSAL_CLOSURE_SPEEDS: Record<EntropyDomain, number> = {
  [EntropyDomain.COGNITIVE]:     1e-6,
  [EntropyDomain.CODE]:          1e-4,
  [EntropyDomain.SOCIAL]:        1e-3,
  [EntropyDomain.ECONOMIC]:      1e-2,
  [EntropyDomain.THERMODYNAMIC]: 1e-4,
  [EntropyDomain.INFORMATIONAL]: 1e-5,
  [EntropyDomain.GOVERNANCE]:    1e-3,
  [EntropyDomain.TEMPORAL]:      1e-6,
};

// ─────────────────────────────────────────────────────────────────────────────
//  Entropy Measurement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single entropy measurement taken at a point in time.
 * Two measurements (before/after) are needed to compute ΔS for a loop.
 */
export interface EntropyMeasurement {
  id: MeasurementId;
  loopId: LoopId;
  domain: EntropyDomain;

  /** Raw entropy value in domain-native units (J/K for thermo, bits for info, etc.) */
  value: number;

  /** Measurement uncertainty — feeds into Bayesian updating of claim truth */
  uncertainty: number;

  /** The instrument/method that produced this measurement */
  source: MeasurementSource;

  /** When the measurement was taken */
  timestamp: Timestamp;

  /** Optional raw sensor/tool data for audit trail */
  rawPayload?: Record<string, unknown>;
}

export interface MeasurementSource {
  type: 'sensor' | 'algorithm' | 'human_observation' | 'external_api';
  identifier: string;
  calibrationHash?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Bayesian Priors & Epistemology
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Bayesian prior attached to a claim or sub-claim.
 * The Epistemology Engine maintains and updates these as evidence arrives.
 *
 * v3.1: Beta(α, β) conjugate model is now first-class. Posterior mean is
 * α/(α+β); CI is the 95% credible interval of the Beta posterior itself.
 * Legacy point-estimate fields are preserved so persisted v3.0 records keep
 * working until they roll forward on the next update.
 */
export interface BayesianPrior {
  // ── v3.1 Beta(α, β) conjugate model (canonical) ─────────────────────────────

  /** Pseudo-count of "true" / confirming evidence (α). Optional for v3.0 compat. */
  alpha?: number;

  /** Pseudo-count of "false" / disconfirming evidence (β). Optional for v3.0 compat. */
  beta?: number;

  // ── Legacy v3.0 point-estimate fields (kept for backwards compatibility) ────

  /** P(claim is true) before observing new evidence */
  priorProbability: number;

  /** P(evidence | claim is true) — likelihood */
  likelihood: number;

  /** P(evidence | claim is false) — counter-likelihood */
  counterLikelihood: number;

  /** P(claim is true | evidence) — computed posterior. Under Beta, equals α/(α+β). */
  posteriorProbability: number;

  /** Number of evidence updates applied */
  updateCount: number;

  /** 95% credible interval [lower, upper]. Under Beta, the Beta(α,β) quantiles. */
  confidenceInterval: [number, number];

  /** History of updates for audit trail */
  updateHistory: BayesianUpdate[];
}

export interface BayesianUpdate {
  timestamp: Timestamp;
  evidenceId: MeasurementId | SubClaimId;
  priorBefore: number;
  posteriorAfter: number;
  likelihoodRatio: number;
  /** Beta α before this update (v3.1+). */
  alphaBefore?: number;
  /** Beta β before this update (v3.1+). */
  betaBefore?: number;
  /** Beta α after this update (v3.1+). */
  alphaAfter?: number;
  /** Beta β after this update (v3.1+). */
  betaAfter?: number;
  /** Confidence in [0,1]: how strongly the evidence confirms the claim. Splits into Δα and Δβ. */
  evidenceConfidence?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Claims & Sub-Claims (Epistemology Engine)
// ─────────────────────────────────────────────────────────────────────────────

export enum ClaimStatus {
  /** Just submitted, not yet decomposed */
  SUBMITTED     = 'submitted',
  /** Decomposed into sub-claims, awaiting validation */
  DECOMPOSED    = 'decomposed',
  /** All sub-claims resolved, truth score computed */
  EVALUATED     = 'evaluated',
  /** Claim verified as true — ΔS > 0 confirmed */
  VERIFIED      = 'verified',
  /** Claim falsified — ΔS ≤ 0 or loop failed to close */
  FALSIFIED     = 'falsified',
  /** Gödel boundary hit — cannot be verified internally, isolated */
  UNDECIDABLE   = 'undecidable',
}

/**
 * A top-level claim submitted to the Epistemology Engine.
 *
 * Example: "Refactoring module X reduced code complexity by 40%"
 *
 * The engine decomposes this into verifiable sub-claims, each of which
 * gets its own Bayesian prior and entropy measurements.
 */
export interface Claim {
  id: ClaimId;
  loopId: LoopId;

  /** The natural-language assertion */
  statement: string;

  /** Which entropy domain this claim pertains to */
  domain: EntropyDomain;

  /** Who submitted the claim */
  submitterId: ValidatorId;

  status: ClaimStatus;

  /** Bayesian truth score — updated as sub-claims resolve */
  bayesianPrior: BayesianPrior;

  /** Ordered list of sub-claim IDs (DAG children) */
  subClaimIds: SubClaimId[];

  /** Composite truth score: weighted product of sub-claim posteriors */
  truthScore: number;

  /** Timestamps */
  createdAt: Timestamp;
  updatedAt: Timestamp;

  /** If undecidable, the reason (Gödel boundary, self-reference, etc.) */
  undecidableReason?: string;
}

export enum SubClaimStatus {
  PENDING     = 'pending',
  ASSIGNED    = 'assigned',
  VALIDATING  = 'validating',
  VERIFIED    = 'verified',
  FALSIFIED   = 'falsified',
  UNDECIDABLE = 'undecidable',
}

/**
 * An atomic, verifiable unit decomposed from a parent Claim.
 *
 * Example: "Module X's cyclomatic complexity decreased from 42 to 25"
 *
 * Each sub-claim maps to one or more EntropyMeasurements and
 * has its own Bayesian prior that feeds back into the parent.
 */
export interface SubClaim {
  id: SubClaimId;
  claimId: ClaimId;
  loopId: LoopId;

  /** The atomic assertion to verify */
  statement: string;

  /** Domain inherited from parent claim (can be overridden) */
  domain: EntropyDomain;

  status: SubClaimStatus;

  /** Bayesian prior for this sub-claim specifically */
  bayesianPrior: BayesianPrior;

  /** IDs of measurements that constitute evidence for/against */
  measurementIds: MeasurementId[];

  /** Which validator(s) are assigned to verify this */
  assignedValidatorIds: ValidatorId[];

  /** Weight of this sub-claim in the parent's composite truth score */
  weight: number;

  /** DAG edges: sub-claims this one depends on */
  dependsOn: SubClaimId[];

  createdAt: Timestamp;
  resolvedAt?: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Validators & Reputation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A validator — human or AI agent capable of verifying sub-claims.
 * Reputation is compressed evidence of past verification accuracy.
 */
export interface Validator {
  id: ValidatorId;

  /** Display name / alias */
  name: string;

  /** Whether this is a human or AI validator */
  type: 'human' | 'ai' | 'hybrid';

  /** Domains this validator has demonstrated competence in */
  domains: EntropyDomain[];

  /** Current reputation score object */
  reputation: ReputationScore;

  /** Total XP earned across all loops */
  totalXpEarned: number;

  /** Number of loops participated in */
  loopsParticipated: number;

  /** Number of loops where this validator's assessment matched consensus */
  accurateValidations: number;

  /** Current task load — used by SignalFlow for routing */
  currentTaskCount: number;

  /** Maximum concurrent tasks this validator can handle */
  maxConcurrentTasks: number;

  /** Whether the validator is available for new tasks */
  isActive: boolean;

  createdAt: Timestamp;
  lastActiveAt: Timestamp;
}

/**
 * Reputation is not a simple number — it's a per-domain vector that
 * accrues with successful validations and decays with inactivity.
 *
 *   R_i(t+1) = R_i(t) + α · XP_t   (accrual on success)
 *   R_i(t)   = R_i(t-1) · (1 - γ)  (decay on inactivity)
 *
 * Reputation feeds directly into:
 *   1. SignalFlow routing weights (higher rep → more complex tasks)
 *   2. XP mint formula (R multiplier)
 *   3. Consensus weighting (V+ = Σ R_i for approving validators)
 */
export interface ReputationScore {
  /** Aggregate reputation across all domains */
  aggregate: number;

  /** Per-domain reputation breakdown */
  byDomain: Record<EntropyDomain, number>;

  /** Accrual rate: how fast reputation grows on success */
  accrualRate: number;

  /** Decay rate: how fast reputation erodes with inactivity */
  decayRate: number;

  /** Streak: consecutive successful validations */
  currentStreak: number;

  /** Penalty count — adversarial behavior triggers reputation burns */
  penaltyCount: number;

  /** Last time reputation was recalculated */
  lastUpdatedAt: Timestamp;

  /** Full history of reputation changes */
  history: ReputationEvent[];
}

export interface ReputationEvent {
  timestamp: Timestamp;
  type: 'accrual' | 'decay' | 'penalty' | 'bonus';
  domain: EntropyDomain;
  delta: number;
  reason: string;
  relatedLoopId?: LoopId;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Task Routing (SignalFlow Orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

export enum TaskStatus {
  CREATED     = 'created',
  QUEUED      = 'queued',
  ASSIGNED    = 'assigned',
  IN_PROGRESS = 'in_progress',
  COMPLETED   = 'completed',
  FAILED      = 'failed',
  TIMED_OUT   = 'timed_out',
  REASSIGNED  = 'reassigned',
}

/**
 * A validation task routed by SignalFlow to a specific validator.
 *
 * SignalFlow is invisible UX — validators see tasks appear in their queue
 * without knowing the routing algorithm's internals. Task assignment is
 * weighted by:
 *   - Domain expertise match (validator.domains ∩ subClaim.domain)
 *   - Reputation score in the relevant domain
 *   - Current load (prefer underutilized validators)
 *   - Historical accuracy on similar claims
 */
export interface TaskRouting {
  id: TaskId;
  subClaimId: SubClaimId;
  loopId: LoopId;

  /** The validator this task is routed to */
  assignedValidatorId: ValidatorId;

  status: TaskStatus;

  /** Priority: higher = more urgent. Derived from loop age & essentiality */
  priority: number;

  /** Why this validator was chosen (transparent audit trail) */
  routingReason: RoutingReason;

  /** Deadline: if not completed by this time, task is reassigned */
  deadline: Timestamp;

  /** The validation result, if completed */
  result?: ValidationResult;

  createdAt: Timestamp;
  assignedAt?: Timestamp;
  completedAt?: Timestamp;
}

export interface RoutingReason {
  /** Score breakdown for this routing decision */
  domainMatchScore: number;
  reputationScore: number;
  loadScore: number;
  historicalAccuracyScore: number;

  /** Composite routing weight */
  compositeWeight: number;

  /** Alternative validators considered and their scores */
  alternatives: Array<{
    validatorId: ValidatorId;
    compositeWeight: number;
  }>;
}

export interface ValidationResult {
  /** Did the validator confirm the sub-claim? */
  verdict: 'confirmed' | 'denied' | 'insufficient_evidence' | 'undecidable';

  /** Confidence in the verdict [0, 1] */
  confidence: number;

  /** Evidence provided (measurement IDs, reasoning, etc.) */
  evidenceMeasurementIds: MeasurementId[];

  /** Free-form justification */
  justification: string;

  /** Time spent on validation (seconds) */
  validationDurationSeconds: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Loop (Loop Ledger — the atomic unit of value)
// ─────────────────────────────────────────────────────────────────────────────

export enum LoopStatus {
  /** Loop opened — claim submitted, decomposition in progress */
  OPEN          = 'open',
  /** All sub-claims assigned to validators */
  VALIDATING    = 'validating',
  /** Consensus phase — weighted voting on sub-claim results */
  CONSENSUS     = 'consensus',
  /** Loop closed successfully — ΔS > 0 verified */
  CLOSED        = 'closed',
  /** Loop failed — ΔS ≤ 0 or consensus rejected */
  FAILED        = 'failed',
  /** Loop hit Gödel boundary — isolated, not counted */
  ISOLATED      = 'isolated',
  /** XP minted and distributed — terminal state */
  SETTLED       = 'settled',
}

/**
 * A Loop is the atomic unit of value in the Extropy Engine.
 *
 * The full lifecycle:
 *   1. OPEN      — A claim is submitted
 *   2. VALIDATING — Epistemology Engine decomposes → sub-claims assigned
 *   3. CONSENSUS  — Validators complete, weighted vote: V+ = Σ R_i (approve), V- = Σ R_j (deny)
 *   4. CLOSED     — If V+ > V- and ΔS > 0, loop closes
 *   5. SETTLED    — XP Mint mints tokens and distributes
 *
 * The Loop is a node in the Loop Ledger's DAG. Edges represent
 * causal dependencies between loops (one loop's output feeds another's input).
 */
export interface Loop {
  id: LoopId;

  /** The root claim that initiated this loop */
  claimId: ClaimId;

  status: LoopStatus;

  /** Entropy domain of this loop */
  domain: EntropyDomain;

  // ── Entropy Measurements ──────────────────────────────────────────────

  /** Entropy measurement before the claimed action */
  entropyBefore: EntropyMeasurement | null;

  /** Entropy measurement after the claimed action */
  entropyAfter: EntropyMeasurement | null;

  /**
   * ΔS = entropyBefore.value - entropyAfter.value
   * Must be > 0 for the loop to close.
   * Computed by the Loop Ledger after both measurements are recorded.
   */
  deltaS: number | null;

  // ── Participants ──────────────────────────────────────────────────────

  /** All validators involved in this loop */
  validatorIds: ValidatorId[];

  /** All task routings for this loop's sub-claims */
  taskIds: TaskId[];

  // ── Consensus ─────────────────────────────────────────────────────────

  /**
   * Weighted consensus results.
   * V+ = sum of reputation scores of validators who confirmed
   * V- = sum of reputation scores of validators who denied
   * Loop closes if V+ > V-
   */
  consensus: LoopConsensus | null;

  // ── DAG Structure ─────────────────────────────────────────────────────

  /** Parent loop IDs — this loop depends on outputs from these loops */
  parentLoopIds: LoopId[];

  /** Child loop IDs — these loops depend on this loop's output */
  childLoopIds: LoopId[];

  // ── Timing ────────────────────────────────────────────────────────────

  /** Settlement time Tₛ — duration from open to close */
  settlementTimeSeconds: number | null;

  /** Causal closure speed for this domain */
  causalClosureSpeed: number;

  createdAt: Timestamp;
  closedAt?: Timestamp;
  settledAt?: Timestamp;
}

export interface LoopConsensus {
  /** Sum of reputation of confirming validators */
  vPlus: number;
  /** Sum of reputation of denying validators */
  vMinus: number;
  /** Whether consensus passed (vPlus > vMinus) */
  passed: boolean;
  /** Individual votes for audit trail */
  votes: ConsensusVote[];
  /** Timestamp of consensus resolution */
  resolvedAt: Timestamp;
}

export interface ConsensusVote {
  validatorId: ValidatorId;
  vote: 'confirm' | 'deny' | 'abstain';
  reputationWeight: number;
  justification?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  XP Minting (XP Mint Service)
// ─────────────────────────────────────────────────────────────────────────────

export enum MintStatus {
  /** Provisional mint — loop closed but awaiting retroactive validation */
  PROVISIONAL   = 'provisional',
  /** Confirmed — retroactive validation passed */
  CONFIRMED     = 'confirmed',
  /** Burned — retroactive validation failed, XP revoked */
  BURNED        = 'burned',
}

/**
 * An XP minting event — created when a Loop closes with verified ΔS > 0.
 *
 * XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 *
 * The mint is initially PROVISIONAL (Epistemic Risk Claim phase).
 * After retroactive validation (Retroactive Convergence Validation),
 * it transitions to CONFIRMED or BURNED.
 */
export interface XPMintEvent {
  id: MintEventId;
  loopId: LoopId;

  status: MintStatus;

  // ── Formula Components ────────────────────────────────────────────────

  /** R — Aggregate reputation of the validator(s) who verified the loop */
  reputationFactor: number;

  /** F — Feedback closure strength [0, 1] */
  feedbackClosureStrength: number;

  /** ΔS — Net entropy reduction (must be > 0) */
  deltaS: number;

  /** w · E — Domain weight × essentiality factor */
  domainEssentialityProduct: number;

  /** log(1/Tₛ) — Settlement time factor. Faster closure → higher value */
  settlementTimeFactor: number;

  /** Final computed XP value */
  xpValue: number;

  // ── Distribution ──────────────────────────────────────────────────────

  /** How the minted XP is distributed among participants */
  distribution: XPDistribution[];

  /** Total XP minted in this event */
  totalMinted: number;

  // ── Retroactive Validation ────────────────────────────────────────────

  /** If burned, the reason */
  burnReason?: string;

  /** Timestamp of retroactive confirmation or burn */
  retroactiveValidationAt?: Timestamp;

  createdAt: Timestamp;
}

export interface XPDistribution {
  validatorId: ValidatorId;
  /** Proportion of total XP allocated to this validator */
  share: number;
  /** Absolute XP amount */
  xpAmount: number;
  /** Basis for the share (reputation weight, task contribution, etc.) */
  basis: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Inter-Service Events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All inter-service communication uses typed events.
 * Services publish events to a shared bus; downstream services subscribe.
 *
 * Event naming convention: <Source>.<Action>
 *
 * This is the exhaustive event catalog for the Extropy Engine.
 */
export enum EventType {
  // ── Epistemology Engine Events ─────────────────────────────────────────
  /** New claim ingested and ready for decomposition */
  CLAIM_SUBMITTED             = 'epistemology.claim.submitted',
  /** Claim decomposed into sub-claims */
  CLAIM_DECOMPOSED            = 'epistemology.claim.decomposed',
  /** Sub-claim truth score updated via Bayesian update */
  SUBCLAIM_UPDATED            = 'epistemology.subclaim.updated',
  /** Claim fully evaluated — composite truth score computed */
  CLAIM_EVALUATED             = 'epistemology.claim.evaluated',
  /** Claim hit Gödel boundary */
  CLAIM_UNDECIDABLE           = 'epistemology.claim.undecidable',

  // ── SignalFlow Events ─────────────────────────────────────────────────
  /** Task created and queued for assignment */
  TASK_CREATED                = 'signalflow.task.created',
  /** Task assigned to a validator */
  TASK_ASSIGNED               = 'signalflow.task.assigned',
  /** Task completed by validator with result */
  TASK_COMPLETED              = 'signalflow.task.completed',
  /** Task timed out and needs reassignment */
  TASK_TIMED_OUT              = 'signalflow.task.timed_out',
  /** Task reassigned to a different validator */
  TASK_REASSIGNED             = 'signalflow.task.reassigned',

  // ── Loop Ledger Events ────────────────────────────────────────────────
  /** New loop opened */
  LOOP_OPENED                 = 'ledger.loop.opened',
  /** Entropy measurement recorded for a loop */
  LOOP_MEASUREMENT_RECORDED   = 'ledger.loop.measurement_recorded',
  /** Loop entered consensus phase */
  LOOP_CONSENSUS_STARTED      = 'ledger.loop.consensus_started',
  /** Loop closed successfully (ΔS > 0 verified) */
  LOOP_CLOSED                 = 'ledger.loop.closed',
  /** Loop failed (ΔS ≤ 0 or consensus rejected) */
  LOOP_FAILED                 = 'ledger.loop.failed',
  /** Loop isolated due to Gödel boundary */
  LOOP_ISOLATED               = 'ledger.loop.isolated',
  /** Loop fully settled (XP distributed) */
  LOOP_SETTLED                = 'ledger.loop.settled',

  // ── Reputation Events ─────────────────────────────────────────────────
  /** Reputation accrued for a validator */
  REPUTATION_ACCRUED          = 'reputation.accrued',
  /** Reputation decayed due to inactivity */
  REPUTATION_DECAYED          = 'reputation.decayed',
  /** Reputation penalized (adversarial behavior detected) */
  REPUTATION_PENALIZED        = 'reputation.penalized',

  // ── XP Mint Events ────────────────────────────────────────────────────
  /** XP provisionally minted */
  XP_MINTED_PROVISIONAL       = 'mint.xp.provisional',
  /** XP retroactively confirmed */
  XP_CONFIRMED                = 'mint.xp.confirmed',
  /** XP burned (retroactive validation failed) */
  XP_BURNED                   = 'mint.xp.burned',

  // ── DAG Substrate Events ──────────────────────────────────────────────
  /** A new vertex was created and broadcast to the DAG */
  VERTEX_CREATED              = 'dag.vertex.created',
  /** A vertex has reached the confirmation weight threshold */
  VERTEX_CONFIRMED            = 'dag.vertex.confirmed',
  /** A vertex was rejected (invalid signature or duplicate) */
  VERTEX_REJECTED             = 'dag.vertex.rejected',

  // ── DFAO Events ───────────────────────────────────────────────────────
  /** A new DFAO has been created */
  DFAO_CREATED                = 'dfao.created',
  /** A DFAO's status has changed (e.g., SHADOW → HYBRID) */
  DFAO_STATUS_CHANGED         = 'dfao.status_changed',
  /** A validator joined a DFAO */
  DFAO_MEMBER_JOINED          = 'dfao.member.joined',
  /** A validator voluntarily left a DFAO */
  DFAO_MEMBER_LEFT            = 'dfao.member.left',
  /** A member was expelled from a DFAO via governance */
  DFAO_MEMBER_EXPELLED        = 'dfao.member.expelled',
  /** A DFAO was dissolved */
  DFAO_DISSOLVED              = 'dfao.dissolved',

  // ── Governance Events ─────────────────────────────────────────────────
  /** A new governance proposal was submitted */
  PROPOSAL_CREATED            = 'governance.proposal.created',
  /** A proposal has entered the voting phase */
  PROPOSAL_VOTING_STARTED     = 'governance.proposal.voting_started',
  /** A governance vote was cast on a proposal */
  GOVERNANCE_VOTE_CAST        = 'governance.vote.cast',
  /** A proposal passed and is pending implementation */
  PROPOSAL_PASSED             = 'governance.proposal.passed',
  /** A proposal was rejected */
  PROPOSAL_REJECTED           = 'governance.proposal.rejected',
  /** A passed proposal has been implemented */
  PROPOSAL_IMPLEMENTED        = 'governance.proposal.implemented',
  /** An emergency intervention was triggered */
  EMERGENCY_INTERVENTION      = 'governance.emergency',

  // ── Season Events ─────────────────────────────────────────────────────
  /** A new season has started */
  SEASON_STARTED              = 'temporal.season.started',
  /** A season has ended and rankings are finalized */
  SEASON_ENDED                = 'temporal.season.ended',
  /** A loop exceeded its time limit and was forcibly closed */
  LOOP_TIMED_OUT              = 'temporal.loop.timed_out',
  /** Periodic reputation decay tick fired */
  REPUTATION_DECAY_TICK       = 'temporal.reputation.decay_tick',
  /** Governance weight decayed for a validator */
  GOVERNANCE_WEIGHT_DECAYED   = 'temporal.governance.weight_decayed',

  // ── Token Economy Events ──────────────────────────────────────────────
  /** A token was minted */
  TOKEN_MINTED                = 'economy.token.minted',
  /** A token was burned */
  TOKEN_BURNED                = 'economy.token.burned',
  /** A token balance was locked (lockup period started) */
  TOKEN_LOCKED                = 'economy.token.locked',
  /** A locked token balance was released */
  TOKEN_UNLOCKED              = 'economy.token.unlocked',
  /** Tokens were converted between types */
  TOKEN_CONVERTED             = 'economy.token.converted',
  /** A CT lockup period has expired */
  CT_LOCKUP_EXPIRED           = 'economy.ct.lockup_expired',
  /** CT was burned due to inactivity */
  CT_INACTIVITY_BURN          = 'economy.ct.inactivity_burn',
  /** XP decayed for a validator */
  XP_DECAYED                  = 'economy.xp.decayed',

  // ── Credential Events ─────────────────────────────────────────────────
  /** A credential was issued to a validator */
  CREDENTIAL_ISSUED           = 'credentials.issued',
  /** A credential was revoked */
  CREDENTIAL_REVOKED          = 'credentials.revoked',
  /** A validator leveled up */
  LEVEL_UP                    = 'credentials.level_up',
  /** A CAT certification was granted */
  CAT_CERTIFIED               = 'credentials.cat.certified',
  /** A CAT recertification is due */
  CAT_RECERTIFICATION_DUE     = 'credentials.cat.recertification_due',
  /** A badge was earned */
  BADGE_EARNED                = 'credentials.badge.earned',
  /** A title was awarded */
  TITLE_AWARDED               = 'credentials.title.awarded',

  // ── Ecosystem Events ──────────────────────────────────────────────────
  /** A new skill node was added to the skill DAG */
  SKILL_NODE_CREATED          = 'ecosystem.skill.created',
  /** A validator mastered a skill node */
  SKILL_MASTERED              = 'ecosystem.skill.mastered',
  /** An XP Oracle synced external platform data */
  XP_ORACLE_SYNC              = 'ecosystem.oracle.sync',
  /** A cross-domain XP exchange was completed */
  XP_EXCHANGE_COMPLETED       = 'ecosystem.exchange.completed',
  /** Emergence Points were converted from XP */
  EP_CONVERTED                = 'ecosystem.ep.converted',
}

/**
 * Generic event envelope. Every event in the system follows this structure.
 */
export interface DomainEvent<T extends EventType = EventType, P = unknown> {
  /** Unique event ID */
  eventId: string;
  /** Event type from the catalog */
  type: T;
  /** The event payload — structure depends on event type */
  payload: P;
  /** Which service emitted this event */
  source: ServiceName;
  /** Correlation ID for tracing a full loop lifecycle */
  correlationId: LoopId;
  /** When the event was emitted */
  timestamp: Timestamp;
  /** Schema version for forward compatibility */
  version: number;
}

export enum ServiceName {
  EPISTEMOLOGY_ENGINE = 'epistemology-engine',
  SIGNALFLOW         = 'signalflow',
  LOOP_LEDGER        = 'loop-ledger',
  REPUTATION         = 'reputation',
  XP_MINT            = 'xp-mint',
  DAG_SUBSTRATE      = 'dag-substrate',
  DFAO_REGISTRY      = 'dfao-registry',
  GOVERNANCE         = 'governance',
  TEMPORAL           = 'temporal',
  TOKEN_ECONOMY      = 'token-economy',
  CREDENTIALS        = 'credentials',
  ECOSYSTEM          = 'ecosystem',
    GRANTFLOW_DISCOVERY  = 'grantflow-discovery',
  GRANTFLOW_PROPOSER   = 'grantflow-proposer',
}

// ─────────────────────────────────────────────────────────────────────────────
//  Event Payloads (typed per event)
// ─────────────────────────────────────────────────────────────────────────────

export interface ClaimSubmittedPayload {
  claim: Claim;
}

export interface ClaimDecomposedPayload {
  claimId: ClaimId;
  subClaims: SubClaim[];
}

export interface SubClaimUpdatedPayload {
  subClaimId: SubClaimId;
  claimId: ClaimId;
  newPosterior: number;
  update: BayesianUpdate;
}

export interface ClaimEvaluatedPayload {
  claimId: ClaimId;
  truthScore: number;
  status: ClaimStatus;
}

export interface TaskCreatedPayload {
  task: TaskRouting;
  subClaim: SubClaim;
}

export interface TaskAssignedPayload {
  taskId: TaskId;
  validatorId: ValidatorId;
  routingReason: RoutingReason;
}

export interface TaskCompletedPayload {
  taskId: TaskId;
  validatorId: ValidatorId;
  result: ValidationResult;
}

export interface LoopOpenedPayload {
  loop: Loop;
  claim: Claim;
}

export interface LoopMeasurementRecordedPayload {
  loopId: LoopId;
  measurement: EntropyMeasurement;
  phase: 'before' | 'after';
}

export interface LoopClosedPayload {
  loop: Loop;
  deltaS: number;
  consensus: LoopConsensus;
}

export interface LoopFailedPayload {
  loopId: LoopId;
  reason: string;
  deltaS: number | null;
  consensus: LoopConsensus | null;
}

export interface ReputationAccruedPayload {
  validatorId: ValidatorId;
  domain: EntropyDomain;
  delta: number;
  newAggregate: number;
  relatedLoopId: LoopId;
}

export interface ReputationPenalizedPayload {
  validatorId: ValidatorId;
  domain: EntropyDomain;
  penalty: number;
  reason: string;
  relatedLoopId: LoopId;
}

export interface XPMintedProvisionalPayload {
  mintEvent: XPMintEvent;
}

export interface XPConfirmedPayload {
  mintEventId: MintEventId;
  loopId: LoopId;
  totalXP: number;
}

export interface XPBurnedPayload {
  mintEventId: MintEventId;
  loopId: LoopId;
  burnReason: string;
  xpBurned: number;
}

// ── New Event Payloads ────────────────────────────────────────────────────────

export interface VertexCreatedPayload {
  vertex: DAGVertex;
}

export interface VertexConfirmedPayload {
  vertexId: VertexId;
  confirmationWeight: number;
  timestamp: Timestamp;
}

export interface VertexRejectedPayload {
  vertexId: VertexId;
  reason: string;
  timestamp: Timestamp;
}

export interface DFAOCreatedPayload {
  dfao: DFAO;
  creatorId: ValidatorId;
}

export interface DFAOStatusChangedPayload {
  dfaoId: DFAOId;
  previousStatus: DFAOStatus;
  newStatus: DFAOStatus;
  triggeredByProposalId: ProposalId | null;
}

export interface DFAOMemberJoinedPayload {
  dfaoId: DFAOId;
  validatorId: ValidatorId;
  role: MembershipRole;
  membershipVertexId: VertexId;
}

export interface DFAOMemberLeftPayload {
  dfaoId: DFAOId;
  validatorId: ValidatorId;
  reason: string;
}

export interface DFAOMemberExpelledPayload {
  dfaoId: DFAOId;
  validatorId: ValidatorId;
  proposalId: ProposalId;
  reason: string;
}

export interface DFAODissolvedPayload {
  dfaoId: DFAOId;
  proposalId: ProposalId;
  finalMemberCount: number;
}

export interface ProposalCreatedPayload {
  proposal: GovernanceProposal;
}

export interface ProposalVotingStartedPayload {
  proposalId: ProposalId;
  dfaoId: DFAOId;
  votingDeadline: Timestamp;
}

export interface GovernanceVoteCastPayload {
  vote: GovernanceVote;
  currentTally: GovernanceTally;
}

export interface ProposalPassedPayload {
  proposalId: ProposalId;
  dfaoId: DFAOId;
  tally: GovernanceTally;
}

export interface ProposalRejectedPayload {
  proposalId: ProposalId;
  dfaoId: DFAOId;
  tally: GovernanceTally;
  reason: string;
}

export interface ProposalImplementedPayload {
  proposalId: ProposalId;
  dfaoId: DFAOId;
  changes: ProposalChange[];
}

export interface EmergencyInterventionPayload {
  dfaoId: DFAOId;
  proposalId: ProposalId;
  triggeredByValidatorId: ValidatorId;
  description: string;
}

export interface SeasonStartedPayload {
  season: Season;
}

export interface SeasonEndedPayload {
  season: Season;
  finalRankings: SeasonRanking[];
  totalXPMinted: number;
  totalLoopsClosed: number;
}

export interface LoopTimedOutPayload {
  loopId: LoopId;
  openedAt: Timestamp;
  timedOutAt: Timestamp;
  domain: EntropyDomain;
}

export interface ReputationDecayTickPayload {
  validatorId: ValidatorId;
  domain: EntropyDomain;
  decayAmount: number;
  newAggregate: number;
}

export interface GovernanceWeightDecayedPayload {
  validatorId: ValidatorId;
  dfaoId: DFAOId;
  previousWeight: number;
  newWeight: number;
  decayRate: number;
}

export interface TokenMintedPayload {
  transaction: TokenTransaction;
  newBalance: number;
}

export interface TokenBurnedPayload {
  transaction: TokenTransaction;
  previousBalance: number;
}

export interface TokenLockedPayload {
  walletId: WalletId;
  tokenType: TokenType;
  amount: number;
  lockupExpiresAt: Timestamp;
}

export interface TokenUnlockedPayload {
  walletId: WalletId;
  tokenType: TokenType;
  amount: number;
  vertexId: VertexId;
}

export interface TokenConvertedPayload {
  transaction: TokenTransaction;
  fromType: TokenType;
  toType: TokenType;
  fromAmount: number;
  toAmount: number;
}

export interface CTLockupExpiredPayload {
  walletId: WalletId;
  validatorId: ValidatorId;
  amount: number;
  seasonId: SeasonId;
}

export interface CTInactivityBurnPayload {
  walletId: WalletId;
  validatorId: ValidatorId;
  burnedAmount: number;
  inactiveDays: number;
  vertexId: VertexId;
}

export interface XPDecayedPayload {
  validatorId: ValidatorId;
  previousXP: number;
  newXP: number;
  decayRate: number;
  cycleNumber: number;
}

export interface CredentialIssuedPayload {
  credential: Credential;
}

export interface CredentialRevokedPayload {
  credentialId: CredentialId;
  validatorId: ValidatorId;
  reason: string;
  revokedAt: Timestamp;
}

export interface LevelUpPayload {
  validatorId: ValidatorId;
  previousLevel: number;
  newLevel: number;
  title: string;
  credentialId: CredentialId;
}

export interface CATCertifiedPayload {
  validatorId: ValidatorId;
  domain: EntropyDomain;
  level: number;
  validatedPerformances: number;
  credentialId: CredentialId;
}

export interface CATRecertificationDuePayload {
  validatorId: ValidatorId;
  domain: EntropyDomain;
  lastCertifiedAt: Timestamp;
  dueBy: Timestamp;
}

export interface BadgeEarnedPayload {
  credential: Credential;
  triggeredBy: string;
}

export interface TitleAwardedPayload {
  credential: Credential;
  reputationLevel: number;
}

export interface SkillNodeCreatedPayload {
  skillNode: SkillNode;
}

export interface SkillMasteredPayload {
  validatorId: ValidatorId;
  skillNodeId: SkillNodeId;
  validatedPerformances: number;
  credentialId: CredentialId;
}

export interface XPOracleSyncPayload {
  source: XPOracleSource;
  validatorId: ValidatorId;
  xpAwarded: number;
  rulesApplied: XPOracleMappingRule[];
  syncedAt: Timestamp;
}

export interface XPExchangeCompletedPayload {
  exchange: XPExchange;
  validatorId: ValidatorId;
  sentAmount: number;
  receivedAmount: number;
  frictionLost: number;
}

export interface EPConvertedPayload {
  validatorId: ValidatorId;
  inputs: EPConversionInputs;
  epAwarded: number;
  dfaoId: DFAOId;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Type-Safe Event Map (for strongly-typed pub/sub)
// ─────────────────────────────────────────────────────────────────────────────

export interface EventPayloadMap {
  [EventType.CLAIM_SUBMITTED]:           ClaimSubmittedPayload;
  [EventType.CLAIM_DECOMPOSED]:          ClaimDecomposedPayload;
  [EventType.SUBCLAIM_UPDATED]:          SubClaimUpdatedPayload;
  [EventType.CLAIM_EVALUATED]:           ClaimEvaluatedPayload;
  [EventType.CLAIM_UNDECIDABLE]:         ClaimEvaluatedPayload;
  [EventType.TASK_CREATED]:              TaskCreatedPayload;
  [EventType.TASK_ASSIGNED]:             TaskAssignedPayload;
  [EventType.TASK_COMPLETED]:            TaskCompletedPayload;
  [EventType.TASK_TIMED_OUT]:            TaskCompletedPayload;
  [EventType.TASK_REASSIGNED]:           TaskAssignedPayload;
  [EventType.LOOP_OPENED]:               LoopOpenedPayload;
  [EventType.LOOP_MEASUREMENT_RECORDED]: LoopMeasurementRecordedPayload;
  [EventType.LOOP_CONSENSUS_STARTED]:    { loopId: LoopId };
  [EventType.LOOP_CLOSED]:               LoopClosedPayload;
  [EventType.LOOP_FAILED]:               LoopFailedPayload;
  [EventType.LOOP_ISOLATED]:             { loopId: LoopId; reason: string };
  [EventType.LOOP_SETTLED]:              { loopId: LoopId; mintEventId: MintEventId };
  [EventType.REPUTATION_ACCRUED]:        ReputationAccruedPayload;
  [EventType.REPUTATION_DECAYED]:        { validatorId: ValidatorId; domain: EntropyDomain; decayAmount: number };
  [EventType.REPUTATION_PENALIZED]:      ReputationPenalizedPayload;
  [EventType.XP_MINTED_PROVISIONAL]:     XPMintedProvisionalPayload;
  [EventType.XP_CONFIRMED]:              XPConfirmedPayload;
  [EventType.XP_BURNED]:                 XPBurnedPayload;
  // DAG Substrate
  [EventType.VERTEX_CREATED]:            VertexCreatedPayload;
  [EventType.VERTEX_CONFIRMED]:          VertexConfirmedPayload;
  [EventType.VERTEX_REJECTED]:           VertexRejectedPayload;
  // DFAO
  [EventType.DFAO_CREATED]:              DFAOCreatedPayload;
  [EventType.DFAO_STATUS_CHANGED]:       DFAOStatusChangedPayload;
  [EventType.DFAO_MEMBER_JOINED]:        DFAOMemberJoinedPayload;
  [EventType.DFAO_MEMBER_LEFT]:          DFAOMemberLeftPayload;
  [EventType.DFAO_MEMBER_EXPELLED]:      DFAOMemberExpelledPayload;
  [EventType.DFAO_DISSOLVED]:            DFAODissolvedPayload;
  // Governance
  [EventType.PROPOSAL_CREATED]:          ProposalCreatedPayload;
  [EventType.PROPOSAL_VOTING_STARTED]:   ProposalVotingStartedPayload;
  [EventType.GOVERNANCE_VOTE_CAST]:      GovernanceVoteCastPayload;
  [EventType.PROPOSAL_PASSED]:           ProposalPassedPayload;
  [EventType.PROPOSAL_REJECTED]:         ProposalRejectedPayload;
  [EventType.PROPOSAL_IMPLEMENTED]:      ProposalImplementedPayload;
  [EventType.EMERGENCY_INTERVENTION]:    EmergencyInterventionPayload;
  // Season / Temporal
  [EventType.SEASON_STARTED]:            SeasonStartedPayload;
  [EventType.SEASON_ENDED]:              SeasonEndedPayload;
  [EventType.LOOP_TIMED_OUT]:            LoopTimedOutPayload;
  [EventType.REPUTATION_DECAY_TICK]:     ReputationDecayTickPayload;
  [EventType.GOVERNANCE_WEIGHT_DECAYED]: GovernanceWeightDecayedPayload;
  // Token Economy
  [EventType.TOKEN_MINTED]:              TokenMintedPayload;
  [EventType.TOKEN_BURNED]:              TokenBurnedPayload;
  [EventType.TOKEN_LOCKED]:              TokenLockedPayload;
  [EventType.TOKEN_UNLOCKED]:            TokenUnlockedPayload;
  [EventType.TOKEN_CONVERTED]:           TokenConvertedPayload;
  [EventType.CT_LOCKUP_EXPIRED]:         CTLockupExpiredPayload;
  [EventType.CT_INACTIVITY_BURN]:        CTInactivityBurnPayload;
  [EventType.XP_DECAYED]:                XPDecayedPayload;
  // Credentials
  [EventType.CREDENTIAL_ISSUED]:         CredentialIssuedPayload;
  [EventType.CREDENTIAL_REVOKED]:        CredentialRevokedPayload;
  [EventType.LEVEL_UP]:                  LevelUpPayload;
  [EventType.CAT_CERTIFIED]:             CATCertifiedPayload;
  [EventType.CAT_RECERTIFICATION_DUE]:   CATRecertificationDuePayload;
  [EventType.BADGE_EARNED]:              BadgeEarnedPayload;
  [EventType.TITLE_AWARDED]:             TitleAwardedPayload;
  // Ecosystem
  [EventType.SKILL_NODE_CREATED]:        SkillNodeCreatedPayload;
  [EventType.SKILL_MASTERED]:            SkillMasteredPayload;
  [EventType.XP_ORACLE_SYNC]:            XPOracleSyncPayload;
  [EventType.XP_EXCHANGE_COMPLETED]:     XPExchangeCompletedPayload;
  [EventType.EP_CONVERTED]:              EPConvertedPayload;
}

/**
 * Type-safe event emitter/subscriber interfaces.
 * Each service implements the relevant subset.
 */
export type TypedDomainEvent<T extends EventType> = DomainEvent<T, EventPayloadMap[T]>;

// ─────────────────────────────────────────────────────────────────────────────
//  XP Calculation Helpers (pure functions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The full XP formula:
 *   XP = R × F × ΔS × (w · E) × log(1/Tₛ)
 *
 * Where each factor is independently verifiable and must be > 0.
 */
export interface XPFormulaInputs {
  /** R — Reputation factor */
  reputation: number;
  /** F — Feedback closure strength [0, 1] */
  feedbackClosure: number;
  /** ΔS — Net entropy reduction (must be > 0) */
  deltaS: number;
  /** w — Domain weight */
  domainWeight: number;
  /** E — Essentiality factor [0, 1] */
  essentiality: number;
  /** Tₛ — Settlement time in seconds (must be > 0) */
  settlementTimeSeconds: number;
}

/**
 * Irreducible form: XP = ΔS / c_L²
 * This is the physics floor — the minimum XP that MUST be minted
 * for a given entropy reduction in a given domain.
 */
export interface IrreducibleXPInputs {
  /** ΔS — Net entropy reduction */
  deltaS: number;
  /** c_L — Causal closure speed for the domain */
  causalClosureSpeed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Service Health & API Contracts
// ─────────────────────────────────────────────────────────────────────────────

export interface ServiceHealthResponse {
  service: ServiceName;
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: Timestamp;
  dependencies: Record<ServiceName, 'connected' | 'disconnected'>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ErrorResponse {
  error: string;
  code: string;
  details?: Record<string, unknown>;
  correlationId?: string;
  timestamp: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────────────
//  New Branded ID Types
// ─────────────────────────────────────────────────────────────────────────────

export type DFAOId      = string & { readonly __brand: 'DFAOId' };
export type ProposalId  = string & { readonly __brand: 'ProposalId' };
export type SeasonId    = string & { readonly __brand: 'SeasonId' };
export type CredentialId = string & { readonly __brand: 'CredentialId' };
export type TokenId     = string & { readonly __brand: 'TokenId' };
export type VertexId    = string & { readonly __brand: 'VertexId' };
export type WalletId    = string & { readonly __brand: 'WalletId' };
export type SkillNodeId = string & { readonly __brand: 'SkillNodeId' };

// ─────────────────────────────────────────────────────────────────────────────
//  DAG Substrate Types
// ─────────────────────────────────────────────────────────────────────────────

/** Cryptographic key types for vertex signing */
export type CryptoAlgorithm = 'ed25519' | 'secp256k1';

/** A signed vertex in the DAG substrate — the atomic unit of the permissionless ledger */
export interface DAGVertex {
  id: VertexId;
  /** The type of event this vertex represents */
  vertexType: VertexType;
  /** Cryptographic signature of the vertex content */
  signature: string;
  /** Public key of the signer */
  publicKey: string;
  /** Which crypto algorithm was used */
  algorithm: CryptoAlgorithm;
  /** Lamport timestamp for causal ordering */
  lamportTimestamp: number;
  /** Wall-clock timestamp (secondary ordering) */
  wallTimestamp: Timestamp;
  /** Parent vertex IDs this vertex references (validates) */
  parentVertexIds: VertexId[];
  /** The hash of the vertex content (for integrity verification) */
  contentHash: string;
  /** Confirmation weight — cumulative weight of all vertices referencing this one */
  confirmationWeight: number;
  /** Whether this vertex is a tip (no children yet) */
  isTip: boolean;
  /** The actual payload (loop, measurement, vote, proposal, mint, etc.) */
  payload: VertexPayload;
  /** Optional: DFAO context — which DFAO this vertex belongs to */
  dfaoId?: DFAOId;
  /** Propagation metadata */
  propagation: VertexPropagation;
}

export enum VertexType {
  LOOP_OPEN            = 'loop_open',
  LOOP_CLOSE           = 'loop_close',
  MEASUREMENT          = 'measurement',
  CONSENSUS_VOTE       = 'consensus_vote',
  XP_MINT              = 'xp_mint',
  GOVERNANCE_PROPOSAL  = 'governance_proposal',
  GOVERNANCE_VOTE      = 'governance_vote',
  DFAO_CREATE          = 'dfao_create',
  DFAO_MEMBERSHIP      = 'dfao_membership',
  TOKEN_MINT           = 'token_mint',
  TOKEN_BURN           = 'token_burn',
  CREDENTIAL_ISSUE     = 'credential_issue',
  SEASON_START         = 'season_start',
  SEASON_END           = 'season_end',
  GENERIC              = 'generic',
}

export type VertexPayload = Record<string, unknown>;

export interface VertexPropagation {
  /** Node ID that originated this vertex */
  originNodeId: string;
  /** How many hops this vertex has traveled */
  hopCount: number;
  /** Timestamp when first received */
  receivedAt: Timestamp;
  /** Whether this vertex has been validated by local tip selection */
  locallyValidated: boolean;
}

/** Tip selection result — which tips a new vertex should reference */
export interface TipSelectionResult {
  selectedTips: VertexId[];
  algorithm: 'random_walk' | 'weighted_random_walk' | 'mcmc';
  walkDepth: number;
  timestamp: Timestamp;
}

/** Configuration for the DAG substrate */
export interface DAGSubstrateConfig {
  /** Minimum number of parent vertices a new vertex must reference */
  minParentCount: number;
  /** Maximum age (in Lamport ticks) for a vertex to be considered a valid tip */
  maxTipAge: number;
  /** Confirmation weight threshold for a vertex to be considered finalized */
  confirmationThreshold: number;
  /** Tip selection algorithm */
  tipSelectionAlgorithm: 'random_walk' | 'weighted_random_walk' | 'mcmc';
  /** Random walk depth for tip selection */
  walkDepth: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DFAO Types
// ─────────────────────────────────────────────────────────────────────────────

export enum DFAOStatus {
  SHADOW    = 'shadow',     // Phase 1: shadow governance (no binding decisions)
  HYBRID    = 'hybrid',     // Phase 2: hybrid (some binding)
  ACTIVE    = 'active',     // Phase 3: full autonomy
  SUSPENDED = 'suspended',  // Governance emergency
  DISSOLVED = 'dissolved',  // Terminal state
}

export enum DFAOScale {
  NANO      = 'nano',       // Individual project
  MICRO     = 'micro',      // Team / small group
  MESO      = 'meso',       // Department / community
  MACRO     = 'macro',      // Organization / city
  PLANETARY = 'planetary',  // Civilization-wide
}

/** A Decentralized Fractal Autonomous Organization */
export interface DFAO {
  id: DFAOId;
  name: string;
  description: string;
  status: DFAOStatus;
  scale: DFAOScale;
  /** Parent DFAO — for fractal nesting */
  parentDFAOId: DFAOId | null;
  /** Child DFAO IDs — fractal children */
  childDFAOIds: DFAOId[];
  /** Founding members */
  founderIds: ValidatorId[];
  /** Current member count */
  memberCount: number;
  /** Primary entropy domain this DFAO operates in */
  primaryDomain: EntropyDomain;
  /** Additional domains */
  secondaryDomains: EntropyDomain[];
  /** Governance configuration */
  governanceConfig: DFAOGovernanceConfig;
  /** Token economy config specific to this DFAO */
  tokenConfig: DFAOTokenConfig;
  /** The DAG vertex that recorded this DFAO's creation */
  creationVertexId: VertexId;
  /** Metadata */
  metadata: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DFAOGovernanceConfig {
  /** Minimum members to form a quorum */
  quorumMinMembers: number;
  /** Quorum as percentage of active members */
  quorumPercentage: number;
  /** Deliberation period in hours */
  deliberationPeriodHours: number;
  /** Voting method */
  votingMethod: 'linear_reputation' | 'quadratic' | 'conviction';
  /** Whether this DFAO can create binding proposals (false in shadow phase) */
  bindingProposals: boolean;
  /** Proposal threshold formula params: threshold = log(system_size) × complexity × impact_radius */
  proposalThresholdParams: {
    complexityFactor: number;
    impactRadiusMultiplier: number;
  };
  /** Emergency intervention threshold (% of total reputation) */
  emergencyThreshold: number;
}

export interface DFAOTokenConfig {
  /** Whether this DFAO mints its own domain tokens */
  mintsDomainTokens: boolean;
  /** Custom CT multiplier for contributions within this DFAO */
  ctMultiplier: number;
  /** Governance weight formula exponents */
  domainContributionExponent: number;  // default 1.5
  totalContributionExponent: number;   // default 0.5
}

export enum MembershipRole {
  MEMBER      = 'member',
  CONTRIBUTOR = 'contributor',
  STEWARD     = 'steward',    // governance role
  FOUNDER     = 'founder',
  OBSERVER    = 'observer',
}

export enum MembershipStatus {
  ACTIVE    = 'active',
  INACTIVE  = 'inactive',
  SUSPENDED = 'suspended',
  EXPELLED  = 'expelled',
}

export interface DFAOMembership {
  dfaoId: DFAOId;
  validatorId: ValidatorId;
  role: MembershipRole;
  status: MembershipStatus;
  /** Governance weight in this DFAO */
  governanceWeight: number;
  /** Domain-specific contribution count in this DFAO */
  domainContributions: Record<EntropyDomain, number>;
  /** Total contributions across all domains in this DFAO */
  totalContributions: number;
  /** When they joined */
  joinedAt: Timestamp;
  /** Last active within this DFAO */
  lastActiveAt: Timestamp;
  /** The DAG vertex recording membership */
  membershipVertexId: VertexId;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Governance Types
// ─────────────────────────────────────────────────────────────────────────────

export enum ProposalStatus {
  DRAFT         = 'draft',
  DELIBERATION  = 'deliberation',
  VOTING        = 'voting',
  PASSED        = 'passed',
  REJECTED      = 'rejected',
  IMPLEMENTED   = 'implemented',
  VETOED        = 'vetoed',
  EXPIRED       = 'expired',
}

export enum ProposalType {
  PARAMETER_CHANGE       = 'parameter_change',
  DFAO_POLICY            = 'dfao_policy',
  MEMBERSHIP_ACTION      = 'membership_action',
  TREASURY_ALLOCATION    = 'treasury_allocation',
  PROTOCOL_AMENDMENT     = 'protocol_amendment',
  META_GOVERNANCE        = 'meta_governance',
  EMERGENCY_INTERVENTION = 'emergency_intervention',
}

export interface GovernanceProposal {
  id: ProposalId;
  dfaoId: DFAOId;
  type: ProposalType;
  title: string;
  description: string;
  /** The specific changes this proposal would enact */
  changes: ProposalChange[];
  /** Who submitted this proposal */
  proposerId: ValidatorId;
  status: ProposalStatus;
  /** Deliberation start time */
  deliberationStartedAt: Timestamp | null;
  /** Voting start time */
  votingStartedAt: Timestamp | null;
  /** Voting deadline */
  votingDeadline: Timestamp | null;
  /** Votes cast */
  votes: GovernanceVote[];
  /** Vote tally */
  tally: GovernanceTally;
  /** Required quorum for this proposal */
  requiredQuorum: number;
  /** Proposal threshold that was met to submit */
  proposalThreshold: number;
  /** DAG vertex recording this proposal */
  vertexId: VertexId;
  /** Season this proposal belongs to */
  seasonId: SeasonId;
  createdAt: Timestamp;
  resolvedAt: Timestamp | null;
}

export interface ProposalChange {
  /** Which parameter or policy to change */
  target: string;
  /** Current value */
  currentValue: unknown;
  /** Proposed new value */
  proposedValue: unknown;
  /** Human-readable rationale */
  rationale: string;
}

export interface GovernanceVote {
  proposalId: ProposalId;
  voterId: ValidatorId;
  dfaoId: DFAOId;
  vote: 'approve' | 'reject' | 'abstain';
  /** Weight of this vote (reputation-based or quadratic) */
  weight: number;
  /** Raw reputation of voter (before quadratic transform if applicable) */
  rawReputation: number;
  /** Justification */
  justification?: string;
  /** DAG vertex recording this vote */
  vertexId: VertexId;
  timestamp: Timestamp;
}

export interface GovernanceTally {
  totalWeightFor: number;
  totalWeightAgainst: number;
  totalWeightAbstain: number;
  totalVoters: number;
  quorumMet: boolean;
  passed: boolean;
}

/** Governance-adjustable system parameters */
export interface GovernableParameters {
  /** Domain weights (w in XP formula) */
  domainWeights: Record<EntropyDomain, number>;
  /** Essentiality factor (E in XP formula) */
  essentialityFactor: number;
  /** Causal closure speeds per domain */
  causalClosureSpeeds: Record<EntropyDomain, number>;
  /** Reputation accrual rate */
  reputationAccrualRate: number;
  /** Reputation decay rate */
  reputationDecayRate: number;
  /** CT lockup period in hours */
  ctLockupPeriodHours: number;
  /** CT inactivity burn threshold in days */
  ctInactivityBurnDays: number;
  /** XP decay rate (ρ per 30 cycles) */
  xpDecayRate: number;
  /** Season duration in days */
  seasonDurationDays: number;
  /** Minimum reputation for validator participation */
  minReputationThreshold: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Season / Temporal Types
// ─────────────────────────────────────────────────────────────────────────────

export enum SeasonStatus {
  UPCOMING  = 'upcoming',
  ACTIVE    = 'active',
  CLOSING   = 'closing',
  COMPLETED = 'completed',
}

export interface Season {
  id: SeasonId;
  /** Season number (sequential) */
  number: number;
  name: string;
  status: SeasonStatus;
  startedAt: Timestamp;
  endsAt: Timestamp;
  completedAt: Timestamp | null;
  /** Reward multiplier for this season (e.g., early-season bonus) */
  rewardMultiplier: number;
  /** Governance rankings snapshot at season start */
  startingRankingsSnapshot: Record<ValidatorId, number> | null;
  /** Final rankings at season end */
  finalRankings: SeasonRanking[] | null;
  /** DAG vertex recording season start */
  startVertexId: VertexId;
  /** DAG vertex recording season end */
  endVertexId: VertexId | null;
  /** Total XP minted this season */
  totalXPMinted: number;
  /** Total loops closed this season */
  totalLoopsClosed: number;
  metadata: Record<string, unknown>;
}

export interface SeasonRanking {
  validatorId: ValidatorId;
  rank: number;
  totalXP: number;
  totalLoops: number;
  /** Title earned (e.g., "Ecosystem Pioneer") */
  title: string | null;
  /** Badges earned this season */
  badgeIds: CredentialId[];
}

/** Temporal decay configuration */
export interface TemporalDecayConfig {
  /** Monthly governance weight decay (default 5%) */
  governanceWeightDecayRate: number;
  /** XP decay rate ρ (default 0.01 per 30 loop cycles) */
  xpDecayRate: number;
  /** Reputation decay rate γ (default 0.02 per period) */
  reputationDecayRate: number;
  /** CAT recertification period in days (default 180) */
  catRecertificationDays: number;
  /** CT inactivity burn threshold in days (default 365) */
  ctInactivityBurnDays: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Token Economy Types
// ─────────────────────────────────────────────────────────────────────────────

export enum TokenType {
  XP  = 'xp',   // Per-action entropy reduction score (non-transferable)
  CT  = 'ct',   // Contribution Token (cross-platform, restricted transfer)
  CAT = 'cat',  // Capability Token (skill certification, portable)
  IT  = 'it',   // Influence Token (governance weight, non-transferable)
  DT  = 'dt',   // Domain Token (subject-matter expertise)
  EP  = 'ep',   // Emergence Points (merchant loyalty, local only)
}

export enum TokenStatus {
  ACTIVE    = 'active',
  LOCKED    = 'locked',     // In cooldown/lockup period
  BURNED    = 'burned',
  EXPIRED   = 'expired',
  SUSPENDED = 'suspended',
}

/** A token balance entry */
export interface TokenBalance {
  id: TokenId;
  walletId: WalletId;
  validatorId: ValidatorId;
  tokenType: TokenType;
  amount: number;
  status: TokenStatus;
  /** For locked tokens: when does the lockup expire? */
  lockupExpiresAt: Timestamp | null;
  /** When was the last activity on this balance? */
  lastActivityAt: Timestamp;
  /** Domain context (for DT and domain-specific balances) */
  domain: EntropyDomain | null;
  /** DFAO context */
  dfaoId: DFAOId | null;
  /** Season this balance was earned in */
  seasonId: SeasonId | null;
  /** DAG vertex of the last transaction */
  lastVertexId: VertexId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Token mint/burn/transfer event */
export interface TokenTransaction {
  id: string;
  tokenType: TokenType;
  action: 'mint' | 'burn' | 'lock' | 'unlock' | 'convert' | 'decay';
  amount: number;
  /** Source wallet (null for mints) */
  fromWalletId: WalletId | null;
  /** Destination wallet (null for burns) */
  toWalletId: WalletId | null;
  /** Related entity (loop, proposal, etc.) */
  relatedEntityId: string | null;
  relatedEntityType: string | null;
  /** Reason for the transaction */
  reason: string;
  /** DAG vertex recording this transaction */
  vertexId: VertexId;
  /** Season context */
  seasonId: SeasonId;
  timestamp: Timestamp;
}

/** Wallet — each validator has one */
export interface Wallet {
  id: WalletId;
  validatorId: ValidatorId;
  /** Balances by token type */
  balances: Record<TokenType, number>;
  /** Locked balances by token type */
  lockedBalances: Record<TokenType, number>;
  /** Non-transferable flag per token type */
  nonTransferable: Record<TokenType, boolean>;
  /** Last activity timestamp */
  lastActivityAt: Timestamp;
  createdAt: Timestamp;
}

/** Capability Token certification requirements */
export interface CATCertification {
  domain: EntropyDomain;
  /** Current CAT level (log scale: 10/30/90/270 validations) */
  level: number;
  /** Number of validated performances */
  validatedPerformances: number;
  /** Threshold for next level */
  nextLevelThreshold: number;
  /** Last recertification date */
  lastCertifiedAt: Timestamp;
  /** Whether recertification is due (180-day inactivity) */
  recertificationDue: boolean;
  /** Mentorship bonus CATs earned */
  mentorshipBonuses: number;
}

/** CT formula: CT = f(C, F, R, Δ, E) */
export interface CTFormulaInputs {
  /** C — Context of the contribution */
  context: number;
  /** F — Feedback closure strength */
  feedbackClosure: number;
  /** R — Reputation of contributor */
  reputation: number;
  /** Δ — Waste/entropy reduction achieved */
  delta: number;
  /** E — Essentiality (governance-adjustable) */
  essentiality: number;
}

/** EP conversion: EP = XP × L */
export interface EPConversionInputs {
  xpAmount: number;
  /** L — Local loyalty multiplier */
  localLoyaltyMultiplier: number;
}

/** XP decay: XP_t = XP_{t-1} × (1 - ρ) where ρ=0.01 per 30 loop cycles */
export interface XPDecayConfig {
  decayRate: number;   // ρ, default 0.01
  cycleLength: number; // default 30 loop cycles
}

// ─────────────────────────────────────────────────────────────────────────────
//  Credential / Cosmetic Types
// ─────────────────────────────────────────────────────────────────────────────

export enum CredentialType {
  BADGE         = 'badge',
  TITLE         = 'title',
  LEVEL         = 'level',
  ACHIEVEMENT   = 'achievement',
  CERTIFICATION = 'certification',
}

export interface Credential {
  id: CredentialId;
  validatorId: ValidatorId;
  type: CredentialType;
  name: string;
  description: string;
  /** For levels: the numeric level (1-10) */
  level: number | null;
  /** Domain context */
  domain: EntropyDomain | null;
  /** Season earned in */
  seasonId: SeasonId;
  /** Whether this persists across seasons or resets */
  persistsAcrossSeasons: boolean;
  /** DAG vertex recording issuance */
  vertexId: VertexId;
  /** Visual metadata (icon, color, etc.) */
  visualMetadata: Record<string, unknown>;
  issuedAt: Timestamp;
  expiresAt: Timestamp | null;
  revokedAt: Timestamp | null;
}

/** Reputation level thresholds (1-10) */
export const REPUTATION_LEVEL_THRESHOLDS: Record<number, { minReputation: number; title: string }> = {
  1:  { minReputation: 0,     title: 'Novice' },
  2:  { minReputation: 10,    title: 'Apprentice' },
  3:  { minReputation: 50,    title: 'Practitioner' },
  4:  { minReputation: 150,   title: 'Specialist' },
  5:  { minReputation: 400,   title: 'Expert' },
  6:  { minReputation: 1000,  title: 'Master' },
  7:  { minReputation: 2500,  title: 'Authority' },
  8:  { minReputation: 6000,  title: 'Luminary' },
  9:  { minReputation: 15000, title: 'Architect' },
  10: { minReputation: 40000, title: 'Ecosystem Pioneer' },
};

/** CAT level thresholds (log scale: 10, 30, 90, 270) */
export const CAT_LEVEL_THRESHOLDS: number[] = [10, 30, 90, 270, 810, 2430];

/** Leaderboard entry */
export interface LeaderboardEntry {
  validatorId: ValidatorId;
  validatorName: string;
  rank: number;
  reputationLevel: number;
  title: string;
  totalXP: number;
  seasonXP: number;
  badges: CredentialId[];
  domains: EntropyDomain[];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ecosystem Integration Types (Skill DAG, XP Oracle, Cross-Domain Exchange)
// ─────────────────────────────────────────────────────────────────────────────

/** Skill DAG node — for LevelUp Academy and XP Oracle */
export interface SkillNode {
  id: SkillNodeId;
  name: string;
  domain: EntropyDomain;
  /** Prerequisite skills */
  prerequisiteIds: SkillNodeId[];
  /** CAT level required */
  requiredCATLevel: number;
  /** Associated DFAO */
  dfaoId: DFAOId | null;
  /** Mastery threshold (validated performances) */
  masteryThreshold: number;
  metadata: Record<string, unknown>;
}

/** XP Oracle — external platform connector */
export interface XPOracleSource {
  id: string;
  platform: string; // 'github', 'chess.com', 'duolingo', etc.
  /** Mapping rules: how external achievements map to XP */
  mappingRules: XPOracleMappingRule[];
  /** Whether this source is active */
  isActive: boolean;
  /** Last sync timestamp */
  lastSyncAt: Timestamp | null;
}

export interface XPOracleMappingRule {
  externalMetric: string;
  entropyDomain: EntropyDomain;
  /** Conversion factor: XP = externalValue × factor */
  conversionFactor: number;
  /** Maximum XP per sync */
  maxXPPerSync: number;
}

/** Cross-domain XP exchange (from Doc 11 XPExchange class) */
export interface XPExchange {
  id: string;
  fromDomain: EntropyDomain;
  toDomain: EntropyDomain;
  /** Exchange rate (typically < 1 to discourage gaming) */
  exchangeRate: number;
  /** Transfer friction δ (default 0.02): XP_received = XP_sent × (1 - δ) */
  transferFriction: number;
  /** Minimum XP for exchange */
  minimumAmount: number;
  /** Whether governance has approved this exchange pair */
  governanceApproved: boolean;
}
