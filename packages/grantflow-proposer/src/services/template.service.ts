/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  GrantFlow Proposer — Template Service
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Manages the reusable section template library. Templates contain {placeholder}
 *  variables that are filled in by GenerationService with opportunity and profile
 *  data. Each section type has exactly one system-default template.
 *
 *  The 7 default templates are pre-seeded in the database migration, but this
 *  service also ensures they exist at startup by upserting them if missing.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuid } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type {
  GfTemplate,
  SectionType,
  CreateTemplateInput,
} from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Database Row Type
// ─────────────────────────────────────────────────────────────────────────────

interface TemplateRow {
  id:           string;
  name:         string;
  section_type: string;
  content:      string;
  is_default:   boolean;
  created_at:   Date;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Default Template Content
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The seven canonical default templates for federal grant proposals.
 * These serve as the primary path for template-based generation when
 * OPENAI_API_KEY is not configured.
 */
export const DEFAULT_TEMPLATES: Record<SectionType, { name: string; content: string }> = {
  EXECUTIVE_SUMMARY: {
    name: 'Default Executive Summary',
    content: `# Executive Summary

This project proposes to {objective}. Building on {prior_work}, our team will employ {methodology} to achieve {outcomes}.

**Project Title:** {opportunity_title}
**Principal Investigator:** {principal_investigator}
**Institution:** {institution}
**Funding Agency:** {agency}
**Total Budget Requested:** {budget}
**Project Duration:** {duration}

## Problem Statement

{problem_statement}

## Proposed Solution

Our approach leverages {key_innovation} to address the fundamental challenges of {research_domain}. The proposed work will directly advance the agency's priority areas by {alignment_with_priorities}.

## Team Qualifications

Our team brings {qualifications} to this effort. The PI has {pi_experience} and has previously {prior_achievements}. The collaborative team includes expertise in {team_expertise}.

## Expected Impact

Upon completion, this project will {expected_impact}. Results will be disseminated through {dissemination_plan}.`,
  },

  PROJECT_NARRATIVE: {
    name: 'Default Project Narrative',
    content: `# Project Narrative

## 1. Background and Significance

{background_significance}

The field of {research_domain} has made substantial progress in recent years, with particular advances in {recent_advances}. However, significant gaps remain in our understanding of {knowledge_gaps}. This project directly addresses these gaps by {gap_address_strategy}.

The significance of this work is supported by the following:
- {significance_point_1}
- {significance_point_2}
- {significance_point_3}

## 2. Research Objectives and Specific Aims

The long-term objective of this research is to {long_term_objective}. The specific aims of this project are:

**Aim 1:** {aim_1_title}
{aim_1_description}

**Aim 2:** {aim_2_title}
{aim_2_description}

**Aim 3:** {aim_3_title}
{aim_3_description}

## 3. Methodology

### Research Design
{research_design}

### Data Collection and Analysis
{data_collection}

### Preliminary Studies
{preliminary_studies}

### Potential Challenges and Mitigation
{challenges_mitigation}

## 4. Expected Outcomes

Upon successful completion of this project, we expect to:
1. {outcome_1}
2. {outcome_2}
3. {outcome_3}

These outcomes will be measured by {outcome_metrics}.

## 5. Timeline and Milestones

| Quarter | Milestone | Deliverable |
|---------|-----------|-------------|
| Q1–Q2   | {milestone_1} | {deliverable_1} |
| Q3–Q4   | {milestone_2} | {deliverable_2} |
| Q5–Q6   | {milestone_3} | {deliverable_3} |
| Q7–Q8   | {milestone_4} | {deliverable_4} |

## 6. Broader Impacts

This project advances scientific understanding by {scientific_contribution}. The educational activities associated with this project include {educational_activities}. The work will benefit {broader_community} through {broader_benefits}.`,
  },

  BUDGET_JUSTIFICATION: {
    name: 'Default Budget Justification',
    content: `# Budget Justification

**Total Requested Budget:** {total_budget}
**Project Duration:** {duration}
**Funding Agency:** {agency}

---

## A. Personnel

### Principal Investigator — {principal_investigator}
**Effort:** {pi_effort}% | **Annual Salary:** {pi_salary} | **Total Personnel Cost:** {pi_total}

The PI will provide overall scientific leadership for this project, including {pi_responsibilities}. The PI's expertise in {pi_expertise} is essential to the success of Aims {relevant_aims}.

### Co-Investigator — {co_investigator_name}
**Effort:** {co_i_effort}% | **Annual Salary:** {co_i_salary}

{co_i_justification}

### Graduate Research Assistants (×{num_grad_students})
**Annual Stipend per Student:** {grad_stipend} | **Total:** {grad_total}

Graduate students will conduct {grad_student_duties}. Their training is integral to the educational mission of this project.

### Fringe Benefits
Personnel fringe benefits are calculated at {fringe_rate}% of salaries: **{fringe_total}**

---

## B. Equipment

| Item | Cost | Justification |
|------|------|---------------|
| {equipment_1_name} | {equipment_1_cost} | {equipment_1_justification} |
| {equipment_2_name} | {equipment_2_cost} | {equipment_2_justification} |

**Equipment Subtotal:** {equipment_total}

---

## C. Travel

### Domestic Conference Travel
**Amount:** {domestic_travel_cost}

The PI and key personnel will present findings at {target_conferences}. Conference attendance is essential for {travel_justification}.

### Field Research Travel
**Amount:** {field_travel_cost}

{field_travel_justification}

**Travel Subtotal:** {travel_total}

---

## D. Supplies and Materials

| Category | Annual Cost | Justification |
|----------|-------------|---------------|
| {supplies_1_name} | {supplies_1_cost} | {supplies_1_justification} |
| {supplies_2_name} | {supplies_2_cost} | {supplies_2_justification} |

**Supplies Subtotal:** {supplies_total}

---

## E. Other Direct Costs

| Item | Cost | Justification |
|------|------|---------------|
| Participant support costs | {participant_support_cost} | {participant_support_justification} |
| Subcontracts | {subcontract_cost} | {subcontract_justification} |
| Publication costs | {publication_cost} | Open-access dissemination of results |

**Other Direct Costs Subtotal:** {other_direct_total}

---

## F. Indirect Costs (F&A)

Indirect costs are calculated at {indirect_rate}% of Modified Total Direct Costs (MTDC): **{indirect_total}**

The rate is based on {institution}'s federally negotiated rate agreement.

---

## Budget Summary

| Category | Year 1 | Year 2 | Year 3 | Total |
|----------|--------|--------|--------|-------|
| Personnel | {y1_personnel} | {y2_personnel} | {y3_personnel} | {total_personnel} |
| Equipment | {y1_equipment} | {y2_equipment} | {y3_equipment} | {total_equipment} |
| Travel | {y1_travel} | {y2_travel} | {y3_travel} | {total_travel} |
| Supplies | {y1_supplies} | {y2_supplies} | {y3_supplies} | {total_supplies} |
| Other Direct | {y1_other} | {y2_other} | {y3_other} | {total_other} |
| Indirect Costs | {y1_indirect} | {y2_indirect} | {y3_indirect} | {total_indirect} |
| **TOTAL** | **{y1_total}** | **{y2_total}** | **{y3_total}** | **{grand_total}** |`,
  },

  EVALUATION_PLAN: {
    name: 'Default Evaluation Plan',
    content: `# Evaluation Plan

## 1. Evaluation Framework

This evaluation follows a {evaluation_framework_type} framework to assess both process fidelity and outcome achievement. The evaluation is designed to answer the following primary questions:

1. {evaluation_question_1}
2. {evaluation_question_2}
3. {evaluation_question_3}

## 2. Performance Metrics and Indicators

### Primary Outcome Metrics

| Metric | Baseline | Year 1 Target | Year 2 Target | Year 3 Target | Data Source |
|--------|----------|---------------|---------------|---------------|-------------|
| {metric_1_name} | {metric_1_baseline} | {metric_1_y1} | {metric_1_y2} | {metric_1_y3} | {metric_1_source} |
| {metric_2_name} | {metric_2_baseline} | {metric_2_y1} | {metric_2_y2} | {metric_2_y3} | {metric_2_source} |
| {metric_3_name} | {metric_3_baseline} | {metric_3_y1} | {metric_3_y2} | {metric_3_y3} | {metric_3_source} |

### Process Metrics

- **Activity completion rate:** {activity_completion_target}%
- **Participant engagement:** {engagement_target}
- **Timeline adherence:** {timeline_adherence_target}%

## 3. Data Collection Methods

### Quantitative Data
{quantitative_data_methods}

### Qualitative Data
{qualitative_data_methods}

### Data Quality Assurance
{data_quality_procedures}

## 4. Analysis Approach

### Statistical Methods
{statistical_methods}

### Qualitative Analysis
{qualitative_analysis_approach}

### Mixed Methods Integration
{mixed_methods_approach}

## 5. Reporting Schedule

| Report | Audience | Due Date | Contents |
|--------|----------|----------|----------|
| Quarterly Progress Report | Program Officer | {quarterly_due_dates} | Activity updates, preliminary metrics |
| Annual Performance Report | {agency} | End of each project year | Full metric reporting, narrative |
| Final Evaluation Report | {agency} + Public | 90 days post-project | Comprehensive findings, recommendations |

## 6. External Evaluator

{external_evaluator_name} of {external_evaluator_institution} will serve as the independent external evaluator. Their qualifications include {evaluator_qualifications}. The evaluator will {evaluator_responsibilities}.`,
  },

  ORGANIZATIONAL_CAPACITY: {
    name: 'Default Organizational Capacity',
    content: `# Organizational Capacity

## 1. Institutional Overview

{institution} has a distinguished history of conducting federally funded research in {research_domains}. Founded in {institution_founding}, the institution serves {institution_description}.

### Research Enterprise
- **Annual research expenditures:** {annual_research_expenditures}
- **Active federal grants:** {active_federal_grants}
- **Sponsored programs office:** {spo_description}

## 2. Relevant Past Performance

### Representative Awards

| Grant | Agency | Period | Award Amount | PI | Outcome |
|-------|--------|--------|--------------|----|---------|
| {grant_1_title} | {grant_1_agency} | {grant_1_period} | {grant_1_amount} | {grant_1_pi} | {grant_1_outcome} |
| {grant_2_title} | {grant_2_agency} | {grant_2_period} | {grant_2_amount} | {grant_2_pi} | {grant_2_outcome} |

### Programmatic Accomplishments
{past_accomplishments}

## 3. Key Personnel and Qualifications

### {principal_investigator}, {pi_title}
{pi_bio}

**Selected Publications:**
{pi_publications}

### Co-Investigators and Senior Personnel
{co_investigator_bios}

## 4. Facilities and Resources

### Laboratory and Research Space
{laboratory_description}

### Computing and Data Infrastructure
{computing_infrastructure}

### Library and Information Resources
{library_resources}

### Administrative and Support Infrastructure
{administrative_infrastructure}

## 5. Partnerships and Collaborations

{partnerships_description}

## 6. Commitment to This Project

{institution} is committed to providing the following resources to support this project:
- {institutional_resource_1}
- {institutional_resource_2}
- {institutional_resource_3}`,
  },

  LETTERS_OF_SUPPORT: {
    name: 'Default Letter of Support Template',
    content: `# Letters of Support

---

{partner_name}
{partner_title}
{partner_institution}
{partner_address}

{date}

Program Officer
{agency}
{agency_address}

**Re: Letter of Support for "{opportunity_title}" — {principal_investigator}, {institution}**

Dear Program Officer,

I am writing in strong support of the proposal submitted by {principal_investigator} at {institution} to the {agency}. As {partner_role_description}, I am uniquely positioned to attest to the significance, feasibility, and expected impact of this work.

**Significance of the Proposed Research**

{significance_statement}

**Basis for Collaboration**

Our organizations have collaborated since {collaboration_start_date} on {prior_collaboration_description}. This relationship has {collaboration_outcomes}. The proposed project represents a natural extension of this partnership.

**Specific Contributions**

Under this project, {partner_institution} will provide the following:
1. {contribution_1}
2. {contribution_2}
3. {contribution_3}

These contributions are not contingent on additional funding and represent a firm commitment from our organization.

**Anticipated Impact**

We expect that the successful completion of this project will {expected_impact_statement}. Our organization will benefit through {organizational_benefit}.

I am available to discuss this letter at your convenience and can be reached at {partner_email} or {partner_phone}.

Sincerely,

{partner_name}
{partner_title}
{partner_institution}

---

*[Additional letters of support from collaborating organizations are attached as appendices.]*`,
  },

  REFERENCES: {
    name: 'Default References',
    content: `# References and Preliminary Studies

## 1. Preliminary Data

### Overview of Preliminary Studies

{preliminary_overview}

### Study 1: {preliminary_study_1_title}
**Methods:** {preliminary_study_1_methods}
**Results:** {preliminary_study_1_results}
**Significance:** {preliminary_study_1_significance}

### Study 2: {preliminary_study_2_title}
**Methods:** {preliminary_study_2_methods}
**Results:** {preliminary_study_2_results}
**Significance:** {preliminary_study_2_significance}

## 2. Prior Publications Supporting This Proposal

The following publications from our lab provide the scientific foundation for this project:

1. {author_list_1} ({year_1}). {title_1}. *{journal_1}*, {volume_1}({issue_1}), {pages_1}. DOI: {doi_1}

2. {author_list_2} ({year_2}). {title_2}. *{journal_2}*, {volume_2}({issue_2}), {pages_2}. DOI: {doi_2}

3. {author_list_3} ({year_3}). {title_3}. *{journal_3}*, {volume_3}({issue_3}), {pages_3}. DOI: {doi_3}

## 3. Literature References

1. {ref_1_authors} ({ref_1_year}). {ref_1_title}. *{ref_1_journal}*, {ref_1_vol_pages}. DOI: {ref_1_doi}

2. {ref_2_authors} ({ref_2_year}). {ref_2_title}. *{ref_2_journal}*, {ref_2_vol_pages}. DOI: {ref_2_doi}

3. {ref_3_authors} ({ref_3_year}). {ref_3_title}. *{ref_3_journal}*, {ref_3_vol_pages}. DOI: {ref_3_doi}

4. {ref_4_authors} ({ref_4_year}). {ref_4_title}. *{ref_4_journal}*, {ref_4_vol_pages}. DOI: {ref_4_doi}

5. {ref_5_authors} ({ref_5_year}). {ref_5_title}. *{ref_5_journal}*, {ref_5_vol_pages}. DOI: {ref_5_doi}

---

*All references formatted per {citation_style} guidelines. Full bibliography available upon request.*`,
  },
} as Record<string, { name: string; content: string }>;

// ─────────────────────────────────────────────────────────────────────────────
//  TemplateService
// ─────────────────────────────────────────────────────────────────────────────

export class TemplateService {
  constructor(private readonly db: DatabaseService) {}

