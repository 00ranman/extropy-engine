/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  GrantFlow Proposer — Export Service
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Exports grant proposals as formatted documents for submission packages.
 *
 *  Export formats:
 *    - Markdown: Full proposal with title page, table of contents, and all
 *                sections formatted as GitHub-compatible markdown. Suitable
 *                for conversion to PDF/DOCX via pandoc or similar tools.
 *    - Text:     Plain-text export with ASCII formatting. Suitable for
 *                pasting into grant submission portals that don't accept
 *                rich formatting.
 *
 *  Export document structure:
 *    1. Title Page (proposal title, PI, institution, agency, date, budget)
 *    2. Table of Contents (for markdown)
 *    3. Sections in canonical order (Executive Summary → References)
 *    4. Footer metadata
 *
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type { ProposalService } from './proposal.service.js';
import type { SectionService } from './section.service.js';
import type { GfProposal, GfSection, SectionType } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical section order for export.
 * Sections are exported in this order regardless of insertion order.
 */
const SECTION_ORDER: SectionType[] = [
  'EXECUTIVE_SUMMARY'       as SectionType,
  'PROJECT_NARRATIVE'       as SectionType,
  'BUDGET_JUSTIFICATION'    as SectionType,
  'EVALUATION_PLAN'         as SectionType,
  'ORGANIZATIONAL_CAPACITY' as SectionType,
  'LETTERS_OF_SUPPORT'      as SectionType,
  'REFERENCES'              as SectionType,
];

/** Human-readable display names for section types */
const SECTION_DISPLAY_NAMES: Record<SectionType, string> = {
  EXECUTIVE_SUMMARY:       'Executive Summary',
  PROJECT_NARRATIVE:       'Project Narrative',
  BUDGET_JUSTIFICATION:    'Budget Justification',
  EVALUATION_PLAN:         'Evaluation Plan',
  ORGANIZATIONAL_CAPACITY: 'Organizational Capacity',
  LETTERS_OF_SUPPORT:      'Letters of Support',
  REFERENCES:              'References and Preliminary Studies',
} as Record<SectionType, string>;

// ─────────────────────────────────────────────────────────────────────────────
//  ExportService
// ─────────────────────────────────────────────────────────────────────────────

