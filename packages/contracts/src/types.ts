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
 */
export interface BayesianPrior {
  /** P(claim is true) before observing new evidence */
  priorProbability: number;

  /** P(evidence | claim is true) — likelihood */
  likelihood: number;

  /** P(evidence | claim is false) — counter-likelihood */
  counterLikelihood: number;

  /** P(claim is true | evidence) — computed posterior */
  posteriorProbability: number;

  /** Number of evidence updates applied */
  updateCount: number;

  /** Confidence interval [lower, upper] at 95% */
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
