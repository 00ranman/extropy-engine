/**
 * @extropy/decomposition-kit
 *
 * Portable claim decomposition helpers extracted from
 * epistemology-engine routes/legacy in v3.1. Two pure functions:
 *
 *   decomposeClaimToSubClaims(claim) -> Array<Omit<SubClaim, 'id'>>
 *     Deterministic rule-based splitter. Generates 2 base sub-claims
 *     plus optional domain-specific and numeric-magnitude sub-claims,
 *     then renormalises weights to sum to 1.
 *
 *   detectGodelBoundary(statement) -> string | null
 *     Returns a human-readable reason if the statement matches one of
 *     the self-reference / undecidability patterns the v3.0 surface
 *     looked for. Returns null for ordinary empirical claims.
 *
 * Production callers may swap decomposeClaimToSubClaims for an LLM at
 * the personal-AI edge. The default implementation here is the
 * deterministic baseline used by /legacy and the tests.
 */

import {
  SubClaimStatus,
  type Claim,
  type SubClaim,
} from '@extropy/contracts';

import { initBayesianPrior } from '@extropy/bayesian';

/**
 * Decomposes a top-level claim into atomic sub-claims.
 * Deterministic rule-based decomposition (production uses an LLM at the edge).
 */
export function decomposeClaimToSubClaims(claim: Claim): Array<Omit<SubClaim, 'id'>> {
  const base: Array<Omit<SubClaim, 'id'>> = [
    {
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The entropy reduction claimed in "${claim.statement}" is measurable and quantifiable`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.7),
      measurementIds: [],
      assignedValidatorIds: [],
      weight: 0.3,
      dependsOn: [],
      createdAt: new Date().toISOString(),
    },
    {
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `There is a direct causal link between the action and the outcome in "${claim.statement}"`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.6),
      measurementIds: [],
      assignedValidatorIds: [],
      weight: 0.4,
      dependsOn: [],
      createdAt: new Date().toISOString(),
    },
  ];

  const domainSpecific: Array<Omit<SubClaim, 'id'>> = [];

  if (claim.domain === 'code') {
    domainSpecific.push({
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The implementation described in "${claim.statement}" is technically correct and functions as claimed`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.65),
      measurementIds: [],
      assignedValidatorIds: [],
      weight: 0.2,
      dependsOn: [],
      createdAt: new Date().toISOString(),
    });
  }

  if (claim.domain === 'cognitive') {
    domainSpecific.push({
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The cognitive effect claimed in "${claim.statement}" is reproducible under similar conditions`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.55),
      measurementIds: [],
      assignedValidatorIds: [],
      weight: 0.2,
      dependsOn: [],
      createdAt: new Date().toISOString(),
    });
  }

  if (/\d/.test(claim.statement)) {
    domainSpecific.push({
      claimId: claim.id,
      loopId: claim.loopId,
      statement: `The numeric magnitude stated in "${claim.statement}" is accurate within ±5%`,
      domain: claim.domain,
      status: SubClaimStatus.PENDING,
      bayesianPrior: initBayesianPrior(0.6),
      measurementIds: [],
      assignedValidatorIds: [],
      weight: 0.1,
      dependsOn: [],
      createdAt: new Date().toISOString(),
    });
  }

  // Renormalize weights.
  const all = [...base, ...domainSpecific];
  const totalWeight = all.reduce((s, sc) => s + sc.weight, 0);
  return all.map((sc) => ({ ...sc, weight: sc.weight / totalWeight }));
}

/**
 * Detects if a claim is self-referential or otherwise undecidable.
 * Godel-boundary detection, very simplified.
 */
export function detectGodelBoundary(statement: string): string | null {
  const lower = statement.toLowerCase();
  const selfRefPatterns = [
    'this claim',
    'this statement',
    'itself',
    'self-referential',
    'cannot be verified',
    'is unprovable',
    'is undecidable',
  ];
  for (const pattern of selfRefPatterns) {
    if (lower.includes(pattern)) {
      return `Gödel boundary detected: claim contains self-referential pattern "${pattern}"`;
    }
  }
  return null;
}
