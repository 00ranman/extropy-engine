/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Governance & DFAO Integration
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Creates household DFAOs (Decentralized Fractal Autonomous Organizations)
 *  via the DFAO Registry and Governance services.
 *
 *  A household DFAO is a NANO-scale DFAO representing a family or building
 *  unit that governs its own energy policies, automation rules, and
 *  contribution distribution.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from '../services/database.service.js';
import type { EventBusService } from '../services/event-bus.service.js';
import { HomeFlowEventType } from '../types/index.js';
import type { HouseholdId } from '../types/index.js';
import { EntropyDomain, DFAOScale, DFAOStatus, MembershipRole } from '@extropy/contracts';
import type { ValidatorId, DFAOId } from '@extropy/contracts';

export class GovernanceIntegration {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private config: {
      governanceUrl: string;
      dfaoRegistryUrl: string;
    },
  ) {}

  /**
   * Create a household DFAO — a NANO-scale DFAO for the household.
   */
  async createHouseholdDFAO(
    householdId: string,
    householdName: string,
    founderValidatorId: string,
  ): Promise<{ dfaoId: string }> {
    const dfaoId = uuidv4();

    try {
      const response = await fetch(`${this.config.dfaoRegistryUrl}/dfaos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `HomeFlow: ${householdName}`,
          description: `Household DFAO for ${householdName} — manages energy policies, automation governance, and contribution distribution.`,
          scale: DFAOScale.NANO,
          primaryDomain: EntropyDomain.THERMODYNAMIC,
          secondaryDomains: [EntropyDomain.ECONOMIC],
          founderIds: [founderValidatorId],
          governanceConfig: {
            quorumMinMembers: 1,
            quorumPercentage: 0.5,
            deliberationPeriodHours: 24,
            votingMethod: 'linear_reputation',
            bindingProposals: false, // Shadow phase
            proposalThresholdParams: {
              complexityFactor: 0.5,
              impactRadiusMultiplier: 1.0,
            },
            emergencyThreshold: 0.8,
          },
          tokenConfig: {
            mintsDomainTokens: true,
            ctMultiplier: 1.2, // Slight bonus for household contributions
            domainContributionExponent: 1.5,
            totalContributionExponent: 0.5,
          },
          metadata: {
            source: 'homeflow',
            householdId,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json() as { id: string };
        console.log(`[homeflow:governance] Household DFAO created: ${data.id}`);
      }
    } catch (err) {
      console.warn('[homeflow:governance] Failed to create DFAO (service may be offline):', err);
    }

    // Update household with DFAO reference
    await this.db.query(
      `UPDATE hf_households SET dfao_id = $1, updated_at = NOW() WHERE id = $2`,
      [dfaoId, householdId],
    );

    // Emit event
    await this.eventBus.publish(
      HomeFlowEventType.HOUSEHOLD_DFAO_CREATED,
      householdId,
      {
        householdId: householdId as HouseholdId,
        dfaoId: dfaoId as DFAOId,
        founderValidatorId: founderValidatorId as ValidatorId,
      },
    );

    return { dfaoId };
  }

  /**
   * Submit a governance proposal for the household DFAO.
   * Example: change energy policy, add automation rule, adjust contribution splits.
   */
  async submitProposal(
    householdId: string,
    proposerId: string,
    title: string,
    description: string,
    changes: Array<{ target: string; currentValue: unknown; proposedValue: unknown; rationale: string }>,
  ): Promise<{ proposalId: string }> {
    const household = await this.db.query('SELECT dfao_id FROM hf_households WHERE id = $1', [householdId]);
    if (!household.rows[0]?.dfao_id) {
      throw new Error('Household has no DFAO — create one first');
    }

    const proposalId = uuidv4();

    try {
      await fetch(`${this.config.governanceUrl}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dfaoId: household.rows[0].dfao_id,
          type: 'parameter_change',
          title,
          description,
          changes,
          proposerId,
        }),
      });
    } catch (err) {
      console.warn('[homeflow:governance] Failed to submit proposal:', err);
    }

    return { proposalId };
  }
}
