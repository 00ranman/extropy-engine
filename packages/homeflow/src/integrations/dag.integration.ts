/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HomeFlow — DAG Substrate Integration
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Records home automation verification loops in the DAG substrate.
 *
 *  Each significant HomeFlow action creates a vertex:
 *    - Device commands (with state transitions)
 *    - Entropy measurements
 *    - Claim submissions
 *    - Credential issuances
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { v4 as uuidv4 } from 'uuid';
import type { DatabaseService } from '../services/database.service.js';
import type { EventBusService } from '../services/event-bus.service.js';
import { VertexType } from '@extropy/contracts';
import type { VertexId, DFAOId } from '@extropy/contracts';

export class DAGIntegration {
  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private config: {
      dagSubstrateUrl: string;
    },
  ) {}

  /**
   * Record a home automation action in the DAG.
   */
  async recordVertex(
    householdId: string,
    vertexType: string,
    payload: Record<string, unknown>,
    relatedEntity: string,
    entityType: string,
    dfaoId?: string,
  ): Promise<{ vertexId: string }> {
    const vertexId = uuidv4();

    // Submit to DAG substrate
    try {
      await fetch(`${this.config.dagSubstrateUrl}/vertices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertexType,
          payload: {
            ...payload,
            source: 'homeflow',
            householdId,
          },
          dfaoId: dfaoId ?? undefined,
        }),
      });
    } catch (err) {
      console.warn('[homeflow:dag] Failed to record vertex:', err);
    }

    // Record local reference
    await this.db.query(
      `INSERT INTO hf_dag_references (id, vertex_id, vertex_type, household_id, related_entity, entity_type, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [uuidv4(), vertexId, vertexType, householdId, relatedEntity, entityType],
    );

    return { vertexId };
  }

  /**
   * Record a measurement vertex.
   */
  async recordMeasurementVertex(
    householdId: string,
    measurementData: Record<string, unknown>,
    dfaoId?: string,
  ): Promise<{ vertexId: string }> {
    return this.recordVertex(
      householdId,
      VertexType.MEASUREMENT,
      measurementData,
      measurementData.id as string ?? uuidv4(),
      'entropy_measurement',
      dfaoId,
    );
  }

  /**
   * Record a loop open vertex.
   */
  async recordLoopOpenVertex(
    householdId: string,
    loopId: string,
    claimId: string,
    dfaoId?: string,
  ): Promise<{ vertexId: string }> {
    return this.recordVertex(
      householdId,
      VertexType.LOOP_OPEN,
      { loopId, claimId },
      loopId,
      'loop',
      dfaoId,
    );
  }

  /**
   * Record a credential issuance vertex.
   */
  async recordCredentialVertex(
    householdId: string,
    credentialId: string,
    validatorId: string,
    level: string,
    dfaoId?: string,
  ): Promise<{ vertexId: string }> {
    return this.recordVertex(
      householdId,
      VertexType.CREDENTIAL_ISSUE,
      { credentialId, validatorId, level },
      credentialId,
      'credential',
      dfaoId,
    );
  }

  /**
   * Get DAG references for a household.
   */
  async getDAGReferences(householdId: string, limit = 50) {
    const { rows } = await this.db.query(
      `SELECT * FROM hf_dag_references WHERE household_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [householdId, limit],
    );
    return rows;
  }
}
