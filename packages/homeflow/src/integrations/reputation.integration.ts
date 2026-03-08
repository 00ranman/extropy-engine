/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Reputation Integration
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  HomeFlow-domain reputation tracking via the Reputation Service.
 *  Tracks THERMODYNAMIC domain reputation for household validators.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { EventBusService } from '../services/event-bus.service.js';
import { EntropyDomain } from '@extropy/contracts';
import type { ValidatorId, LoopId } from '@extropy/contracts';

export class ReputationIntegration {
  constructor(
    private eventBus: EventBusService,
    private config: {
      reputationUrl: string;
    },
  ) {}

  /**
   * Report a successful HomeFlow validation to Reputation service.
   */
  async reportSuccess(
    validatorId: string,
    loopId: string,
    deltaS: number,
  ): Promise<void> {
    try {
      await fetch(`${this.config.reputationUrl}/reputation/accrue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          validatorId,
          domain: EntropyDomain.THERMODYNAMIC,
          loopId,
          deltaS,
          source: 'homeflow',
        }),
      });
      console.log(`[homeflow:reputation] Accrued reputation for ${validatorId} in THERMODYNAMIC domain`);
    } catch (err) {
      console.warn('[homeflow:reputation] Failed to report success:', err);
    }
  }

  /**
   * Query a validator's reputation in the THERMODYNAMIC domain.
   */
  async getReputation(validatorId: string): Promise<{
    aggregate: number;
    thermodynamic: number;
  }> {
    try {
      const response = await fetch(`${this.config.reputationUrl}/reputation/${validatorId}`);
      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        return {
          aggregate: (data.aggregate as number) ?? 0,
          thermodynamic: ((data.byDomain as Record<string, number>)?.[EntropyDomain.THERMODYNAMIC]) ?? 0,
        };
      }
    } catch (err) {
      console.warn('[homeflow:reputation] Failed to query reputation:', err);
    }
    return { aggregate: 0, thermodynamic: 0 };
  }

  /**
   * Get the leaderboard for THERMODYNAMIC domain.
   */
  async getLeaderboard(limit = 20): Promise<Array<{
    validatorId: string;
    reputation: number;
    rank: number;
  }>> {
    try {
      const response = await fetch(
        `${this.config.reputationUrl}/leaderboard?domain=${EntropyDomain.THERMODYNAMIC}&limit=${limit}`,
      );
      if (response.ok) {
        return await response.json() as Array<{ validatorId: string; reputation: number; rank: number }>;
      }
    } catch (err) {
      console.warn('[homeflow:reputation] Failed to get leaderboard:', err);
    }
    return [];
  }
}
