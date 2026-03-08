/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — Claim Generation Service
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Auto-generates claims to the Epistemology Engine when home automation
 *  actions produce measurable entropy reduction (ΔS > 0).
 *
 *  Also handles validation tasks routed to HomeFlow by SignalFlow.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from './database.service.js';
import type { EventBusService } from './event-bus.service.js';
import type { EntropyService } from './entropy.service.js';
import type { HomeEntropyReduction, HouseholdId } from '../types/index.js';
import { HomeFlowEventType } from '../types/index.js';
import { EntropyDomain } from '@extropy/contracts';
import type { ClaimId, LoopId, ValidatorId } from '@extropy/contracts';

export class ClaimService {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private entropyService: EntropyService,
    private config: {
      epistemologyUrl: string;
      loopLedgerUrl: string;
    },
  ) {}

  /**
   * Auto-generate a claim from an entropy reduction measurement.
   *
   * This creates:
   *   1. A Loop in the Loop Ledger (via HTTP)
   *   2. A Claim in the Epistemology Engine (via HTTP)
   *   3. Local tracking in HomeFlow
   */
  async generateClaimFromReduction(
    reduction: HomeEntropyReduction,
  ): Promise<{ claimId: string; loopId: string }> {
    const loopId = uuidv4() as string;
    const claimId = uuidv4() as string;

    // Construct human-readable claim statement
    const deltaKwh = (reduction.before.energyConsumedWh - reduction.after.energyConsumedWh) / 1000;
    const statement = `HomeFlow automation reduced household ${reduction.householdId} thermodynamic entropy by ${reduction.deltaS.toFixed(4)} J/K ` +
      `(energy savings: ${reduction.breakdown.energySavingsJK.toFixed(2)} J/K, ` +
      `temperature optimization: ${reduction.breakdown.temperatureOptimizationJK.toFixed(2)} J/K, ` +
      `resource efficiency: ${reduction.breakdown.resourceEfficiencyJK.toFixed(2)} J/K) ` +
      `over the measurement period.`;

    // Get household validator
    const { rows: households } = await this.db.query(
      `SELECT validator_id FROM hf_households WHERE id = $1`,
      [reduction.householdId],
    );
    const validatorId = households[0]?.validator_id ?? 'homeflow-system';

    // 1. Open a loop in Loop Ledger
    try {
      const loopResponse = await fetch(`${this.config.loopLedgerUrl}/loops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: EntropyDomain.THERMODYNAMIC,
          claimId,
          parentLoopIds: [],
        }),
      });

      if (loopResponse.ok) {
        const loopData = await loopResponse.json() as Record<string, unknown>;
        console.log(`[homeflow:claims] Loop opened: ${loopData.id ?? loopId}`);
      }
    } catch (err) {
      console.warn('[homeflow:claims] Failed to open loop in Loop Ledger (service may be offline):', err);
    }

    // 2. Submit claim to Epistemology Engine
    try {
      const claimResponse = await fetch(`${this.config.epistemologyUrl}/claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loopId,
          statement,
          domain: EntropyDomain.THERMODYNAMIC,
          submitterId: validatorId,
          initialPrior: Math.min(0.9, 0.5 + reduction.confidence * 0.4),
        }),
      });

      if (claimResponse.ok) {
        const claimData = await claimResponse.json() as Record<string, unknown>;
        console.log(`[homeflow:claims] Claim submitted to Epistemology Engine`);
      }
    } catch (err) {
      console.warn('[homeflow:claims] Failed to submit claim to Epistemology Engine (service may be offline):', err);
    }

    // 3. Local tracking
    await this.db.query(
      `INSERT INTO hf_claims (id, household_id, loop_id, claim_id, delta_s, statement, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuidv4(), reduction.householdId, loopId, claimId, reduction.deltaS, statement, 'submitted'],
    );

    // 4. Update the entropy reduction with loop reference
    await this.db.query(
      `UPDATE hf_entropy_reductions SET loop_id = $1, claim_id = $2 WHERE household_id = $3 AND measured_at = $4`,
      [loopId, claimId, reduction.householdId, reduction.measuredAt],
    );

    // 5. Emit event
    await this.eventBus.publish(
      HomeFlowEventType.CLAIM_AUTO_GENERATED,
      loopId,
      {
        claimId: claimId as ClaimId,
        loopId: loopId as LoopId,
        householdId: reduction.householdId,
        deltaS: reduction.deltaS,
        statement,
      },
    );

    console.log(`[homeflow:claims] Claim auto-generated: ΔS=${reduction.deltaS.toFixed(4)} J/K, loop=${loopId}`);

    return { claimId, loopId };
  }

  /**
   * Handle a validation task assigned by SignalFlow.
   * HomeFlow validates entropy claims from other users' home automation.
   */
  async handleValidationTask(
    taskId: string,
    claimId: string,
    loopId: string,
    fromService: string,
    entropyDomain: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    // Record task assignment
    await this.db.query(
      `INSERT INTO hf_validation_tasks (id, task_id, claim_id, loop_id, from_service, entropy_domain, assigned_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuidv4(), taskId, claimId, loopId, fromService, entropyDomain, now],
    );

    await this.eventBus.publish(
      HomeFlowEventType.VALIDATION_TASK_RECEIVED,
      loopId,
      {
        taskId,
        claimId: claimId as ClaimId,
        loopId: loopId as LoopId,
        fromService,
        entropyDomain: entropyDomain as EntropyDomain,
      },
    );

    // Auto-validate if it's a thermodynamic domain claim (HomeFlow has expertise)
    if (entropyDomain === EntropyDomain.THERMODYNAMIC) {
      await this.autoValidate(taskId, claimId, loopId);
    }
  }

  /**
   * Auto-validate a thermodynamic entropy claim.
   * In production, this would cross-reference IoT sensor data.
   */
  private async autoValidate(taskId: string, claimId: string, loopId: string): Promise<void> {
    // Check if we have any corroborating measurements
    const { rows: reductions } = await this.db.query(
      `SELECT delta_s, confidence FROM hf_entropy_reductions WHERE loop_id = $1 LIMIT 1`,
      [loopId],
    );

    let verdict: 'confirmed' | 'denied' | 'insufficient_evidence';
    let confidence: number;
    let justification: string;

    if (reductions.length > 0 && reductions[0].delta_s > 0) {
      verdict = 'confirmed';
      confidence = reductions[0].confidence;
      justification = `HomeFlow sensor data corroborates ΔS=${reductions[0].delta_s.toFixed(4)} J/K with confidence ${confidence.toFixed(2)}`;
    } else {
      verdict = 'insufficient_evidence';
      confidence = 0.3;
      justification = 'No corroborating sensor data available in HomeFlow for this loop';
    }

    // Update local task
    await this.db.query(
      `UPDATE hf_validation_tasks SET verdict=$1, confidence=$2, justification=$3, completed_at=NOW() WHERE task_id=$4`,
      [verdict, confidence, justification, taskId],
    );

    // Report back to SignalFlow
    try {
      // In production, POST to SignalFlow task completion endpoint
      console.log(`[homeflow:claims] Validation task ${taskId}: ${verdict} (confidence: ${confidence})`);
    } catch (err) {
      console.warn('[homeflow:claims] Failed to report validation result:', err);
    }

    await this.eventBus.publish(
      HomeFlowEventType.VALIDATION_TASK_COMPLETED,
      loopId,
      {
        taskId,
        claimId: claimId as ClaimId,
        verdict,
        confidence,
        justification,
      },
    );
  }

  /**
   * Get claims history for a household.
   */
  async getClaimsHistory(householdId: string, limit = 50) {
    const { rows } = await this.db.query(
      `SELECT * FROM hf_claims WHERE household_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [householdId, limit],
    );
    return rows;
  }

  /**
   * Update local claim status when we receive an event from Epistemology Engine.
   */
  async updateClaimStatus(claimId: string, status: string, xpEarned?: number): Promise<void> {
    await this.db.query(
      `UPDATE hf_claims SET status=$1, xp_earned=COALESCE($2, xp_earned), updated_at=NOW() WHERE claim_id=$3`,
      [status, xpEarned ?? null, claimId],
    );
  }
}
