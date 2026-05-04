/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  observability/consensus.ts
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Pure read-only consensus aggregations over an EpistemologySource. Wires
 *  Beta(α, β) posterior math from bayesian.ts to the witnessed validation
 *  observations the source returns.
 *
 *  Body lands in commit 2 alongside the /mesh/consensus route.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type { ClaimId } from '@extropy/contracts';
import type {
  EpistemologySource,
  ClaimConsensusSnapshot,
  MeshFilter,
} from './source.js';

export async function getClaimConsensus(
  source: EpistemologySource,
  claimId: ClaimId,
): Promise<ClaimConsensusSnapshot | null> {
  return source.getClaimConsensus(claimId);
}

export async function listConsensusDrift(
  source: EpistemologySource,
  filter: MeshFilter & { minDelta?: number; limit?: number },
): Promise<Awaited<ReturnType<EpistemologySource['listConsensusDrift']>>> {
  return source.listConsensusDrift(filter);
}
