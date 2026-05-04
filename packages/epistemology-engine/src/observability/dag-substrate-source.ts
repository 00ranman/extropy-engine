/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  DagSubstrateSource — EpistemologySource backed by the DAG substrate
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  v3.1 STATUS: stub. The DAG node API is still settling; the routes are
 *  written against this interface so the swap to a real reader is a single
 *  configuration flip (`EPISTEMOLOGY_SOURCE=dag-substrate`).
 *
 *  Architectural note (Randall, locked-in):
 *
 *    "The DAG is the foundational substrate everything gets written onto,
 *     like a mesh of smart contracts forming layered DFAOs."
 *
 *  That means this source, when wired, will read directly from the substrate:
 *  validation receipts, bayesian-update receipts, refutation receipts, and
 *  reveal-escrow receipts are all DAG vertices. The Postgres source is a
 *  cache of these; this source is the source of truth.
 *
 *  Until the DAG node ships a query API, every method here throws with a
 *  clear sentinel message. Callers are expected to either:
 *
 *    1. Pin EPISTEMOLOGY_SOURCE=postgres in v3.1.x deployments, or
 *    2. Catch DagSubstrateNotWiredError and degrade gracefully.
 *
 *  The shape of every method matches the Postgres source byte-for-byte so
 *  routes do not branch on backend.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type { ClaimId, Timestamp } from '@extropy/contracts';
import type {
  EpistemologySource,
  MeshFilter,
  ValidationObservation,
  ClaimConsensusSnapshot,
  FalsifiabilityStat,
  ValidatorCoEdge,
} from './source.js';

export class DagSubstrateNotWiredError extends Error {
  constructor(method: string) {
    super(
      `DagSubstrateSource.${method}: DAG node read API not yet wired in v3.1. ` +
        `Set EPISTEMOLOGY_SOURCE=postgres or catch DagSubstrateNotWiredError.`,
    );
    this.name = 'DagSubstrateNotWiredError';
  }
}

export interface DagSubstrateSourceOptions {
  /** DAG node base URL. Reserved for future use. */
  dagNodeUrl?: string;
}

export class DagSubstrateSource implements EpistemologySource {
  readonly kind = 'dag-substrate' as const;

  // Reserved for future use. Stored so init() can validate it without changing the interface.
  private readonly dagNodeUrl: string;
  private initialized = false;

  constructor(opts: DagSubstrateSourceOptions = {}) {
    this.dagNodeUrl = opts.dagNodeUrl ?? process.env.DAG_NODE_URL ?? 'http://127.0.0.1:4201';
  }

  async init(): Promise<void> {
    // No-op for v3.1 stub. When the DAG node ships, this will:
    //   1. GET {dagNodeUrl}/health
    //   2. Verify spec compatibility
    //   3. Subscribe to relevant receipt streams
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  async listValidationObservations(): Promise<ValidationObservation[]> {
    this.assertInit();
    throw new DagSubstrateNotWiredError('listValidationObservations');
  }

  async getClaimConsensus(_claimId: ClaimId): Promise<ClaimConsensusSnapshot | null> {
    this.assertInit();
    throw new DagSubstrateNotWiredError('getClaimConsensus');
  }

  async listConsensusDrift(): Promise<
    Array<{ claimId: ClaimId; previous: number; current: number; observedAt: Timestamp }>
  > {
    this.assertInit();
    throw new DagSubstrateNotWiredError('listConsensusDrift');
  }

  async computeFalsifiability(_filter: MeshFilter): Promise<FalsifiabilityStat> {
    this.assertInit();
    throw new DagSubstrateNotWiredError('computeFalsifiability');
  }

  async listValidatorCoEdges(): Promise<ValidatorCoEdge[]> {
    this.assertInit();
    throw new DagSubstrateNotWiredError('listValidatorCoEdges');
  }

  async listValidatorDids(): Promise<string[]> {
    this.assertInit();
    throw new DagSubstrateNotWiredError('listValidatorDids');
  }

  private assertInit(): void {
    if (!this.initialized) {
      throw new Error('DagSubstrateSource: init() must be called before queries');
    }
  }
}
