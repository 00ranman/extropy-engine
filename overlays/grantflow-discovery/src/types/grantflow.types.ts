/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Domain Types
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  All TypeScript interfaces and enums for the grantflow-discovery service.
 *  These model the grant discovery, matching, and submission pipeline.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Researcher Profile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A researcher profile containing the keywords, domains, and expertise
 * used to match grant opportunities from Grants.gov.
 */
export interface GfProfile {
  /** UUID primary key */
  id: string;
  /** Full name of the researcher */
  name: string;
  /** Email address (optional) */
  email?: string;
  /** Search keywords for grant matching (e.g. ["entropy", "IoT", "smart home"]) */
  keywords: string[];
  /** Research domains (e.g. ["informational", "thermodynamic"]) */
  domains: string[];
  /** List of past grant award numbers or titles */
  pastAwards: string[];
  /** Free-form expertise description areas */
  expertise: string[];
  /** Minimum acceptable award amount (USD) — used for matching */
  minAwardAmount?: number;
  /** Maximum acceptable award amount (USD) — used for matching */
  maxAwardAmount?: number;
  /** Eligible organization types (e.g. ["individual", "small_business"]) */
  eligibilityTypes: string[];
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last-updated timestamp */
  updatedAt: string;
}

/** Subset used for creation — id and timestamps are auto-generated */
export type GfProfileCreate = Omit<GfProfile, 'id' | 'createdAt' | 'updatedAt'>;

/** Subset used for partial updates */
export type GfProfileUpdate = Partial<GfProfileCreate>;

// ─────────────────────────────────────────────────────────────────────────────
//  Grant Opportunity
// ─────────────────────────────────────────────────────────────────────────────

/** Status of a grant opportunity as reported by Grants.gov */
export type GfOpportunityStatus =
  | 'forecasted'
  | 'posted'
  | 'closed'
  | 'archived';

/**
 * A grant opportunity discovered from the Grants.gov API.
 * Cached locally for matching and pipeline management.
 */
export interface GfOpportunity {
  /** UUID primary key (internal) */
  id: string;
  /** Grants.gov numeric opportunity ID */
  oppNumber: string;
  /** Grants.gov opportunity title */
  title: string;
  /** Granting agency name */
  agency: string;
  /** Granting agency code */
  agencyCode?: string;
  /** Full description text */
  description: string;
  /** Maximum award amount in USD */
  awardCeiling?: number;
  /** Minimum award amount in USD */
  awardFloor?: number;
  /** Expected number of awards */
  expectedAwards?: number;
  /** Opportunity open date (ISO-8601) */
  openDate?: string;
  /** Application close date (ISO-8601) */
  closeDate?: string;
  /** Grants.gov opportunity category */
  category?: string;
  /** Funding instrument type (e.g. "G" for grant, "CA" for cooperative agreement) */
  fundingInstrument?: string;
  /** Eligible applicant types */
  eligibility: string[];
  /** CFDA numbers */
  cfdaNumbers: string[];
  /** Current status */
  status: GfOpportunityStatus;
  /** Full raw JSON from Grants.gov API */
  rawData: Record<string, unknown>;
  /** ISO-8601 timestamp when this opportunity was first discovered */
  discoveredAt: string;
  /** ISO-8601 last-updated timestamp */
  updatedAt: string;
}

