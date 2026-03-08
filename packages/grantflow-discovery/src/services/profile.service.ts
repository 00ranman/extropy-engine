/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GrantFlow Discovery — Profile Service
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Manages researcher profiles used for grant opportunity matching.
 *
 *  A profile stores the researcher's:
 *    - Search keywords (used for Grants.gov API queries)
 *    - Research domains (mapped to Extropy Engine EntropyDomains)
 *    - Past award history (used for experience scoring)
 *    - Expertise descriptions (used for NLP matching)
 *    - Award amount preferences (filters unsuitable grants)
 *    - Eligibility types (individual, small business, nonprofit, etc.)
 *
 *  Randall Gossett's profile is pre-populated at service startup.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { v4 as uuid } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type {
  GfProfile,
  GfProfileCreate,
  GfProfileUpdate,
} from '../types/index.js';

// ── Randall Gossett's default researcher profile ──────────────────────────

const RANDALL_GOSSETT_PROFILE: GfProfileCreate = {
  name: 'Randall Gossett',
  email: '00ranman@gmail.com',
  keywords: [
    'entropy',
    'information theory',
    'IoT',
    'internet of things',
    'decentralized systems',
    'smart home automation',
    'thermodynamic computation',
    'distributed ledger',
    'edge computing',
    'machine learning',
    'digital twins',
    'autonomous systems',
    'blockchain',
    'sensor networks',
    'energy efficiency',
  ],
  domains: [
    'entropy/information theory',
    'IoT',
    'decentralized systems',
    'smart home automation',
    'thermodynamic computation',
  ],
  pastAwards: [],
  expertise: [
    'Information entropy measurement and reduction in distributed systems',
    'IoT device management and smart home automation',
    'Decentralized autonomous organizations and governance',
    'Thermodynamic computation models for digital systems',
    'Edge computing and sensor network architectures',
    'Blockchain-based verification and trust systems',
    'AI-powered autonomous agents',
  ],
  minAwardAmount: 10_000,
  maxAwardAmount: 1_000_000,
  eligibilityTypes: [
    'individuals',
    'small_businesses',
    'unrestricted',
    '25',   // Grants.gov code for individuals
    '12',   // Grants.gov code for small businesses
    '99',   // Grants.gov code for unrestricted
  ],
};

export class ProfileService {
  constructor(private readonly db: DatabaseService) {}

  // ─────────────────────────────────────────────────────────────────────────
  //  CRUD
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new researcher profile.
   *
   * @param data - Profile creation payload
   * @returns The persisted profile with generated id and timestamps
   */
  async createProfile(data: GfProfileCreate): Promise<GfProfile> {
    const id = uuid();
    const now = new Date().toISOString();

    await this.db.query(
      `INSERT INTO gf_profiles (
        id, name, email, keywords, domains, past_awards, expertise,
        min_award_amount, max_award_amount, eligibility_types,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        data.name,
        data.email ?? null,
        data.keywords,
        data.domains,
        data.pastAwards,
        data.expertise,
        data.minAwardAmount ?? null,
        data.maxAwardAmount ?? null,
        data.eligibilityTypes,
        now,
        now,
      ],
    );

    console.log(`[profile] Created profile — id=${id} name="${data.name}"`);

    return {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Retrieve a researcher profile by its UUID.
   *
   * @param id - Profile UUID
   * @returns Profile, or null if not found
   */
  async getProfile(id: string): Promise<GfProfile | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM gf_profiles WHERE id = $1',
      [id],
    );
    if (rows.length === 0) return null;
    return this.rowToProfile(rows[0]);
  }

  /**
   * List all profiles.
   *
   * @param limit  - Max records to return
   * @param offset - Pagination offset
   */
  async listProfiles(limit = 50, offset = 0): Promise<GfProfile[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM gf_profiles ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset],
    );
    return rows.map(r => this.rowToProfile(r));
  }

  /**
   * Update a researcher profile (partial update — only provided fields are changed).
   *
   * @param id   - Profile UUID
   * @param data - Fields to update
   * @returns Updated profile, or null if not found
   */
  async updateProfile(id: string, data: GfProfileUpdate): Promise<GfProfile | null> {
    const existing = await this.getProfile(id);
    if (!existing) return null;

    const updated: GfProfile = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };

    await this.db.query(
      `UPDATE gf_profiles SET
        name              = $2,
        email             = $3,
        keywords          = $4,
        domains           = $5,
        past_awards       = $6,
        expertise         = $7,
        min_award_amount  = $8,
        max_award_amount  = $9,
        eligibility_types = $10,
        updated_at        = $11
      WHERE id = $1`,
      [
        id,
        updated.name,
        updated.email ?? null,
        updated.keywords,
        updated.domains,
        updated.pastAwards,
        updated.expertise,
        updated.minAwardAmount ?? null,
        updated.maxAwardAmount ?? null,
        updated.eligibilityTypes,
        updated.updatedAt,
      ],
    );

    console.log(`[profile] Updated profile — id=${id}`);
    return updated;
  }

  /**
   * Delete a profile by UUID.
   *
   * @param id - Profile UUID
   * @returns true if deleted, false if not found
   */
  async deleteProfile(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      'DELETE FROM gf_profiles WHERE id = $1',
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Seed Data
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ensure Randall Gossett's profile exists in the database.
   * Called at service startup — idempotent (skips if already present).
   */
  async ensureDefaultProfile(): Promise<GfProfile> {
    const { rows } = await this.db.query(
      `SELECT id FROM gf_profiles WHERE email = $1 LIMIT 1`,
      [RANDALL_GOSSETT_PROFILE.email],
    );

    if (rows.length > 0) {
      const profile = await this.getProfile(rows[0]['id'] as string);
      console.log('[profile] Default profile already exists — skipping seed');
      return profile!;
    }

    console.log("[profile] Seeding Randall Gossett's default researcher profile");
    return this.createProfile(RANDALL_GOSSETT_PROFILE);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Convert a database row to a GfProfile object.
   */
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
}
