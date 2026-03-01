/**
 * ===============================================================================
 *  EXTROPY ENGINE -- Shared Domain Contracts
 * ===============================================================================
 *
 *  Core formula:  XP = R * F * DeltaS * (w . E) * log(1/T_s)
 *
 *  Where:
 *    R   = Validator reputation (compressed evidence of past accuracy)
 *    F   = Feedback closure strength [0,1]
 *    DeltaS  = Net entropy reduction (Joule/Kelvin) across a closed causal loop
 *    w   = Domain-authority weight vector
 *    E   = Essentiality factor (how critical the task is to the loop)
 *    T_s  = Settlement time (time to close the verification loop)
 *
 *  Invariant: XP is minted if and only if a Loop closes with verified DeltaS > 0.
 *             No loop closure -> no value -> no mint.
 *
 * ===============================================================================
 */

// -----------------------------------------------------------------------------
//  Primitives & Identifiers
// -----------------------------------------------------------------------------

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

/** Entropy domain categories -- each has its own measurement protocol & c_L */
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
 * c_L^2 appears in the denominator of the irreducible form XP = DeltaS / c_L^2.
 * Higher c_L -> faster expected closure -> lower XP per unit DeltaS (easier loops).
 */
export const CAUSAL_CLOSURE_SPEEDS: Record<EntropyDomain, number> = {
  [EntropyDomain.COGNITIVE]:     1e-6,
  [EntropyDomain.CODE]:          1e-4,
  [EntropyDomain.SOCIAL]:        1e-3,
  [EntropyDomain.ECONOMIC]:      1e-2,
  [EntropyDomain.THERMODYNAMIC]: 1e-4,
  [EntropyDomain.INFORMATIONAL]: 1e-5,
};

// -----------------------------------------------------------------------------
//  Entropy Measurement
// -----------------------------------------------------------------------------

/**
 * A single entropy measurement taken at a point in time.
 * Two measurements (before/after) are needed to compute DeltaS for a loop.
 */
