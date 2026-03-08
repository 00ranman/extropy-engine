/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Token Economy Integration
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  HomeFlow-specific token flows:
 *    - Energy Credits: minted when verified energy savings ΔS > 0
 *    - Household Contribution Tokens (CT): issued for household-level actions
 *    - XP earning: when automation loops close with verified ΔS > 0
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from '../services/database.service.js';
import type { EventBusService } from '../services/event-bus.service.js';
import { HomeFlowEventType } from '../types/index.js';
import type { HouseholdId } from '../types/index.js';
import { TokenType } from '@extropy/contracts';
import type { LoopId, ValidatorId, VertexId } from '@extropy/contracts';

export class TokenIntegration {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private config: {
      tokenEconomyUrl: string;
      xpMintUrl: string;
    },
  ) {}

  /**
   * Mint energy credits from verified entropy reduction.
   *
   * Energy credits are a HomeFlow-specific DT (Domain Token) in the
   * THERMODYNAMIC domain. The amount is proportional to ΔS.
   *
   * Exchange rate: 1 J/K of ΔS = 100 energy credits
   */
  async mintEnergyCredits(
    householdId: string,
    validatorId: string,
    deltaS: number,
    loopId: string,
  ): Promise<{ amount: number; tokenFlowId: string }> {
    const amount = Math.floor(deltaS * 100); // 1 J/K = 100 credits
    if (amount <= 0) return { amount: 0, tokenFlowId: '' };

    const tokenFlowId = uuidv4();
    const now = new Date().toISOString();

    // Record locally
    await this.db.query(
      `INSERT INTO hf_token_flows (id, household_id, validator_id, token_type, amount, loop_id, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tokenFlowId, householdId, validatorId, 'energy_credit', amount, loopId, `Energy credit from ΔS=${deltaS.toFixed(4)} J/K`, now],
    );

    // Mint via Token Economy service
    try {
      await fetch(`${this.config.tokenEconomyUrl}/tokens/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenType: TokenType.DT,
          amount,
          toWalletId: validatorId,
          relatedEntityId: loopId,
          relatedEntityType: 'homeflow_energy_credit',
          reason: `HomeFlow energy credit: ΔS=${deltaS.toFixed(4)} J/K`,
          domain: 'thermodynamic',
        }),
      });
    } catch (err) {
      console.warn('[homeflow:token] Failed to mint via Token Economy:', err);
    }

    await this.eventBus.publish(
      HomeFlowEventType.ENERGY_CREDIT_MINTED,
      loopId,
      {
        householdId: householdId as HouseholdId,
        validatorId: validatorId as ValidatorId,
        amount,
        loopId: loopId as LoopId,
        deltaS,
      },
    );

    console.log(`[homeflow:token] Minted ${amount} energy credits for household ${householdId}`);
    return { amount, tokenFlowId };
  }

  /**
   * Issue Household Contribution Tokens (CT) for household actions.
   *
   * CT is issued when a household member contributes to the household's
   * entropy reduction efforts (e.g., adjusting thermostat, installing sensors).
   */
  async issueHouseholdCT(
    householdId: string,
    validatorId: string,
    contribution: string,
    amount: number,
  ): Promise<{ tokenFlowId: string }> {
    const tokenFlowId = uuidv4();

    await this.db.query(
      `INSERT INTO hf_token_flows (id, household_id, validator_id, token_type, amount, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [tokenFlowId, householdId, validatorId, 'household_ct', amount, contribution],
    );

    try {
      await fetch(`${this.config.tokenEconomyUrl}/tokens/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenType: TokenType.CT,
          amount,
          toWalletId: validatorId,
          relatedEntityId: householdId,
          relatedEntityType: 'homeflow_household_ct',
          reason: `HomeFlow household contribution: ${contribution}`,
        }),
      });
    } catch (err) {
      console.warn('[homeflow:token] Failed to issue CT via Token Economy:', err);
    }

    await this.eventBus.publish(
      HomeFlowEventType.HOUSEHOLD_CT_ISSUED,
      householdId,
      {
        householdId: householdId as HouseholdId,
        validatorId: validatorId as ValidatorId,
        amount,
        contribution,
      },
    );

    return { tokenFlowId };
  }

  /**
   * Get token flow history for a household.
   */
  async getTokenHistory(householdId: string, limit = 50) {
    const { rows } = await this.db.query(
      `SELECT * FROM hf_token_flows WHERE household_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [householdId, limit],
    );
    return rows;
  }

  /**
   * Get aggregate token balances for a household.
   */
  async getTokenBalances(householdId: string) {
    const { rows } = await this.db.query(
      `SELECT token_type, SUM(amount) as total
       FROM hf_token_flows
       WHERE household_id = $1
       GROUP BY token_type`,
      [householdId],
    );
    const balances: Record<string, number> = {};
    for (const row of rows) {
      balances[row.token_type] = parseFloat(row.total);
    }
    return balances;
  }
}
