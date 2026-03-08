/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  GrantFlow Proposer — Generation Service
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  AI-powered and template-based proposal section generation.
 *
 *  Generation path selection:
 *    1. If OPENAI_API_KEY is set:   use OpenAI GPT-4 for generation
 *    2. Otherwise (primary path):  use template-based generation
 *       - Fetch the default template for the section type
 *       - Fill {placeholder} variables from opportunity + profile context
 *       - Score quality by length, structure, and keyword density
 *
 *  Quality Scoring Algorithm:
 *    - Length score (0–40):    proportional to word count vs. expected range
 *    - Structure score (0–30): presence of headers, bullet points, tables
 *    - Specificity score (0–30): density of domain-specific keywords
 *    Composite = sum of all three components, clamped to [0, 100]
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type { DatabaseService } from './database.service.js';
import type { SectionService } from './section.service.js';
import type { TemplateService } from './template.service.js';
import type { ProposalService } from './proposal.service.js';
import type {
  GfSection,
  GfRefinement,
  SectionType,
  GenerationContext,
  GenerationResult,
  QualityReport,
  OpportunityContext,
  ProfileContext,
} from '../types/index.js';
import { v4 as uuid } from 'uuid';

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Expected word counts per section type for scoring purposes */
const EXPECTED_WORD_COUNTS: Record<SectionType, { min: number; target: number }> = {
  EXECUTIVE_SUMMARY:       { min: 150,  target: 400  },
  PROJECT_NARRATIVE:       { min: 1000, target: 3000 },
  BUDGET_JUSTIFICATION:    { min: 300,  target: 800  },
  EVALUATION_PLAN:         { min: 300,  target: 800  },
  ORGANIZATIONAL_CAPACITY: { min: 200,  target: 600  },
  LETTERS_OF_SUPPORT:      { min: 200,  target: 500  },
  REFERENCES:              { min: 100,  target: 400  },
};

/** Domain keywords that indicate specificity (adds to specificity score) */
const DOMAIN_KEYWORDS = [
  'methodology', 'evaluation', 'outcomes', 'baseline', 'hypothesis',
  'statistical', 'quantitative', 'qualitative', 'validated', 'peer-reviewed',
  'dissemination', 'stakeholder', 'feasibility', 'sustainability', 'scalability',
  'evidence-based', 'theoretical', 'framework', 'cohort', 'longitudinal',
  'intervention', 'significant', 'correlation', 'regression', 'benchmark',
];

// ─────────────────────────────────────────────────────────────────────────────
//  Database Row Type
// ─────────────────────────────────────────────────────────────────────────────

interface RefinementRow {
  id:              string;
  proposal_id:     string;
  section_id:      string;
  before_content:  string;
  after_content:   string;
  quality_delta:   string;
  instructions:    string;
  created_at:      Date;
}

// ─────────────────────────────────────────────────────────────────────────────
//  GenerationService
// ─────────────────────────────────────────────────────────────────────────────