export class ExportService {
  constructor(
    private readonly proposalService: ProposalService,
    private readonly sectionService: SectionService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Sort sections by the canonical SECTION_ORDER.
   * Sections not in the canonical order are appended at the end.
   */
  private sortSections(sections: GfSection[]): GfSection[] {
    const ordered: GfSection[] = [];
    const unordered: GfSection[] = [];

    for (const type of SECTION_ORDER) {
      const match = sections.find(s => s.sectionType === type);
      if (match) ordered.push(match);
    }

    // Append any sections not in the canonical order
    for (const section of sections) {
      if (!SECTION_ORDER.includes(section.sectionType)) {
        unordered.push(section);
      }
    }

    return [...ordered, ...unordered];
  }

  /**
   * Get a human-readable display name for a section type.
   */
  private displayName(sectionType: SectionType): string {
    return SECTION_DISPLAY_NAMES[sectionType] ?? sectionType.replace(/_/g, ' ');
  }

  // ── Markdown Export ────────────────────────────────────────────────────────

  /**
   * Export a proposal as formatted Markdown.
   * Includes a title page, table of contents, all sections in canonical order,
   * and a metadata footer.
   *
   * @param proposalId - The proposal UUID
   * @returns Formatted markdown string
   */
  async exportToMarkdown(proposalId: string): Promise<string> {
    const proposal = await this.proposalService.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

    const sections = await this.sectionService.listSections(proposalId);
    const sortedSections = this.sortSections(sections);

    const lines: string[] = [];
    const exportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // ── Title Page ────────────────────────────────────────────────────────
    lines.push('---');
    lines.push(`title: "${proposal.opportunityTitle}"`);
    lines.push(`author: "${proposal.principalInvestigator ?? 'Principal Investigator'}"`);
    lines.push(`institution: "${proposal.agency}"`);
    lines.push(`date: "${exportDate}"`);
    lines.push('---');
    lines.push('');
    lines.push(`# ${proposal.opportunityTitle}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Title Page');
    lines.push('');

    const titlePageFields = [
      ['Project Title',         proposal.opportunityTitle],
      ['Funding Agency',        proposal.agency],
      ['Opportunity Number',    proposal.opportunityNumber ?? 'N/A'],
      ['Principal Investigator', proposal.principalInvestigator ?? 'N/A'],
      ['Requested Budget',      proposal.requestedAmount
        ? `$${proposal.requestedAmount.toLocaleString('en-US')}`
        : 'N/A'],
      ['Project Duration',      proposal.proposalDuration ?? 'N/A'],
      ['Submission Date',       exportDate],
      ['Proposal Status',       proposal.status.toUpperCase()],
      ['Quality Score',         `${proposal.qualityScore.toFixed(1)}/100`],
    ];

    for (const [label, value] of titlePageFields) {
      lines.push(`**${label}:** ${value}  `);
    }

    lines.push('');
    lines.push('---');
    lines.push('');

    // ── Table of Contents ─────────────────────────────────────────────────
    lines.push('## Table of Contents');
    lines.push('');

    for (let i = 0; i < sortedSections.length; i++) {
      const section = sortedSections[i];
      const name    = this.displayName(section.sectionType);
      const anchor  = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      lines.push(`${i + 1}. [${name}](#${anchor})`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');

    // ── Sections ──────────────────────────────────────────────────────────
    for (let i = 0; i < sortedSections.length; i++) {
      const section = sortedSections[i];
      const name    = this.displayName(section.sectionType);

      lines.push(`## ${i + 1}. ${name}`);
      lines.push('');

      // Section metadata
      lines.push(`> **Quality Score:** ${section.qualityScore.toFixed(1)}/100 | `
        + `**Version:** ${section.version} | `
        + `**Generated:** ${section.isAiGenerated ? 'AI' : 'Manual'}`);
      lines.push('');

      // Section content (already markdown)
      lines.push(section.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    // ── Footer ────────────────────────────────────────────────────────────
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('*This proposal was prepared with the Extropy Engine GrantFlow Proposer.*');
    lines.push(`*Export generated: ${new Date().toISOString()}*`);
    lines.push(`*Proposal ID: ${proposal.id}*`);

    return lines.join('\n');
  }

  // ── Plain Text Export ──────────────────────────────────────────────────────

  /**
   * Export a proposal as plain text with ASCII formatting.
   * Strips markdown syntax (headers, bold, tables) for portal-paste compatibility.
   *
   * @param proposalId - The proposal UUID
   * @returns Plain text string
   */
  async exportToText(proposalId: string): Promise<string> {
    const proposal = await this.proposalService.getProposal(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

    const sections = await this.sectionService.listSections(proposalId);
    const sortedSections = this.sortSections(sections);

    const lines: string[] = [];
    const exportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const divider = '='.repeat(72);
    const subDivider = '-'.repeat(72);

    // ── Title Page ─────────────────────────────────────────────────────
    lines.push(divider);
    lines.push(this.centerText(proposal.opportunityTitle, 72));
    lines.push(this.centerText('GRANT PROPOSAL', 72));
    lines.push(divider);
    lines.push('');

    const titlePageFields: [string, string][] = [
      ['Project Title',          proposal.opportunityTitle],
      ['Funding Agency',         proposal.agency],
      ['Opportunity Number',     proposal.opportunityNumber ?? 'N/A'],
      ['Principal Investigator', proposal.principalInvestigator ?? 'N/A'],
      ['Requested Budget',       proposal.requestedAmount
        ? `$${proposal.requestedAmount.toLocaleString('en-US')}`
        : 'N/A'],
      ['Project Duration',       proposal.proposalDuration ?? 'N/A'],
      ['Submission Date',        exportDate],
    ];

    for (const [label, value] of titlePageFields) {
      lines.push(`${label.padEnd(28)} ${value}`);
    }

    lines.push('');
    lines.push(divider);
    lines.push('');

    // ── Table of Contents ──────────────────────────────────────────────
    lines.push('TABLE OF CONTENTS');
    lines.push(subDivider);

    for (let i = 0; i < sortedSections.length; i++) {
      const section = sortedSections[i];
      const name = this.displayName(section.sectionType);
      lines.push(`  ${(i + 1).toString().padEnd(4)} ${name}`);
    }

    lines.push('');
    lines.push(divider);
    lines.push('');

    // ── Sections ───────────────────────────────────────────────────────
    for (let i = 0; i < sortedSections.length; i++) {
      const section = sortedSections[i];
      const name = this.displayName(section.sectionType);

      lines.push(`SECTION ${i + 1}: ${name.toUpperCase()}`);
      lines.push(subDivider);
      lines.push('');

      // Strip markdown formatting
      const plainContent = this.stripMarkdown(section.content);
      lines.push(plainContent);
      lines.push('');
      lines.push(divider);
      lines.push('');
    }

    // ── Footer ─────────────────────────────────────────────────────────
    lines.push(`Generated by Extropy Engine GrantFlow Proposer | ${new Date().toISOString()}`);
    lines.push(`Proposal ID: ${proposal.id}`);

    return lines.join('\n');
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  /**
   * Center text within a given width using space padding.
   */
  private centerText(text: string, width: number): string {
    if (text.length >= width) return text;
    const padding = Math.floor((width - text.length) / 2);
    return ' '.repeat(padding) + text;
  }

  /**
   * Strip common Markdown formatting from text.
   * Removes headers (#), bold/italic, inline code, links, and tables.
   */
  private stripMarkdown(content: string): string {
    return content
      // Remove YAML front matter
      .replace(/^---[\s\S]*?---\n/, '')
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, '')
      // Convert headers to uppercase plain text
      .replace(/^#{1,6}\s+(.+)$/gm, (_, text: string) => text.toUpperCase())
      // Remove bold/italic
      .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      // Remove inline code
      .replace(new RegExp('`(.+?)`', 'g'), '$1')
      // Convert links to text
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      // Remove markdown table pipes (convert to spaced columns)
      .replace(/\|/g, '  ')
      .replace(/^[\s-|]+$/gm, '')
      // Normalize multiple blank lines
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