export interface EntropyMeasurement {
  id: MeasurementId;
  loopId: LoopId;
  domain: EntropyDomain;
  /** Raw entropy value in domain-native units (J/K for thermo, bits for info, etc.) */
  value: number;
  /** Measurement uncertainty -- feeds into Bayesian updating of claim truth */
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

// -----------------------------------------------------------------------------
//  Bayesian Priors & Epistemology
// -----------------------------------------------------------------------------

/**
 * A Bayesian prior attached to a claim or sub-claim.
 * The Epistemology Engine maintains and updates these as evidence arrives.
 */
export interface BayesianPrior {
  /** P(claim is true) before observing new evidence */
  priorProbability: number;
  /** P(evidence | claim is true) -- likelihood */
  likelihood: number;
  /** P(evidence | claim is false) -- counter-likelihood */
  counterLikelihood: number;
  /** P(claim is true | evidence) -- computed posterior */
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

// -----------------------------------------------------------------------------
//  Claims & Sub-Claims (Epistemology Engine)
// -----------------------------------------------------------------------------

export enum ClaimStatus {
  SUBMITTED     = 'submitted',
  DECOMPOSED    = 'decomposed',
  EVALUATED     = 'evaluated',
  VERIFIED      = 'verified',
  FALSIFIED     = 'falsified',
  UNDECIDABLE   = 'undecidable',
}

export interface Claim {
  id: ClaimId;
  loopId: LoopId;
  statement: string;
  domain: EntropyDomain;
  submitterId: ValidatorId;
  status: ClaimStatus;
  bayesianPrior: BayesianPrior;
  subClaimIds: SubClaimId[];
  truthScore: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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

export interface SubClaim {
  id: SubClaimId;
  claimId: ClaimId;
  loopId: LoopId;
  statement: string;
  domain: EntropyDomain;
  status: SubClaimStatus;
  bayesianPrior: BayesianPrior;
  measurementIds: MeasurementId[];
  assignedValidatorIds: ValidatorId[];
  weight: number;
  dependsOn: SubClaimId[];
  createdAt: Timestamp;
  resolvedAt?: Timestamp;
}

// -----------------------------------------------------------------------------
//  Validators & Reputation
// -----------------------------------------------------------------------------

export interface Validator {
  id: ValidatorId;
  name: string;
  type: 'human' | 'ai' | 'hybrid';
  domains: EntropyDomain[];
  reputation: ReputationScore;
  totalXpEarned: number;
  loopsParticipated: number;
  accurateValidations: number;
  currentTaskCount: number;
  maxConcurrentTasks: number;
  isActive: boolean;
  createdAt: Timestamp;
  lastActiveAt: Timestamp;
}

export interface ReputationScore {
  aggregate: number;
  byDomain: Record<EntropyDomain, number>;
  accrualRate: number;
  decayRate: number;
  currentStreak: number;
  penaltyCount: number;
  lastUpdatedAt: Timestamp;
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

// -----------------------------------------------------------------------------
//  Task Routing (SignalFlow Orchestrator)
// -----------------------------------------------------------------------------

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

export interface TaskRouting {
  id: TaskId;
  subClaimId: SubClaimId;
  loopId: LoopId;
  assignedValidatorId: ValidatorId;
  status: TaskStatus;
  priority: number;
  routingReason: RoutingReason;
  deadline: Timestamp;
  result?: ValidationResult;
  createdAt: Timestamp;
  assignedAt?: Timestamp;
  completedAt?: Timestamp;
}

export interface RoutingReason {
  domainMatchScore: number;
  reputationScore: number;
  loadScore: number;
  historicalAccuracyScore: number;
  compositeWeight: number;
  alternatives: Array<{
    validatorId: ValidatorId;
    compositeWeight: number;
  }>;
}

export interface ValidationResult {
  verdict: 'confirmed' | 'denied' | 'insufficient_evidence' | 'undecidable';
  confidence: number;
  evidenceMeasurementIds: MeasurementId[];
  justification: string;
  validationDurationSeconds: number;
}

// -----------------------------------------------------------------------------
//  Loop (Loop Ledger -- the atomic unit of value)
// -----------------------------------------------------------------------------

export enum LoopStatus {
  OPEN          = 'open',
  VALIDATING    = 'validating',
  CONSENSUS     = 'consensus',
  CLOSED        = 'closed',
  FAILED        = 'failed',
  ISOLATED      = 'isolated',
  SETTLED       = 'settled',
}

export interface Loop {
  id: LoopId;
  claimId: ClaimId;
  status: LoopStatus;
  domain: EntropyDomain;
  entropyBefore: EntropyMeasurement | null;
  entropyAfter: EntropyMeasurement | null;
  deltaS: number | null;
  validatorIds: ValidatorId[];
  taskIds: TaskId[];
  consensus: LoopConsensus | null;
  parentLoopIds: LoopId[];
  childLoopIds: LoopId[];
  settlementTimeSeconds: number | null;
  causalClosureSpeed: number;
  createdAt: Timestamp;
  closedAt?: Timestamp;
  settledAt?: Timestamp;
}

export interface LoopConsensus {
  vPlus: number;
  vMinus: number;
  passed: boolean;
  votes: ConsensusVote[];
  resolvedAt: Timestamp;
}

export interface ConsensusVote {
  validatorId: ValidatorId;
  vote: 'confirm' | 'deny' | 'abstain';
  reputationWeight: number;
  justification?: string;
}

// -----------------------------------------------------------------------------
//  XP Minting (XP Mint Service)
// -----------------------------------------------------------------------------

export enum MintStatus {
  PROVISIONAL   = 'provisional',
  CONFIRMED     = 'confirmed',
  BURNED        = 'burned',
}

export interface XPMintEvent {
  id: MintEventId;
  loopId: LoopId;
  status: MintStatus;
  reputationFactor: number;
  feedbackClosureStrength: number;
  deltaS: number;
  domainEssentialityProduct: number;
  settlementTimeFactor: number;
  xpValue: number;
  distribution: XPDistribution[];
  totalMinted: number;
  burnReason?: string;
  retroactiveValidationAt?: Timestamp;
  createdAt: Timestamp;
}

export interface XPDistribution {
  validatorId: ValidatorId;
  share: number;
  xpAmount: number;
  basis: string;
}

// -----------------------------------------------------------------------------
//  Inter-Service Events
// -----------------------------------------------------------------------------

export enum EventType {
  CLAIM_SUBMITTED             = 'epistemology.claim.submitted',
  CLAIM_DECOMPOSED            = 'epistemology.claim.decomposed',
  SUBCLAIM_UPDATED            = 'epistemology.subclaim.updated',
  CLAIM_EVALUATED             = 'epistemology.claim.evaluated',
  CLAIM_UNDECIDABLE           = 'epistemology.claim.undecidable',
  TASK_CREATED                = 'signalflow.task.created',
  TASK_ASSIGNED               = 'signalflow.task.assigned',
  TASK_COMPLETED              = 'signalflow.task.completed',
  TASK_TIMED_OUT              = 'signalflow.task.timed_out',
  TASK_REASSIGNED             = 'signalflow.task.reassigned',
  LOOP_OPENED                 = 'ledger.loop.opened',
  LOOP_MEASUREMENT_RECORDED   = 'ledger.loop.measurement_recorded',
  LOOP_CONSENSUS_STARTED      = 'ledger.loop.consensus_started',
  LOOP_CLOSED                 = 'ledger.loop.closed',
  LOOP_FAILED                 = 'ledger.loop.failed',
  LOOP_ISOLATED               = 'ledger.loop.isolated',
  LOOP_SETTLED                = 'ledger.loop.settled',
  REPUTATION_ACCRUED          = 'reputation.accrued',
  REPUTATION_DECAYED          = 'reputation.decayed',
  REPUTATION_PENALIZED        = 'reputation.penalized',
  XP_MINTED_PROVISIONAL       = 'mint.xp.provisional',
  XP_CONFIRMED                = 'mint.xp.confirmed',
  XP_BURNED                   = 'mint.xp.burned',
}

export interface DomainEvent<T extends EventType = EventType, P = unknown> {
  eventId: string;
  type: T;
  payload: P;
  source: ServiceName;
  correlationId: LoopId;
  timestamp: Timestamp;
  version: number;
}

export enum ServiceName {
  EPISTEMOLOGY_ENGINE = 'epistemology-engine',
  SIGNALFLOW         = 'signalflow',
  LOOP_LEDGER        = 'loop-ledger',
  REPUTATION         = 'reputation',
  XP_MINT            = 'xp-mint',
}

// -----------------------------------------------------------------------------
//  Event Payloads
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
//  Type-Safe Event Map
// -----------------------------------------------------------------------------

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

export type TypedDomainEvent<T extends EventType> = DomainEvent<T, EventPayloadMap[T]>;

// -----------------------------------------------------------------------------
//  XP Calculation Helpers
// -----------------------------------------------------------------------------

export interface XPFormulaInputs {
  reputation: number;
  feedbackClosure: number;
  deltaS: number;
  domainWeight: number;
  essentiality: number;
  settlementTimeSeconds: number;
}

export interface IrreducibleXPInputs {
  deltaS: number;
  causalClosureSpeed: number;
}

// -----------------------------------------------------------------------------
//  Service Health & API Contracts
// -----------------------------------------------------------------------------

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