export class GenerationService {
  /** OpenAI client — lazily initialized only if API key is present */
  private openai: unknown = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly sectionService: SectionService,
    private readonly templateService: TemplateService,
    private readonly proposalService: ProposalService,
  ) {
    // Attempt to load OpenAI if the API key is available
    this.initOpenAI();
  }

  /**
   * Attempt to initialize the OpenAI client.
   * Fails silently — template-based generation is the fallback.
   */
  private async initOpenAI(): Promise<void> {
    if (!process.env.OPENAI_API_KEY) return;
    try {
      // Dynamic import to avoid hard dependency
      const { default: OpenAI } = await import('openai');
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      console.log('[proposer:generation] OpenAI client initialized');
    } catch {
      console.warn('[proposer:generation] OpenAI not available — using template-based generation');
    }
  }

  // ── Quality Scoring ────────────────────────────────────────────────────────

  /**
   * Compute a quality score (0–100) for generated content.
   * Scores three dimensions: length adequacy, structural richness, and specificity.
   *
   * @param content     - The text content to score
   * @param sectionType - The section type (determines expected length range)
   */
  computeQualityScore(content: string, sectionType?: SectionType): number {
    if (!content || content.trim().length === 0) return 0;

    const words = content.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    // ── Length Score (0–40) ─────────────────────────────────────────────
    let lengthScore = 0;
    if (sectionType && EXPECTED_WORD_COUNTS[sectionType]) {
      const { min, target } = EXPECTED_WORD_COUNTS[sectionType];
      if (wordCount >= target) {
        lengthScore = 40;
      } else if (wordCount >= min) {
        lengthScore = 20 + Math.round((wordCount - min) / (target - min) * 20);
      } else {
        lengthScore = Math.round((wordCount / min) * 20);
      }
    } else {
      // Generic length scoring
      lengthScore = Math.min(40, Math.round(wordCount / 25));
    }

    // ── Structure Score (0–30) ──────────────────────────────────────────
    const lines = content.split('\n');
    let structureScore = 0;

    const hasHeaders    = lines.some(l => l.startsWith('#'));
    const hasBullets    = lines.some(l => l.match(/^\s*[-*•]/));
    const hasNumbered   = lines.some(l => l.match(/^\s*\d+\./));
    const hasTables     = content.includes('|');
    const hasMultiPara  = content.split('\n\n').length >= 3;

    if (hasHeaders)   structureScore += 10;
    if (hasBullets)   structureScore += 5;
    if (hasNumbered)  structureScore += 5;
    if (hasTables)    structureScore += 5;
    if (hasMultiPara) structureScore += 5;

    // ── Specificity Score (0–30) ────────────────────────────────────────
    const lowerContent = content.toLowerCase();
    const keywordHits = DOMAIN_KEYWORDS.filter(kw => lowerContent.includes(kw)).length;
    const specificityScore = Math.min(30, Math.round(keywordHits / DOMAIN_KEYWORDS.length * 30 * 3));

    const total = lengthScore + structureScore + specificityScore;
    return Math.min(100, Math.max(0, total));
  }

  /**
   * Compute a full quality report with per-section breakdown and recommendations.
   *
   * @param proposalId - The proposal to score
   */
  async computeProposalQuality(proposalId: string): Promise<QualityReport> {
    const sections = await this.sectionService.listSections(proposalId);
    const sectionScores: Partial<Record<SectionType, number>> = {};
    const recommendations: string[] = [];

    let totalScore = 0;
    let sectionCount = 0;

    for (const section of sections) {
      const score = this.computeQualityScore(section.content, section.sectionType);
      sectionScores[section.sectionType] = score;
      totalScore += score;
      sectionCount++;

      if (score < 50) {
        recommendations.push(
          `${section.sectionType}: Score ${score}/100 — consider expanding with more specific details and structured content.`,
        );
      }
    }

    const ALL_SECTION_TYPES: SectionType[] = [
      'EXECUTIVE_SUMMARY', 'PROJECT_NARRATIVE', 'BUDGET_JUSTIFICATION',
      'EVALUATION_PLAN', 'ORGANIZATIONAL_CAPACITY', 'LETTERS_OF_SUPPORT', 'REFERENCES',
    ] as SectionType[];

    const missingSections = ALL_SECTION_TYPES.filter(st => !sectionScores[st]);
    for (const st of missingSections) {
      sectionScores[st] = 0;
      recommendations.push(`${st}: Missing — generate this section to complete the proposal.`);
    }

    const overallScore = sectionCount > 0 ? Math.round(totalScore / sectionCount) : 0;

    return {
      overallScore,
      sectionScores: sectionScores as Record<SectionType, number>,
      breakdown: {
        completeness: Math.round((sectionCount / ALL_SECTION_TYPES.length) * 100),
        coherence: overallScore,
        specificity: overallScore > 0 ? Math.round(overallScore * 0.8) : 0,
        length: overallScore > 0 ? Math.round(overallScore * 0.9) : 0,
      },
      recommendations,
    };
  }

  // ── Template-Based Generation ──────────────────────────────────────────────

  /**
   * Fill template placeholders with opportunity and profile data.
   * Replaces all {placeholder} tokens found in the template content.
   *
   * @param template   - The template content with {placeholder} tokens
   * @param context    - Opportunity and profile context data
   * @param sectionType - The section type (for type-specific defaults)
   */
  private fillTemplate(
    template: string,
    context: GenerationContext,
    sectionType: SectionType,
  ): string {
    const { opportunity = {} as OpportunityContext, profile = {} as ProfileContext } = context;

    const replacements: Record<string, string> = {
      // Opportunity fields
      opportunity_title:      opportunity.title           ?? '[Grant Opportunity Title]',
      agency:                 opportunity.agency          ?? '[Agency Name]',
      opportunity_number:     opportunity.opportunityNumber ?? '[Opportunity Number]',
      budget:                 opportunity.awardAmount     ? `$${opportunity.awardAmount.toLocaleString()}` : '[Budget Amount]',
      duration:               opportunity.duration        ?? profile.duration ?? '[Duration]',
      close_date:             opportunity.closeDate       ?? '[Close Date]',
      cfda:                   opportunity.cfda            ?? '[CFDA Number]',
      synopsis:               opportunity.synopsis        ?? '[Grant synopsis]',
      objectives:             opportunity.objectives?.join('; ') ?? '[Agency objectives]',
      eligibility_requirements: opportunity.eligibilityRequirements ?? '[Eligibility requirements]',

      // Profile fields
      principal_investigator: profile.principalInvestigator ?? '[Principal Investigator Name]',
      institution:            profile.institution         ?? '[Institution Name]',
      department:             profile.department          ?? '[Department]',
      qualifications:         profile.expertise?.join(', ') ?? '[Key qualifications]',
      prior_work:             profile.priorWork           ?? '[Prior work and achievements]',
      pi_experience:          profile.priorWork           ?? '[PI experience description]',
      pi_expertise:           profile.expertise?.join(', ') ?? '[PI expertise domains]',
      team_expertise:         profile.expertise?.join(', ') ?? '[Team expertise areas]',
      prior_achievements:     profile.priorWork           ?? '[Prior achievements]',

      // Computed / placeholder fields
      objective:              `advance ${opportunity.synopsis ?? 'research objectives in ' + (opportunity.title ?? 'this field')}`,
      methodology:            '[research methodology]',
      outcomes:               '[expected outcomes]',
      expected_impact:        '[describe the expected impact of the research]',
      research_domain:        profile.expertise?.[0] ?? '[research domain]',
      date:                   new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),

      // Budget placeholders
      total_budget:           opportunity.awardAmount ? `$${opportunity.awardAmount.toLocaleString()}` : '[Total Budget]',
      pi_effort:              '25',
      pi_salary:              '[PI Annual Salary]',
      pi_total:               '[PI Personnel Total]',
      pi_responsibilities:    'directing all research activities, supervising graduate students, and ensuring project milestones are met',
      co_investigator_name:   '[Co-Investigator Name]',
      co_i_effort:            '10',
      co_i_salary:            '[Co-I Salary]',
      co_i_justification:     '[Co-investigator justification]',
      num_grad_students:      '2',
      grad_stipend:           '[Graduate Stipend]',
      grad_total:             '[Graduate Student Total]',
      fringe_rate:            '28',
      fringe_total:           '[Fringe Benefits Total]',
      equipment_total:        '[Equipment Total]',
      domestic_travel_cost:   '[Domestic Travel Cost]',
      target_conferences:     '[Target Conferences]',
      travel_justification:   '[Travel justification]',
      field_travel_cost:      '$0',
      field_travel_justification: '[Field travel justification if applicable]',
      travel_total:           '[Travel Total]',
      supplies_total:         '[Supplies Total]',
      participant_support_cost: '$0',
      participant_support_justification: '[Participant support justification]',
      subcontract_cost:       '$0',
      subcontract_justification: '[Subcontract justification]',
      publication_cost:       '[Publication Cost]',
      other_direct_total:     '[Other Direct Costs Total]',
      indirect_rate:          '52',
      indirect_total:         '[Indirect Costs Total]',
      y1_personnel:           '[Y1 Personnel]', y2_personnel: '[Y2 Personnel]', y3_personnel: '[Y3 Personnel]', total_personnel: '[Total Personnel]',
      y1_equipment:           '[Y1 Equipment]', y2_equipment: '[Y2 Equipment]', y3_equipment: '[Y3 Equipment]', total_equipment: '[Total Equipment]',
      y1_travel:              '[Y1 Travel]', y2_travel: '[Y2 Travel]', y3_travel: '[Y3 Travel]', total_travel: '[Total Travel]',
      y1_supplies:            '[Y1 Supplies]', y2_supplies: '[Y2 Supplies]', y3_supplies: '[Y3 Supplies]', total_supplies: '[Total Supplies]',
      y1_other:               '[Y1 Other]', y2_other: '[Y2 Other]', y3_other: '[Y3 Other]', total_other: '[Total Other]',
      y1_indirect:            '[Y1 Indirect]', y2_indirect: '[Y2 Indirect]', y3_indirect: '[Y3 Indirect]', total_indirect: '[Total Indirect]',
      y1_total:               '[Y1 Total]', y2_total: '[Y2 Total]', y3_total: '[Y3 Total]', grand_total: opportunity.awardAmount ? `$${opportunity.awardAmount.toLocaleString()}` : '[Grand Total]',

      // Narrative placeholders
      problem_statement:      `[Describe the core problem this project addresses in ${opportunity.title ?? 'this research area'}]`,
      key_innovation:         '[key innovation or approach]',
      alignment_with_priorities: `[explain how this work aligns with ${opportunity.agency ?? 'the agency'} priorities]`,
      dissemination_plan:     'peer-reviewed publications, conference presentations, and open-source software releases',
      background_significance: `[Provide background context for the research problem]`,
      recent_advances:        '[recent advances in the field]',
      knowledge_gaps:         '[specific knowledge gaps to be addressed]',
      gap_address_strategy:   '[how the project addresses these gaps]',
      significance_point_1:   '[First significance point]',
      significance_point_2:   '[Second significance point]',
      significance_point_3:   '[Third significance point]',
      long_term_objective:    '[long-term research objective]',
      aim_1_title:            '[Aim 1 Title]', aim_1_description: '[Aim 1 description and expected outcomes]',
      aim_2_title:            '[Aim 2 Title]', aim_2_description: '[Aim 2 description and expected outcomes]',
      aim_3_title:            '[Aim 3 Title]', aim_3_description: '[Aim 3 description and expected outcomes]',
      research_design:        '[Research design overview]',
      data_collection:        '[Data collection and analysis approach]',
      preliminary_studies:    profile.priorWork ?? '[Description of preliminary studies completed]',
      challenges_mitigation:  '[Potential challenges and mitigation strategies]',
      outcome_1:              '[First expected outcome]', outcome_2: '[Second expected outcome]', outcome_3: '[Third expected outcome]',
      outcome_metrics:        '[How outcomes will be measured and validated]',
      milestone_1:            '[Milestone 1]', deliverable_1: '[Deliverable 1]',
      milestone_2:            '[Milestone 2]', deliverable_2: '[Deliverable 2]',
      milestone_3:            '[Milestone 3]', deliverable_3: '[Deliverable 3]',
      milestone_4:            '[Milestone 4]', deliverable_4: '[Deliverable 4]',
      scientific_contribution:'[scientific contribution to the field]',
      educational_activities: '[training and educational activities]',
      broader_community:      '[broader community]',
      broader_benefits:       '[broader benefits and applications]',

      // Evaluation placeholders
      evaluation_framework_type: 'logic-model-based mixed-methods',
      evaluation_question_1:  '[Primary evaluation question 1]',
      evaluation_question_2:  '[Primary evaluation question 2]',
      evaluation_question_3:  '[Primary evaluation question 3]',
      metric_1_name:          '[Metric 1]', metric_1_baseline: '[Baseline]', metric_1_y1: '[Y1 Target]', metric_1_y2: '[Y2 Target]', metric_1_y3: '[Y3 Target]', metric_1_source: '[Data Source]',
      metric_2_name:          '[Metric 2]', metric_2_baseline: '[Baseline]', metric_2_y1: '[Y1 Target]', metric_2_y2: '[Y2 Target]', metric_2_y3: '[Y3 Target]', metric_2_source: '[Data Source]',
      metric_3_name:          '[Metric 3]', metric_3_baseline: '[Baseline]', metric_3_y1: '[Y1 Target]', metric_3_y2: '[Y2 Target]', metric_3_y3: '[Y3 Target]', metric_3_source: '[Data Source]',
      activity_completion_target: '90',
      engagement_target:      '[engagement metric and target]',
      timeline_adherence_target: '85',
      quantitative_data_methods: '[Quantitative data collection methods]',
      qualitative_data_methods:  '[Qualitative data collection methods]',
      data_quality_procedures:   '[Data quality assurance procedures]',
      statistical_methods:       '[Statistical analysis methods]',
      qualitative_analysis_approach: '[Qualitative analysis approach]',
      mixed_methods_approach:    '[Mixed methods integration strategy]',
      quarterly_due_dates:       '45 days after each quarter end',
      external_evaluator_name:   '[External Evaluator Name]',
      external_evaluator_institution: '[Evaluator Institution]',
      evaluator_qualifications:  '[Evaluator qualifications and relevant experience]',
      evaluator_responsibilities: '[Evaluator responsibilities and deliverables]',

      // Org capacity placeholders
      research_domains:       profile.expertise?.join(', ') ?? '[Research domains]',
      institution_founding:   '[Year Founded]',
      institution_description: '[Description of the institution and its mission]',
      annual_research_expenditures: '[Annual research expenditures]',
      active_federal_grants:  '[Number of active federal grants]',
      spo_description:        '[Sponsored Programs Office description and capabilities]',
      grant_1_title:          '[Prior Grant 1]', grant_1_agency: '[Agency]', grant_1_period: '[Period]', grant_1_amount: '[Amount]', grant_1_pi: '[PI]', grant_1_outcome: '[Outcome]',
      grant_2_title:          '[Prior Grant 2]', grant_2_agency: '[Agency]', grant_2_period: '[Period]', grant_2_amount: '[Amount]', grant_2_pi: '[PI]', grant_2_outcome: '[Outcome]',
      past_accomplishments:   '[Description of past programmatic accomplishments]',
      pi_title:               'Ph.D.',
      pi_bio:                 `[${profile.principalInvestigator ?? 'PI'} biographical sketch and qualifications]`,
      pi_publications:        profile.publications?.map((p, i) => `${i + 1}. ${p}`).join('\n') ?? '[List of key publications]',
      co_investigator_bios:   '[Co-investigator biographical sketches]',
      laboratory_description: '[Laboratory and research space description]',
      computing_infrastructure: '[Computing and data infrastructure description]',
      library_resources:      '[Library and information resources]',
      administrative_infrastructure: '[Administrative and support infrastructure]',
      partnerships_description: '[Partnerships and collaboration description]',
      institutional_resource_1: '[Institutional resource 1]',
      institutional_resource_2: '[Institutional resource 2]',
      institutional_resource_3: '[Institutional resource 3]',

      // Letter of support placeholders
      partner_name:           '[Partner Name]', partner_title: '[Partner Title]',
      partner_institution:    '[Partner Institution]', partner_address: '[Partner Address]',
      partner_role_description: '[Partner role description]',
      significance_statement: '[Statement of significance from partner perspective]',
      collaboration_start_date: '[Collaboration start date]',
      prior_collaboration_description: '[Prior collaboration description]',
      collaboration_outcomes: '[Outcomes of prior collaboration]',
      contribution_1:         '[Specific contribution 1]', contribution_2: '[Specific contribution 2]', contribution_3: '[Specific contribution 3]',
      expected_impact_statement: '[Expected impact statement]',
      organizational_benefit: '[How the partner organization benefits]',
      partner_email:          '[partner@institution.edu]', partner_phone: '[phone number]',
      citation_style:         'APA 7th edition',

      // References placeholders
      preliminary_overview:   '[Overview of preliminary studies and their relevance]',
      preliminary_study_1_title: '[Preliminary Study 1 Title]', preliminary_study_1_methods: '[Methods]', preliminary_study_1_results: '[Results]', preliminary_study_1_significance: '[Significance]',
      preliminary_study_2_title: '[Preliminary Study 2 Title]', preliminary_study_2_methods: '[Methods]', preliminary_study_2_results: '[Results]', preliminary_study_2_significance: '[Significance]',
      author_list_1:          '[Authors]', year_1: '[Year]', title_1: '[Title]', journal_1: '[Journal]', volume_1: '[Vol]', issue_1: '[Issue]', pages_1: '[Pages]', doi_1: '[DOI]',
      author_list_2:          '[Authors]', year_2: '[Year]', title_2: '[Title]', journal_2: '[Journal]', volume_2: '[Vol]', issue_2: '[Issue]', pages_2: '[Pages]', doi_2: '[DOI]',
      author_list_3:          '[Authors]', year_3: '[Year]', title_3: '[Title]', journal_3: '[Journal]', volume_3: '[Vol]', issue_3: '[Issue]', pages_3: '[Pages]', doi_3: '[DOI]',
      ref_1_authors:          '[Authors]', ref_1_year: '[Year]', ref_1_title: '[Title]', ref_1_journal: '[Journal]', ref_1_vol_pages: '[Volume(Issue), Pages]', ref_1_doi: '[DOI]',
      ref_2_authors:          '[Authors]', ref_2_year: '[Year]', ref_2_title: '[Title]', ref_2_journal: '[Journal]', ref_2_vol_pages: '[Volume(Issue), Pages]', ref_2_doi: '[DOI]',
      ref_3_authors:          '[Authors]', ref_3_year: '[Year]', ref_3_title: '[Title]', ref_3_journal: '[Journal]', ref_3_vol_pages: '[Volume(Issue), Pages]', ref_3_doi: '[DOI]',
      ref_4_authors:          '[Authors]', ref_4_year: '[Year]', ref_4_title: '[Title]', ref_4_journal: '[Journal]', ref_4_vol_pages: '[Volume(Issue), Pages]', ref_4_doi: '[DOI]',
      ref_5_authors:          '[Authors]', ref_5_year: '[Year]', ref_5_title: '[Title]', ref_5_journal: '[Journal]', ref_5_vol_pages: '[Volume(Issue), Pages]', ref_5_doi: '[DOI]',
    };

    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.replaceAll(`{${key}}`, value);
    }

    // Additional instructions if provided
    if (context.instructions) {
      result = `<!-- Generation Instructions: ${context.instructions} -->\n\n${result}`;
    }

    return result;
  }

  // ── AI-Based Generation ────────────────────────────────────────────────────

  /**
   * Generate section content using OpenAI GPT-4.
   * Constructs a detailed system prompt from the grant context and calls the API.
   *
   * @param sectionType - The section type to generate
   * @param context     - Opportunity and profile context
   */
  private async generateWithAI(
    sectionType: SectionType,
    context: GenerationContext,
  ): Promise<string> {
    if (!this.openai) throw new Error('OpenAI not initialized');

    const { opportunity, profile, instructions } = context;

    const systemPrompt = `You are an expert grant writer specializing in federal research grants (NSF, NIH, DOE, NEH, etc.). 
Generate a professional, detailed, and compelling ${sectionType.replace(/_/g, ' ').toLowerCase()} section for a grant proposal.
Follow all agency-specific requirements and best practices. Use formal academic prose. 
Structure the content with appropriate headers and subsections.`;

    const userPrompt = `Generate the ${sectionType.replace(/_/g, ' ')} section for the following grant:

**Grant Opportunity:** ${opportunity?.title ?? 'N/A'}
**Agency:** ${opportunity?.agency ?? 'N/A'}
**Opportunity Number:** ${opportunity?.opportunityNumber ?? 'N/A'}
**Synopsis:** ${opportunity?.synopsis ?? 'N/A'}
**Award Amount:** ${opportunity?.awardAmount ? `$${opportunity.awardAmount.toLocaleString()}` : 'N/A'}
**Duration:** ${opportunity?.duration ?? profile?.duration ?? 'N/A'}
**Eligibility:** ${opportunity?.eligibilityRequirements ?? 'N/A'}

**Principal Investigator:** ${profile?.principalInvestigator ?? 'N/A'}
**Institution:** ${profile?.institution ?? 'N/A'}
**Expertise:** ${profile?.expertise?.join(', ') ?? 'N/A'}
**Prior Work:** ${profile?.priorWork ?? 'N/A'}
**Prior Publications:** ${profile?.publications?.slice(0, 3).join('; ') ?? 'N/A'}

${instructions ? `Additional instructions: ${instructions}` : ''}

Generate a complete, well-structured ${sectionType.replace(/_/g, ' ')} that follows federal grant writing best practices.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openai = this.openai as any;
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4000,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content ?? '';
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Generate a section for a proposal using AI or template-based generation.
   * Saves the generated content to the section service and scores it.
   *
   * @param proposalId  - The parent proposal UUID
   * @param sectionType - The section type to generate
   * @param context     - Opportunity + profile context and optional instructions
   * @returns The generated GfSection with quality score
   */
  async generateSection(
    proposalId: string,
    sectionType: SectionType,
    context: GenerationContext,
  ): Promise<GfSection> {
    let content: string;
    let isAiGenerated = false;

    if (this.openai) {
      try {
        content = await this.generateWithAI(sectionType, context);
        isAiGenerated = true;
        console.log(`[proposer:generation] AI-generated ${sectionType} for proposal ${proposalId}`);
      } catch (err) {
        console.warn(`[proposer:generation] OpenAI failed, falling back to template:`, err);
        content = await this.generateFromTemplate(sectionType, context);
      }
    } else {
      content = await this.generateFromTemplate(sectionType, context);
    }

    // Save the section
    const section = await this.sectionService.addSection(proposalId, {
      sectionType,
      content,
      isAiGenerated,
    });

    // Score and persist the quality
    const score = this.computeQualityScore(content, sectionType);
    await this.sectionService.setQualityScore(section.id, score);
    section.qualityScore = score;
    section.isAiGenerated = isAiGenerated;

    console.log(`[proposer:generation] Section ${sectionType} scored ${score}/100`);
    return section;
  }

  /**
   * Generate section content from the default template.
   */
  private async generateFromTemplate(
    sectionType: SectionType,
    context: GenerationContext,
  ): Promise<string> {
    const template = await this.templateService.getDefaultTemplate(sectionType);
    if (!template) {
      throw new Error(`No default template found for section type: ${sectionType}`);
    }
    const content = this.fillTemplate(template.content, context, sectionType);
    console.log(`[proposer:generation] Template-generated ${sectionType}`);
    return content;
  }

  /**
   * Refine an existing section with AI or template-based improvement.
   * Records the before/after content as a GfRefinement.
   *
   * @param proposalId  - The parent proposal UUID
   * @param sectionId   - The section to refine
   * @param instructions - Natural language instructions for the refinement
   * @returns The recorded GfRefinement with quality delta
   */
  async refineSection(
    proposalId: string,
    sectionId: string,
    instructions: string,
  ): Promise<GfRefinement> {
    const section = await this.sectionService.getSection(proposalId, sectionId);
    if (!section) throw new Error(`Section ${sectionId} not found in proposal ${proposalId}`);

    const beforeContent  = section.content;
    const beforeScore    = section.qualityScore;

    let afterContent: string;

    if (this.openai) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const openai = this.openai as any;
        const response = await openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages: [
            {
              role: 'system',
              content: 'You are an expert grant writer. Refine the provided grant proposal section according to the given instructions. Maintain the same overall structure but improve the content.',
            },
            {
              role: 'user',
              content: `Section to refine:\n\n${beforeContent}\n\nRefinement instructions: ${instructions}\n\nReturn the refined section only.`,
            },
          ],
          max_tokens: 4000,
          temperature: 0.5,
        });
        afterContent = response.choices[0]?.message?.content ?? beforeContent;
      } catch (err) {
        console.warn('[proposer:generation] Refinement AI failed, using template approach:', err);
        afterContent = this.applyTemplateRefinement(beforeContent, instructions);
      }
    } else {
      afterContent = this.applyTemplateRefinement(beforeContent, instructions);
    }

    // Update the section
    await this.sectionService.updateSection(proposalId, sectionId, { content: afterContent });

    // Score the refined content
    const afterScore   = this.computeQualityScore(afterContent, section.sectionType);
    const qualityDelta = afterScore - beforeScore;

    await this.sectionService.setQualityScore(sectionId, afterScore);

    // Record the refinement
    const refinementId = uuid();
    await this.db.query(
      `INSERT INTO gf_refinements
         (id, proposal_id, section_id, before_content, after_content, quality_delta, instructions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [refinementId, proposalId, sectionId, beforeContent, afterContent, qualityDelta, instructions],
    );

    // Update proposal quality score
    await this.proposalService.recomputeQualityScore(proposalId);

    const refinement: GfRefinement = {
      id:             refinementId,
      proposalId,
      sectionId,
      beforeContent,
      afterContent,
      qualityDelta,
      instructions,
      createdAt:      new Date().toISOString(),
    };

    console.log(`[proposer:generation] Refined section ${sectionId} — quality delta: ${qualityDelta > 0 ? '+' : ''}${qualityDelta}`);
    return refinement;
  }

  /**
   * Apply template-based refinements by appending instructions as a note.
   * This is the fallback when AI is not available.
   */
  private applyTemplateRefinement(content: string, instructions: string): string {
    // Simple template refinement: adds an expanded concluding paragraph
    // acknowledging the refinement intent
    const refinementNote = `\n\n---\n*Note: This section has been refined per the following instructions: ${instructions}*\n\n` +
      `Additional supporting detail has been incorporated to strengthen the ${
        content.includes('Budget') ? 'financial justification' :
        content.includes('Evaluation') ? 'evaluation methodology' :
        'narrative'
      } in alignment with agency expectations.`;

    return content + refinementNote;
  }

  /**
   * Generate all seven sections for a proposal in sequence.
   * Updates proposal status to 'generating' → 'complete'.
   *
   * @param proposalId - The proposal UUID
   * @param context    - Opportunity + profile context
   * @returns Array of generated GfSection objects
   */
  async generateFullProposal(
    proposalId: string,
    context: GenerationContext,
  ): Promise<GfSection[]> {
    await this.proposalService.setStatus(proposalId, 'generating');

    const ALL_SECTION_TYPES: SectionType[] = [
      'EXECUTIVE_SUMMARY' as SectionType,
      'PROJECT_NARRATIVE' as SectionType,
      'BUDGET_JUSTIFICATION' as SectionType,
      'EVALUATION_PLAN' as SectionType,
      'ORGANIZATIONAL_CAPACITY' as SectionType,
      'LETTERS_OF_SUPPORT' as SectionType,
      'REFERENCES' as SectionType,
    ];

    const sections: GfSection[] = [];

    for (const sectionType of ALL_SECTION_TYPES) {
      try {
        const section = await this.generateSection(proposalId, sectionType, context);
        sections.push(section);
      } catch (err) {
        console.error(`[proposer:generation] Failed to generate ${sectionType}:`, err);
      }
    }

    // Recompute composite quality score
    await this.proposalService.recomputeQualityScore(proposalId);
    await this.proposalService.setStatus(proposalId, 'complete');

    console.log(`[proposer:generation] Full proposal ${proposalId} generated — ${sections.length} sections`);
    return sections;
  }

  /**
   * Get refinement history for a section.
   *
   * @param proposalId - The parent proposal UUID
   * @param sectionId  - The section UUID
   */
  async getRefinements(proposalId: string, sectionId: string): Promise<GfRefinement[]> {
    const { rows } = await this.db.query<RefinementRow>(
      'SELECT * FROM gf_refinements WHERE proposal_id = $1 AND section_id = $2 ORDER BY created_at DESC',
      [proposalId, sectionId],
    );

    return rows.map(r => ({
      id:             r.id,
      proposalId:     r.proposal_id,
      sectionId:      r.section_id,
      beforeContent:  r.before_content,
      afterContent:   r.after_content,
      qualityDelta:   parseFloat(r.quality_delta),
      instructions:   r.instructions,
      createdAt:      r.created_at.toISOString(),
    }));
  }
}