  // ── Mapper ─────────────────────────────────────────────────────────────────

  private mapTemplate(row: TemplateRow): GfTemplate {
    return {
      id:          row.id,
      name:        row.name,
      sectionType: row.section_type as SectionType,
      content:     row.content,
      isDefault:   row.is_default,
      createdAt:   row.created_at.toISOString(),
    };
  }

  // ── Seed Defaults ──────────────────────────────────────────────────────────

  /**
   * Ensure all 7 default templates exist in the database.
   * Uses INSERT ... ON CONFLICT DO NOTHING so it is idempotent.
   * Called once at service startup.
   */
  async seedDefaultTemplates(): Promise<void> {
    const entries = Object.entries(DEFAULT_TEMPLATES) as Array<[SectionType, { name: string; content: string }]>;
    let seeded = 0;

    for (const [sectionType, tmpl] of entries) {
      const existing = await this.getDefaultTemplate(sectionType);
      if (!existing) {
        await this.db.query(
          `INSERT INTO gf_templates (id, name, section_type, content, is_default)
           VALUES ($1, $2, $3, $4, TRUE)`,
          [uuid(), tmpl.name, sectionType, tmpl.content],
        );
        seeded++;
      }
    }

    if (seeded > 0) {
      console.log(`[proposer:template] Seeded ${seeded} default template(s)`);
    }
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  /**
   * Create a new reusable template.
   *
   * @param input - Template name, section type, content, and isDefault flag
   * @returns The created GfTemplate
   */
  async createTemplate(input: CreateTemplateInput): Promise<GfTemplate> {
    // If this is marked as the new default, clear the existing default
    if (input.isDefault) {
      await this.db.query(
        'UPDATE gf_templates SET is_default = FALSE WHERE section_type = $1 AND is_default = TRUE',
        [input.sectionType],
      );
    }

    const id = uuid();
    const { rows } = await this.db.query<TemplateRow>(
      `INSERT INTO gf_templates (id, name, section_type, content, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, input.name, input.sectionType, input.content, input.isDefault ?? false],
    );

    const template = this.mapTemplate(rows[0]);
    console.log(`[proposer:template] Created template ${id} (type=${input.sectionType})`);
    return template;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Get a template by UUID.
   *
   * @param id - The template UUID
   */
  async getTemplate(id: string): Promise<GfTemplate | null> {
    const { rows } = await this.db.query<TemplateRow>(
      'SELECT * FROM gf_templates WHERE id = $1',
      [id],
    );
    return rows.length > 0 ? this.mapTemplate(rows[0]) : null;
  }

  /**
   * List templates, optionally filtered by section type.
   *
   * @param sectionType - Optional filter to return only templates of this type
   */
  async listTemplates(sectionType?: SectionType): Promise<GfTemplate[]> {
    if (sectionType) {
      const { rows } = await this.db.query<TemplateRow>(
        'SELECT * FROM gf_templates WHERE section_type = $1 ORDER BY is_default DESC, created_at DESC',
        [sectionType],
      );
      return rows.map(r => this.mapTemplate(r));
    }

    const { rows } = await this.db.query<TemplateRow>(
      'SELECT * FROM gf_templates ORDER BY section_type, is_default DESC, created_at DESC',
    );
    return rows.map(r => this.mapTemplate(r));
  }

  /**
   * Get the default template for a specific section type.
   * Returns null if no default template is found.
   *
   * @param sectionType - The section type to look up
   */
  async getDefaultTemplate(sectionType: SectionType): Promise<GfTemplate | null> {
    const { rows } = await this.db.query<TemplateRow>(
      'SELECT * FROM gf_templates WHERE section_type = $1 AND is_default = TRUE LIMIT 1',
      [sectionType],
    );
    return rows.length > 0 ? this.mapTemplate(rows[0]) : null;
  }
}
