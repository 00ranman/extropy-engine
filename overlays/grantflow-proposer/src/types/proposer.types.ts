/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — GrantFlow Proposer Types
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Domain model for AI-powered grant proposal generation and refinement.
 *  Each proposal is linked to a submission from grantflow-discovery.
 *  Proposals are structured into sections, each of which can be generated
 *  from templates or AI, refined iteratively, and versioned.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
//  Enumerations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The seven canonical section types for a federal grant proposal.
 * These map directly to NIH, NSF, DOE, and other agency requirements.
 */
export enum SectionType {
  EXECUTIVE_SUMMARY      = 'EXECUTIVE_SUMMARY',
  PROJECT_NARRATIVE      = 'PROJECT_NARRATIVE',
  BUDGET_JUSTIFICATION   = 'BUDGET_JUSTIFICATION',
  EVALUATION_PLAN        = 'EVALUATION_PLAN',
  ORGANIZATIONAL_CAPACITY = 'ORGANIZATIONAL_CAPACITY',
  LETTERS_OF_SUPPORT     = 'LETTERS_OF_SUPPORT',
  REFERENCES             = 'REFERENCES',
}

/**
 * Lifecycle status for a grant proposal.
 *
 * - draft:      Proposal created, sections can be added manually
 * - generating: AI generation is actively running
 * - complete:   All sections generated and quality-scored
 * - exported:   Proposal has been exported for submission
 */
export type ProposalStatus = 'draft' | 'generating' | 'complete' | 'exported';

/**
 * Export format options for proposal documents.
 */
export type ExportFormat = 'markdown' | 'text';

// ─────────────────────────────────────────────────────────────────────────────
//  Core Domain Objects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A grant proposal — the primary aggregate root in this service.
 * Linked to a submission in grantflow-discovery via `submissionId`.
 * Contains an ordered list of sections that constitute the proposal document.
 */
export interface GfProposal {
  /** UUID primary key */
  id: string;

  /** References gf_submissions.id in grantflow-discovery */
  submissionId: string;

  /** Human-readable title of the grant opportunity */
  opportunityTitle: string;

  /** Grant-issuing agency (e.g., "NIH", "NSF", "DOE") */
  agency: string;

  /** Funding opportunity number from Grants.gov */
  opportunityNumber?: string;

  /** Researcher/PI name from the profile */
  principalInvestigator?: string;

  /** Requested funding amount in USD */
  requestedAmount?: number;

  /** Proposal duration (e.g., "3 years") */
  proposalDuration?: string;

  /** Current lifecycle status */
  status: ProposalStatus;

  /** Composite quality score (0–100), computed from section scores */
  qualityScore: number;

  /** Ordered list of proposal sections */
  sections: GfSection[];

  /** ISO-8601 creation timestamp */
  createdAt: string;

  /** ISO-8601 last-update timestamp */
  updatedAt: string;
}

/**
 * An individual section within a grant proposal.
 * Sections are versioned — each generation/refinement increments `version`.
 * Content is stored as markdown-compatible plain text.
 */
export interface GfSection {
  /** UUID primary key */
  id: string;

  /** Parent proposal ID */
  proposalId: string;

  /** The type/role of this section in the proposal */
  sectionType: SectionType;

  /** The section's textual content (markdown) */
  content: string;

  /** Version counter, incremented on each update */
  version: number;

  /** Quality score for this section (0–100) */
  qualityScore: number;

  /** Whether this section was AI-generated (true) or manually written (false) */
  isAiGenerated: boolean;

  /** ISO-8601 creation timestamp */
  createdAt: string;

  /** ISO-8601 last-update timestamp */
  updatedAt: string;
}

/**
 * A reusable template for a specific section type.
 * Templates contain placeholder variables in {curly_brace} syntax.
 * They serve as the scaffold for both AI-assisted and template-based generation.
 */
export interface GfTemplate {
  /** UUID primary key */
  id: string;

  /** Human-readable template name */
  name: string;

  /** The section type this template applies to */
  sectionType: SectionType;

  /** Template content with {placeholder} variables */
  content: string;

  /** Whether this is the system default for the section type */
  isDefault: boolean;

  /** ISO-8601 creation timestamp */
  createdAt: string;
}

/**
 * A single refinement pass on a proposal section.
 * Tracks the before/after content and quality delta for XP calculation.
 * Each refinement emits a COGNITIVE domain claim.
 */
export interface GfRefinement {
  /** UUID primary key */
  id: string;

  /** Parent proposal ID */
  proposalId: string;

  /** Section that was refined */
  sectionId: string;

  /** Content before refinement */
  beforeContent: string;

  /** Content after refinement */
  afterContent: string;

  /** Quality score improvement (positive = improvement) */
  qualityDelta: number;

  /** User-provided instructions for the refinement */
  instructions: string;

  /** ISO-8601 creation timestamp */
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Request / Response DTOs
// ─────────────────────────────────────────────────────────────────────────────

/** Input for creating a new proposal */
export interface CreateProposalInput {
  submissionId: string;
  opportunityTitle: string;
  agency: string;
  opportunityNumber?: string;
  principalInvestigator?: string;
  requestedAmount?: number;
  proposalDuration?: string;
}

/** Input for updating proposal metadata */
export interface UpdateProposalInput {
  opportunityTitle?: string;
  agency?: string;
  opportunityNumber?: string;
  principalInvestigator?: string;
  requestedAmount?: number;
  proposalDuration?: string;
  status?: ProposalStatus;
}

/** Filters for listing proposals */
export interface ListProposalsFilter {
  submissionId?: string;
  status?: ProposalStatus;
  agency?: string;
  limit?: number;
  offset?: number;
}

/** Input for adding a section */
export interface AddSectionInput {
  sectionType: SectionType;
  content: string;
  isAiGenerated?: boolean;
}

/** Input for updating a section */
export interface UpdateSectionInput {
  content: string;
}

/** Input for creating a template */
export interface CreateTemplateInput {
  name: string;
  sectionType: SectionType;
  content: string;
  isDefault?: boolean;
}

/** Context passed to generation functions */
export interface GenerationContext {
  /** The opportunity data from grantflow-discovery */
  opportunity?: OpportunityContext;
  /** The researcher profile data */
  profile?: ProfileContext;
  /** Specific instructions for this generation run */
  instructions?: string;
}

/** Opportunity data from grantflow-discovery */
export interface OpportunityContext {
  title: string;
  agency: string;
  opportunityNumber?: string;
  synopsis?: string;
  objectives?: string[];
  eligibilityRequirements?: string;
  awardAmount?: number;
  duration?: string;
  closeDate?: string;
  cfda?: string;
}

/** Researcher profile data from grantflow-discovery */
export interface ProfileContext {
  principalInvestigator: string;
  institution?: string;
  department?: string;
  expertise?: string[];
  priorWork?: string;
  publications?: string[];
  currentProjects?: string[];
  budget?: number;
  duration?: string;
}

/** Result of a generation or refinement operation */
export interface GenerationResult {
  content: string;
  qualityScore: number;
  tokensUsed?: number;
  model?: string;
  isAiGenerated: boolean;
}

/** Result of a full proposal quality computation */
export interface QualityReport {
  overallScore: number;
  sectionScores: Record<SectionType, number>;
  breakdown: {
    completeness: number;
    coherence: number;
    specificity: number;
    length: number;
  };
  recommendations: string[];
}

/** Claim context passed to claim service */
export interface ClaimContext {
  proposal: GfProposal;
  section?: GfSection;
  refinement?: GfRefinement;
  validatorId: string;
}
