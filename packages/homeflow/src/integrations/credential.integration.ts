/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Credential Integration
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Issues verifiable credentials for certified energy efficiency.
 *
 *  Levels:
 *    - Bronze:   cumulative ΔS ≥ 100 J/K
 *    - Silver:   cumulative ΔS ≥ 500 J/K
 *    - Gold:     cumulative ΔS ≥ 2,000 J/K
 *    - Platinum: cumulative ΔS ≥ 10,000 J/K
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from '../services/database.service.js';
import type { EventBusService } from '../services/event-bus.service.js';
import { HomeFlowEventType } from '../types/index.js';
import type { HouseholdId } from '../types/index.js';
import { CredentialType, EntropyDomain } from '@extropy/contracts';
import type { ValidatorId, CredentialId } from '@extropy/contracts';

const EFFICIENCY_THRESHOLDS = [
  { level: 'bronze' as const,   minDeltaS: 100,   name: 'Energy Saver' },
  { level: 'silver' as const,   minDeltaS: 500,   name: 'Efficiency Expert' },
  { level: 'gold' as const,     minDeltaS: 2000,  name: 'Green Champion' },
  { level: 'platinum' as const, minDeltaS: 10000, name: 'Entropy Master' },
];

export class CredentialIntegration {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private config: {
      credentialsUrl: string;
    },
  ) {}

  /**
   * Check if a household qualifies for a new efficiency credential.
   * Called after each verified entropy reduction.
   */
  async checkAndIssueCredentials(
    householdId: string,
    validatorId: string,
    cumulativeDeltaS: number,
  ): Promise<Array<{ level: string; credentialId: string }>> {
    // Get existing credentials
    const { rows: existing } = await this.db.query(
      `SELECT level FROM hf_credentials WHERE household_id = $1`,
      [householdId],
    );
    const existingLevels = new Set(existing.map(r => r.level));

    const issued: Array<{ level: string; credentialId: string }> = [];

    for (const threshold of EFFICIENCY_THRESHOLDS) {
      if (cumulativeDeltaS >= threshold.minDeltaS && !existingLevels.has(threshold.level)) {
        const credentialId = uuidv4();

        // Record locally
        await this.db.query(
          `INSERT INTO hf_credentials (id, household_id, validator_id, credential_id, level, cumulative_delta_s, issued_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
          [uuidv4(), householdId, validatorId, credentialId, threshold.level, cumulativeDeltaS],
        );

        // Issue via Credentials service
        try {
          await fetch(`${this.config.credentialsUrl}/credentials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              validatorId,
              type: CredentialType.CERTIFICATION,
              name: `HomeFlow ${threshold.name} (${threshold.level})`,
              description: `Certified energy efficiency: cumulative ΔS ≥ ${threshold.minDeltaS} J/K through home automation.`,
              domain: EntropyDomain.THERMODYNAMIC,
              persistsAcrossSeasons: true,
              visualMetadata: {
                icon: `efficiency_${threshold.level}`,
                color: threshold.level === 'bronze' ? '#CD7F32' :
                       threshold.level === 'silver' ? '#C0C0C0' :
                       threshold.level === 'gold'   ? '#FFD700' :
                       '#E5E4E2',
              },
            }),
          });
        } catch (err) {
          console.warn('[homeflow:credentials] Failed to issue credential:', err);
        }

        // Emit event
        await this.eventBus.publish(
          HomeFlowEventType.EFFICIENCY_CREDENTIAL,
          householdId,
          {
            householdId: householdId as HouseholdId,
            validatorId: validatorId as ValidatorId,
            credentialId: credentialId as CredentialId,
            level: threshold.level,
            cumulativeDeltaS,
          },
        );

        issued.push({ level: threshold.level, credentialId });
        console.log(`[homeflow:credentials] Issued ${threshold.level} credential for household ${householdId}`);
      }
    }

    return issued;
  }

  /**
   * Get credentials for a household.
   */
  async getCredentials(householdId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM hf_credentials WHERE household_id = $1 ORDER BY issued_at DESC`,
      [householdId],
    );
    return rows;
  }
}
