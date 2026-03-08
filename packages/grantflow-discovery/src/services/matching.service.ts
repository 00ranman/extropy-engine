/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Matching Service
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Computes match scores between grant opportunities and researcher profiles.
 *
 *  Scoring algorithm (0–100):
 *    - Keyword overlap     → up to 50 points
 *      (# matching keywords / total profile keywords × 50)
 *    - Domain alignment    → up to 30 points
 *      (# matching domains / total profile domains × 30)
 *    - Award amount fit    → 15 points (if within profile min/max range)
 *    - Eligibility match   → 5 points (if profile's eligibility types match)
 *
 *  Minimum threshold for recording a match: 20 points.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { v4 as uuid } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type {
  GfMatch,
  GfOpportunity,
  GfProfile,
} from '../types/index.js';

/** Minimum score (0–100) to record a match in the database */
const MATCH_THRESHOLD = 20;

/** Weight factors for the scoring formula */
const WEIGHT_KEYWORD    = 50;
const WEIGHT_DOMAIN     = 30;
const WEIGHT_AWARD_FIT  = 15;
const WEIGHT_ELIGIBILITY = 5;

/** Domain keyword mappings — expands profile domains to searchable terms */
const DOMAIN_TERM_MAP: Record<string, string[]> = {
  'entropy/information theory': ['entropy', 'information', 'shannon', 'bits', 'information theory', 'uncertainty'],
  'iot':                        ['iot', 'internet of things', 'sensor', 'embedded', 'connected devices', 'smart device'],
  'decentralized systems':      ['decentralized', 'distributed', 'blockchain', 'p2p', 'peer to peer', 'dfao', 'dao'],
  'smart home automation':      ['smart home', 'home automation', 'building automation', 'hvac', 'thermostat', 'energy management'],
  'thermodynamic computation':  ['thermodynamic', 'energy', 'heat', 'computation', 'thermal', 'entropy'],
};

export class MatchingService {
  constructor(private readonly db: DatabaseService) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  Score Computation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Compute a match score (0–100) between a grant opportunity and a profile.
   *
   * Returns the score, matched keywords/domains, and human-readable reasons.
   * This method does NOT persist to the database — use `saveMatch` for that.
   *
   * @param opportunity - The grant opportunity to evaluate
   * @param profile     - The researcher profile to match against
   */
  computeMatchScore(
    opportunity: GfOpportunity,
    profile: GfProfile,
  ): Omit<GfMatch, 'id' | 'createdAt'> {
    const oppText = this.extractTextFromOpportunity(opportunity);
    const oppWords = this.tokenise(oppText);

    // ── Keyword matching ─────────────────────────────────────────────────
    const matchedKeywords: string[] = [];
    for (const kw of profile.keywords) {
      const kwLower = kw.toLowerCase();
      if (oppWords.some(w => w.includes(kwLower) || kwLower.includes(w))) {
        matchedKeywords.push(kw);
      }
    }

    const keywordScore = profile.keywords.length > 0
      ? (matchedKeywords.length / profile.keywords.length) * WEIGHT_KEYWORD
      : 0;

    // ── Domain matching ──────────────────────────────────────────────────
    const matchedDomains: string[] = [];
    for (const domain of profile.domains) {
      const domainTerms = [
        domain.toLowerCase(),
        ...(DOMAIN_TERM_MAP[domain.toLowerCase()] ?? []),
      ];
      const hasMatch = domainTerms.some(term =>
        oppWords.some(w => w.includes(term) || term.includes(w)),
      );
      if (hasMatch) matchedDomains.push(domain);
    }

    const domainScore = profile.domains.length > 0
      ? (matchedDomains.length / profile.domains.length) * WEIGHT_DOMAIN
      : 0;

    // ── Award amount fit ─────────────────────────────────────────────────
    let awardAmountFit = false;
    let awardFitScore  = 0;

    if (opportunity.awardCeiling != null || opportunity.awardFloor != null) {
      const ceilingOk = profile.maxAwardAmount == null
        || (opportunity.awardCeiling != null && opportunity.awardCeiling <= profile.maxAwardAmount)
        || opportunity.awardCeiling == null;
      const floorOk = profile.minAwardAmount == null
        || (opportunity.awardFloor != null && opportunity.awardFloor >= profile.minAwardAmount)
        || (opportunity.awardCeiling != null && opportunity.awardCeiling >= (profile.minAwardAmount ?? 0));

      awardAmountFit = ceilingOk && floorOk;
      awardFitScore  = awardAmountFit ? WEIGHT_AWARD_FIT : 0;
    } else {
      // No amount info — assume fit (grant may apply regardless of amount)
      awardAmountFit = true;
      awardFitScore  = WEIGHT_AWARD_FIT * 0.5; // partial credit
    }

    // ── Eligibility matching ─────────────────────────────────────────────
    let eligibilityScore = 0;
    if (opportunity.eligibility.length === 0) {
      // No restrictions means universally eligible
      eligibilityScore = WEIGHT_ELIGIBILITY;
    } else {
      const oppEligLower = opportunity.eligibility.map(e => e.toLowerCase());
      const profileEligLower = profile.eligibilityTypes.map(e => e.toLowerCase());
      const hasEligMatch = profileEligLower.some(e =>
        oppEligLower.some(oe => oe.includes(e) || e.includes(oe)),
      );
      // Also check for "unrestricted" / "99" codes
      const isUnrestricted = oppEligLower.some(e =>
        e.includes('unrestricted') || e === '99' || e.includes('all'),
      );
      eligibilityScore = (hasEligMatch || isUnrestricted) ? WEIGHT_ELIGIBILITY : 0;
    }

    // ── Final score ──────────────────────────────────────────────────────
    const rawScore    = keywordScore + domainScore + awardFitScore + eligibilityScore;
    const score       = Math.min(100, Math.round(rawScore * 10) / 10);
    const matchReasons = this.buildMatchReasons(
      matchedKeywords, matchedDomains, awardAmountFit, opportunity, profile,
    );

    return {
      opportunityId:   opportunity.id,
      profileId:       profile.id,
      score,
      matchReasons,
      keywordMatches:  matchedKeywords,
      domainMatches:   matchedDomains,
      awardAmountFit,
    };
  }

  /**
   * Match a single opportunity against a profile. Persists if above threshold.
   *
   * @param opportunity - Opportunity to match
   * @param profile     - Profile to match against
   * @returns GfMatch, or null if below threshold
   */
  async matchOpportunityToProfile(
    opportunity: GfOpportunity,
    profile: GfProfile,
  ): Promise<GfMatch | null> {
    const result = this.computeMatchScore(opportunity, profile);

    if (result.score < MATCH_THRESHOLD) {
      return null;
    }

    return this.saveMatch(result);
  }

  /**
   * Match all cached opportunities (from the database) against a profile.
   * Only opportunities with status 'posted' or 'forecasted' are considered.
   *
   * @param profileId - Profile UUID to match against
   * @returns Array of GfMatch objects above the threshold
   */
  async matchAllOpportunities(profileId: string): Promise<GfMatch[]> {
    const profileRows = await this.db.query(
      'SELECT * FROM gf_profiles WHERE id = $1',
      [profileId],
    );
    if (profileRows.rows.length === 0) {
      throw new Error(`Profile ${profileId} not found`);
    }
    const profile = this.rowToProfile(profileRows.rows[0]);

    const { rows: oppRows } = await this.db.query(
      `SELECT * FROM gf_opportunities
       WHERE status IN ('posted', 'forecasted')
       ORDER BY close_date ASC NULLS LAST`,
    );

    const matches: GfMatch[] = [];

    for (const row of oppRows) {
      const opp = this.rowToOpportunity(row);
      const match = await this.matchOpportunityToProfile(opp, profile);
      if (match) {
        matches.push(match);
      }
    }

    console.log(
      `[matching] Matched ${oppRows.length} opportunities → ${matches.length} above threshold for profile ${profileId}`,
    );

    return matches;
  }

  /**
   * Get the top N matches for a profile, sorted by score descending.
   *
   * @param profileId - Profile UUID
   * @param limit     - Max number of matches to return (default 10)
   * @returns Array of GfMatch with joined opportunity data
   */
  async getTopMatches(profileId: string, limit = 10): Promise<GfMatch[]> {
    const { rows } = await this.db.query(
      `SELECT m.*
       FROM gf_matches m
       WHERE m.profile_id = $1
       ORDER BY m.score DESC
       LIMIT $2`,
      [profileId, limit],
    );

    return rows.map(r => this.rowToMatch(r));
  }

  /**
   * List all matches above a minimum score for a profile.
   *
   * @param profileId  - Profile UUID filter
   * @param minScore   - Minimum score threshold (default 20)
   * @param limit      - Max records
   * @param offset     - Pagination offset
   */
  async listMatches(
    profileId?: string,
    minScore = MATCH_THRESHOLD,
    limit = 50,
    offset = 0,
  ): Promise<GfMatch[]> {
    let sql = `
      SELECT m.*
      FROM gf_matches m
      WHERE m.score >= $1
    `;
    const params: unknown[] = [minScore];

    if (profileId) {
      params.push(profileId);
      sql += ` AND m.profile_id = $${params.length}`;
    }

    sql += ` ORDER BY m.score DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await this.db.query(sql, params);
    return rows.map(r => this.rowToMatch(r));
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Save a match result to the database (upsert by opportunity + profile).
   */
  private async saveMatch(
    data: Omit<GfMatch, 'id' | 'createdAt'>,
  ): Promise<GfMatch> {
    const id  = uuid();
    const now = new Date().toISOString();

    await this.db.query(
      `INSERT INTO gf_matches (
        id, opportunity_id, profile_id, score,
        match_reasons, keyword_matches, domain_matches, award_amount_fit, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (opportunity_id, profile_id) DO UPDATE SET
        score           = EXCLUDED.score,
        match_reasons   = EXCLUDED.match_reasons,
        keyword_matches = EXCLUDED.keyword_matches,
        domain_matches  = EXCLUDED.domain_matches,
        award_amount_fit = EXCLUDED.award_amount_fit`,
      [
        id,
        data.opportunityId,
        data.profileId,
        data.score,
        data.matchReasons,
        data.keywordMatches,
        data.domainMatches,
        data.awardAmountFit,
        now,
      ],
    );

    return { id, ...data, createdAt: now };
  }

  /**
   * Extract all searchable text from an opportunity for keyword matching.
   */
  private extractTextFromOpportunity(opp: GfOpportunity): string {
    return [
      opp.title,
      opp.agency,
      opp.description,
      opp.category ?? '',
      opp.eligibility.join(' '),
      opp.cfdaNumbers.join(' '),
    ].join(' ');
  }

  /**
   * Tokenise text into lowercase words for matching.
   */
  private tokenise(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s/-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  /**
   * Build human-readable match reason strings.
   */
  private buildMatchReasons(
    keywordMatches: string[],
    domainMatches: string[],
    awardAmountFit: boolean,
    opp: GfOpportunity,
    profile: GfProfile,
  ): string[] {
    const reasons: string[] = [];

    if (keywordMatches.length > 0) {
      reasons.push(`Keyword overlap: ${keywordMatches.slice(0, 5).join(', ')}${keywordMatches.length > 5 ? ` (+${keywordMatches.length - 5} more)` : ''}`);
    }

    if (domainMatches.length > 0) {
      reasons.push(`Domain alignment: ${domainMatches.join(', ')}`);
    }

    if (awardAmountFit && (opp.awardCeiling || opp.awardFloor)) {
      const amt = opp.awardCeiling
        ? `up to $${opp.awardCeiling.toLocaleString()}`
        : `from $${opp.awardFloor?.toLocaleString() ?? '?'}`;
      reasons.push(`Award amount ${amt} within profile range`);
    }

    if (opp.closeDate) {
      const daysLeft = Math.ceil(
        (new Date(opp.closeDate).getTime() - Date.now()) / 86_400_000,
      );
      if (daysLeft > 0 && daysLeft <= 90) {
        reasons.push(`Deadline in ${daysLeft} days (${opp.closeDate})`);
      }
    }

    return reasons;
  }

  private rowToProfile(row: Record<string, unknown>): GfProfile {
    return {
      id:               row['id'] as string,
      name:             row['name'] as string,
      email:            row['email'] as string | undefined,
      keywords:         (row['keywords'] as string[]) ?? [],
      domains:          (row['domains'] as string[]) ?? [],
      pastAwards:       (row['past_awards'] as string[]) ?? [],
      expertise:        (row['expertise'] as string[]) ?? [],
      minAwardAmount:   row['min_award_amount'] != null ? Number(row['min_award_amount']) : undefined,
      maxAwardAmount:   row['max_award_amount'] != null ? Number(row['max_award_amount']) : undefined,
      eligibilityTypes: (row['eligibility_types'] as string[]) ?? [],
      createdAt:        (row['created_at'] as Date).toISOString(),
      updatedAt:        (row['updated_at'] as Date).toISOString(),
    };
  }

  private rowToOpportunity(row: Record<string, unknown>): GfOpportunity {
    return {
      id:                row['id'] as string,
      oppNumber:         row['opp_number'] as string,
      title:             row['title'] as string,
      agency:            row['agency'] as string,
      agencyCode:        row['agency_code'] as string | undefined,
      description:       row['description'] as string,
      awardCeiling:      row['award_ceiling'] != null ? Number(row['award_ceiling']) : undefined,
      awardFloor:        row['award_floor'] != null ? Number(row['award_floor']) : undefined,
      expectedAwards:    row['expected_awards'] != null ? Number(row['expected_awards']) : undefined,
      openDate:          row['open_date'] as string | undefined,
      closeDate:         row['close_date'] as string | undefined,
      category:          row['category'] as string | undefined,
      fundingInstrument: row['funding_instrument'] as string | undefined,
      eligibility:       (row['eligibility'] as string[]) ?? [],
      cfdaNumbers:       (row['cfda_numbers'] as string[]) ?? [],
      status:            row['status'] as GfOpportunity['status'],
      rawData:           (row['raw_data'] as Record<string, unknown>) ?? {},
      discoveredAt:      (row['discovered_at'] as Date).toISOString(),
      updatedAt:         (row['updated_at'] as Date).toISOString(),
    };
  }

  private rowToMatch(row: Record<string, unknown>): GfMatch {
    return {
      id:             row['id'] as string,
      opportunityId:  row['opportunity_id'] as string,
      profileId:      row['profile_id'] as string,
      score:          Number(row['score']),
      matchReasons:   (row['match_reasons'] as string[]) ?? [],
      keywordMatches: (row['keyword_matches'] as string[]) ?? [],
      domainMatches:  (row['domain_matches'] as string[]) ?? [],
      awardAmountFit: row['award_amount_fit'] as boolean,
      createdAt:      (row['created_at'] as Date).toISOString(),
    };
  }
}
