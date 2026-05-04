/**
 * Shamir 7-of-12 reveal escrow tests.
 *
 * Property tests for the threshold reveal mechanism that backs
 * docs/IDENTITY.md §threshold-reveal-escrow.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  splitSecret,
  combineShares,
  sealRevealPackage,
  openRevealPackage,
  DEFAULT_THRESHOLD,
  DEFAULT_SHARE_COUNT,
} from '../src/escrow.js';

describe('shamir GF(256)', () => {
  it('round-trips a 32-byte secret with 7-of-12', () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, 7, 12);
    expect(shares.length).toBe(12);
    expect(shares[0].data.length).toBe(32);

    // Any 7 distinct shares reconstruct the secret.
    const subset = shares.slice(0, 7);
    expect(combineShares(subset).equals(secret)).toBe(true);

    // A non-contiguous selection also works.
    const altSubset = [shares[0], shares[2], shares[4], shares[6], shares[8], shares[10], shares[11]];
    expect(combineShares(altSubset).equals(secret)).toBe(true);
  });

  it('any 6 shares CANNOT reconstruct the secret (sanity bound)', () => {
    // We can't claim cryptographic guarantees in a unit test, but we can
    // confirm that combining sub-threshold shares does not coincidentally
    // produce the original secret on randomly generated inputs.
    const secret = randomBytes(32);
    const shares = splitSecret(secret, 7, 12);
    const subset = shares.slice(0, 6);
    // combineShares with 6 inputs runs Lagrange and returns SOMETHING; it
    // must just not equal the secret.
    let matched = false;
    try {
      const guess = combineShares(subset);
      matched = guess.equals(secret);
    } catch {
      // It's also fine to refuse; some implementations require ≥ k.
    }
    expect(matched).toBe(false);
  });

  it('rejects threshold below 2 and n < threshold', () => {
    expect(() => splitSecret(randomBytes(8), 1, 5)).toThrow();
    expect(() => splitSecret(randomBytes(8), 5, 3)).toThrow();
  });
});

describe('reveal package', () => {
  it('seals and opens with default 7-of-12', () => {
    const payload = {
      realIdHash: 'a'.repeat(64),
      contact: 'court-order@example.test',
      kycEvidence: 'opaque-blob',
    };
    const sealed = sealRevealPackage(payload, DEFAULT_THRESHOLD, DEFAULT_SHARE_COUNT);
    expect(sealed.shares.length).toBe(DEFAULT_SHARE_COUNT);
    const opened = openRevealPackage(sealed.package, sealed.shares.slice(0, DEFAULT_THRESHOLD));
    expect(opened).toEqual(payload);
  });

  it('opens with any 7 of 12 shares', () => {
    const payload = { x: 1, y: 'two', z: [3, 4, 5] };
    const sealed = sealRevealPackage(payload, 7, 12);
    const subset = [
      sealed.shares[1],
      sealed.shares[3],
      sealed.shares[5],
      sealed.shares[7],
      sealed.shares[9],
      sealed.shares[11],
      sealed.shares[0],
    ];
    expect(openRevealPackage(sealed.package, subset)).toEqual(payload);
  });

  it('refuses to open with fewer than threshold shares', () => {
    const sealed = sealRevealPackage({ x: 1 }, 7, 12);
    expect(() => openRevealPackage(sealed.package, sealed.shares.slice(0, 6))).toThrow();
  });
});
