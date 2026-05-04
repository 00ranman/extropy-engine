/**
 * Tests for @extropy/decomposition-kit.
 *
 * Covers:
 *   decomposeClaimToSubClaims happy path, domain branches, numeric branch, weight
 *   normalisation, parent linkage, status, and prior wiring through
 *   initBayesianPrior.
 *
 *   detectGodelBoundary positive matches across all self-reference patterns
 *   and negative case for ordinary empirical claims.
 *
 *   Determinism: same input twice (modulo createdAt timestamps) yields the
 *   same shape, statements, weights, and priors.
 */

import { describe, it, expect } from 'vitest';
import {
  ClaimStatus,
  SubClaimStatus,
  EntropyDomain,
  type Claim,
  type ClaimId,
  type LoopId,
  type ValidatorId,
} from '@extropy/contracts';
import { initBayesianPrior } from '@extropy/bayesian';
import { decomposeClaimToSubClaims, detectGodelBoundary } from '../index.js';

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  const base: Claim = {
    id: 'c1' as ClaimId,
    loopId: 'l1' as LoopId,
    statement: 'Refactoring module X reduces complexity by 40 percent',
    domain: EntropyDomain.CODE,
    submitterId: 'v1' as ValidatorId,
    status: ClaimStatus.SUBMITTED,
    bayesianPrior: initBayesianPrior(0.5),
    subClaimIds: [],
    truthScore: 0.5,
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    updatedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  };
  return { ...base, ...overrides };
}

describe('decomposeClaimToSubClaims', () => {
  it('produces sane sub-claims with status pending and parent linkage', () => {
    const claim = makeClaim();
    const subs = decomposeClaimToSubClaims(claim);

    expect(subs.length).toBeGreaterThanOrEqual(2);
    for (const sc of subs) {
      expect(sc.claimId).toBe(claim.id);
      expect(sc.loopId).toBe(claim.loopId);
      expect(sc.domain).toBe(claim.domain);
      expect(sc.status).toBe(SubClaimStatus.PENDING);
      expect(sc.measurementIds).toEqual([]);
      expect(sc.assignedValidatorIds).toEqual([]);
      expect(sc.dependsOn).toEqual([]);
      expect(typeof sc.statement).toBe('string');
      expect(sc.statement.length).toBeGreaterThan(0);
      expect(sc.bayesianPrior).toBeDefined();
      expect(typeof sc.bayesianPrior.posteriorProbability).toBe('number');
    }
  });

  it('weights renormalise to sum to 1', () => {
    const claim = makeClaim();
    const subs = decomposeClaimToSubClaims(claim);
    const total = subs.reduce((s, sc) => s + sc.weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('adds a code-specific sub-claim for code-domain claims', () => {
    const claim = makeClaim({ domain: EntropyDomain.CODE, statement: 'Refactor reduces complexity' });
    const subs = decomposeClaimToSubClaims(claim);
    const codeSpecific = subs.find((sc) => sc.statement.includes('implementation described'));
    expect(codeSpecific).toBeDefined();
  });

  it('adds a cognitive-specific sub-claim for cognitive-domain claims', () => {
    const claim = makeClaim({ domain: EntropyDomain.COGNITIVE, statement: 'Meditation increases focus' });
    const subs = decomposeClaimToSubClaims(claim);
    const cog = subs.find((sc) => sc.statement.includes('reproducible under similar conditions'));
    expect(cog).toBeDefined();
  });

  it('adds a numeric-magnitude sub-claim when statement contains a digit', () => {
    const claim = makeClaim({ statement: 'X dropped by 25 percent' });
    const subs = decomposeClaimToSubClaims(claim);
    const numeric = subs.find((sc) => sc.statement.includes('numeric magnitude'));
    expect(numeric).toBeDefined();
  });

  it('omits the numeric-magnitude sub-claim when statement has no digits', () => {
    const claim = makeClaim({ statement: 'X is more elegant than Y', domain: EntropyDomain.SOCIAL });
    const subs = decomposeClaimToSubClaims(claim);
    const numeric = subs.find((sc) => sc.statement.includes('numeric magnitude'));
    expect(numeric).toBeUndefined();
  });

  it('priors are wired through initBayesianPrior (alpha + beta > 0)', () => {
    const claim = makeClaim();
    const subs = decomposeClaimToSubClaims(claim);
    for (const sc of subs) {
      const a = sc.bayesianPrior.alpha ?? 0;
      const b = sc.bayesianPrior.beta ?? 0;
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(0);
    }
  });

  it('is deterministic in shape, statements, weights, and prior parameters', () => {
    const claim = makeClaim();
    const a = decomposeClaimToSubClaims(claim);
    const b = decomposeClaimToSubClaims(claim);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.statement).toBe(b[i]!.statement);
      expect(a[i]!.weight).toBeCloseTo(b[i]!.weight, 12);
      expect(a[i]!.bayesianPrior.alpha).toBeCloseTo(b[i]!.bayesianPrior.alpha ?? 0, 12);
      expect(a[i]!.bayesianPrior.beta).toBeCloseTo(b[i]!.bayesianPrior.beta ?? 0, 12);
    }
  });
});

describe('detectGodelBoundary', () => {
  it('returns null for an ordinary empirical claim', () => {
    expect(detectGodelBoundary('Refactor reduced complexity by 40 percent')).toBeNull();
    expect(detectGodelBoundary('User retention rose 12 points in Q1')).toBeNull();
  });

  it('detects every documented self-reference pattern', () => {
    const positives = [
      'This claim is true',
      'this statement is provable',
      'The proof refers to itself',
      'The argument is self-referential',
      'This cannot be verified by external evidence',
      'The lemma is unprovable in ZFC',
      'The halting problem is undecidable',
    ];
    for (const s of positives) {
      const reason = detectGodelBoundary(s);
      expect(reason, `expected match for: ${s}`).not.toBeNull();
      expect(reason).toMatch(/boundary detected/);
    }
  });

  it('matches case-insensitively', () => {
    expect(detectGodelBoundary('THIS CLAIM is paradoxical')).not.toBeNull();
    expect(detectGodelBoundary('It Is Undecidable')).not.toBeNull();
  });

  it('is deterministic across repeated calls', () => {
    const s = 'This statement contradicts itself';
    expect(detectGodelBoundary(s)).toBe(detectGodelBoundary(s));
  });
});