/** Grants.gov REST search parameters */
export interface GfSearchParams {
  keyword?: string;
  oppStatuses?: string;
  rows?: number;
  sortBy?: string;
  startRecordNum?: number;
  eligibilities?: string[];
  fundingCategories?: string[];
  fundingInstruments?: string[];
  awardCeilingMin?: number;
  awardCeilingMax?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Match
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A scored match between a grant opportunity and a researcher profile.
 * Score 0-100 based on keyword overlap, domain alignment, and award fit.
 */
export interface GfMatch {
  /** UUID primary key */
  id: string;
  /** Reference to GfOpportunity.id */
  opportunityId: string;
  /** Reference to GfProfile.id */
  profileId: string;
  /** Match score 0-100 */
  score: number;
  /** Human-readable reasons for this score */
  matchReasons: string[];
  /** Keyword matches found */
  keywordMatches: string[];
  /** Domain matches found */
  domainMatches: string[];
  /** Whether the award amount is within the profile's range */
  awardAmountFit: boolean;
  /** ISO-8601 creation timestamp */
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Submission Pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submission pipeline statuses.
 * Follows the lifecycle from discovery through final award/decline decision.
 */
export type GfSubmissionStatus =
  | 'discovered'
  | 'researching'
  | 'drafting'
  | 'review'
  | 'submitted'
  | 'awarded'
  | 'declined'
  | 'withdrawn';

/** A single status transition recorded in the history */
export interface GfStatusHistoryEntry {
  status: GfSubmissionStatus;
  timestamp: string;
  notes?: string;
  actorId?: string;
}

/**
 * A submission pipeline entry tracking an application from discovery
 * through final outcome.
 */
export interface GfSubmission {
  /** UUID primary key */
  id: string;
  /** Reference to GfOpportunity.id */
  opportunityId: string;
  /** Reference to GfProfile.id */
  profileId: string;
  /** Reference to a grantflow-proposer proposal ID (once created) */
  proposalId?: string;
  /** Current pipeline status */
  status: GfSubmissionStatus;
  /** Full status history for audit trail */
  statusHistory: GfStatusHistoryEntry[];
  /** Prepared SOAP XML payload for S2S submission (optional) */
  s2sPackageXml?: string;
  /** ISO-8601 timestamp when application was submitted to Grants.gov */
  submittedAt?: string;
  /** Tracking number returned by Grants.gov on submission */
  grantsGovTrackingNumber?: string;
  /** Notes or context about this submission */
  notes?: string;
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last-updated timestamp */
  updatedAt: string;
}

/** Parameters for creating a new submission */
export type GfSubmissionCreate = Pick<
  GfSubmission,
  'opportunityId' | 'profileId'
> & { notes?: string };

/** Parameters for filtering submission list queries */
export interface GfSubmissionFilters {
  profileId?: string;
  opportunityId?: string;
  status?: GfSubmissionStatus | GfSubmissionStatus[];
  limit?: number;
  offset?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Search Run
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log of a scheduled or manual grant discovery search execution.
 */
export interface GfSearchRun {
  /** UUID primary key */
  id: string;
  /** The search query/keywords used */
  query: string;
  /** Number of raw results returned by Grants.gov */
  resultsCount: number;
  /** Number of matches created above the threshold score */
  matchesFound: number;
  /** Number of Extropy Engine claims emitted */
  claimsEmitted: number;
  /** Whether the run completed successfully */
  success: boolean;
  /** Error message if run failed */
  errorMessage?: string;
  /** ISO-8601 timestamp when this search was executed */
  executedAt: string;
  /** Duration in milliseconds */
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Claim Records
// ─────────────────────────────────────────────────────────────────────────────

/** Types of claims emitted by grantflow-discovery */
export type GfClaimType =
  | 'grant.discovered'
  | 'grant.matched'
  | 'submission.prepared'
  | 'submission.submitted';

/** Status of a claim in the Extropy Engine verification pipeline */
export type GfClaimStatus =
  | 'pending'
  | 'submitted'
  | 'verified'
  | 'rejected'
  | 'xp_minted';

/**
 * Internal record of an Extropy Engine claim emitted by this service.
 * Ties a claim to its associated opportunity/profile/submission for
 * XP tracking when the verification loop closes.
 */
export interface GfClaimRecord {
  /** UUID primary key */
  id: string;
  /** The Epistemology Engine claim ID */
  claimId: string;
  /** The loop ID opened for this claim */
  loopId: string;
  /** What action triggered this claim */
  claimType: GfClaimType;
  /** Current status in the verification pipeline */
  status: GfClaimStatus;
  /** Reference to the opportunity (if applicable) */
  opportunityId?: string;
  /** Reference to the profile (if applicable) */
  profileId?: string;
  /** Reference to the submission (if applicable) */
  submissionId?: string;
  /** XP value minted (populated when loop closes) */
  xpMinted?: number;
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** ISO-8601 last-updated timestamp */
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Grants.gov API Types
// ─────────────────────────────────────────────────────────────────────────────

/** Raw opportunity object returned by Grants.gov REST API v2 */
export interface GrantsGovOpportunity {
  id: number;
  number: string;
  title: string;
  agencyCode: string;
  agencyName: string;
  openDate: string;
  closeDate: string;
  awardCeiling: number | null;
  awardFloor: number | null;
  expectedNumberOfAwards: number | null;
  description: string;
  cfdaNumbers: string[];
  eligibleApplicants: string[];
  fundingCategory: string | null;
  fundingInstrument: string | null;
  oppStatus: string;
  docType: string;
  [key: string]: unknown;
}

/** Search response envelope from Grants.gov REST API v2 */
export interface GrantsGovSearchResponse {
  data?: {
    hits?: GrantsGovOpportunity[];
    total?: number;
  };
  opportunities?: GrantsGovOpportunity[];
  totalRecords?: number;
  [key: string]: unknown;
}

/** Credentials for Grants.gov S2S SOAP submission */
export interface GrantsGovS2SCredentials {
  username: string;
  password: string;
  certPath?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Service-level configuration object */
export interface GfServiceConfig {
  epistemologyUrl: string;
  signalflowUrl: string;
  loopLedgerUrl: string;
  reputationUrl: string;
  xpMintUrl: string;
  governanceUrl: string;
  dfaoRegistryUrl: string;
  temporalUrl: string;
  tokenEconomyUrl: string;
  credentialsUrl: string;
  dagSubstrateUrl: string;
  grantflowProposerUrl: string;
}
