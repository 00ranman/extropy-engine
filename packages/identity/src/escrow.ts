/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  @extropy/identity — Threshold reveal escrow
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Shamir Secret Sharing (k-of-n) over GF(256) — byte-oriented, no big-int math.
 *
 *  Used for the v3.1 selective accountability mechanism:
 *
 *      Under governance threshold (default 7-of-12 ecosystem validators),
 *      a DID can be linked back to enforceable real-world identity.
 *
 *  The flow:
 *
 *    1. At onboarding, the participant's device produces a "reveal package":
 *       a JSON blob containing { realIdHash, kycEvidence, contactInfo, ... }.
 *       The participant CHOOSES what to escrow — minimum is the hash of the
 *       real-world identifier so a court order has something to bind to.
 *
 *    2. The package is encrypted with a random 32-byte key K.
 *    3. K is split into n shares with threshold k. Shares are distributed
 *       to ecosystem validators (encrypted to each validator's DID key — that
 *       wrapping is out of scope for this file).
 *
 *    4. To reveal: a governance proposal collects ≥ k shares. This module
 *       reconstructs K and decrypts the package.
 *
 *  This file does Shamir + AES-GCM. Validator-side share wrapping (encrypting
 *  each share to a validator's DID public key) is the next layer; for the
 *  v3.1 sandbox we expose raw shares so callers can integrate their own
 *  wrapping when production hits.
 *
 *  Reference: Shamir (1979), "How to share a secret".
 * ════════════════════════════════════════════════════════════════════════════════
 */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// ────────────────────────────────────────────────────────────────────────────
//  GF(256) arithmetic
// ────────────────────────────────────────────────────────────────────────────
// AES uses the same field. Standard log/exp tables generated from generator 0x03.

const GF_LOG = new Uint8Array(256);
const GF_EXP = new Uint8Array(512);

(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    // Multiply by 0x03 (the generator) in GF(256) with reduction polynomial 0x11b
    let next = x ^ ((x << 1) & 0xff);
    if (x & 0x80) next ^= 0x1b;
    x = next & 0xff;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfDiv(a: number, b: number): number {
  if (a === 0) return 0;
  if (b === 0) throw new Error('gfDiv: division by zero');
  return GF_EXP[(GF_LOG[a] - GF_LOG[b] + 255) % 255];
}

// ────────────────────────────────────────────────────────────────────────────
//  Shamir over GF(256), byte-by-byte
// ────────────────────────────────────────────────────────────────────────────

export interface Share {
  /** 1..n. Index 0 is reserved for the secret itself. */
  index: number;
  /** Same length as the secret. */
  data: Buffer;
}

/** Split a byte buffer into n shares such that any k ≥ threshold reconstructs the original. */
export function splitSecret(secret: Buffer, threshold: number, n: number): Share[] {
  if (threshold < 2) throw new Error('splitSecret: threshold must be ≥ 2');
  if (n < threshold) throw new Error('splitSecret: n must be ≥ threshold');
  if (n > 255) throw new Error('splitSecret: n must be ≤ 255 (GF(256) limit)');

  const shares: Share[] = Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    data: Buffer.alloc(secret.length),
  }));

  // For each byte of the secret, pick a random degree-(threshold-1) polynomial
  // with constant term equal to the secret byte, then evaluate at x = 1..n.
  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    const coeffs = new Uint8Array(threshold);
    coeffs[0] = secret[byteIdx];
    const rand = randomBytes(threshold - 1);
    for (let i = 1; i < threshold; i++) coeffs[i] = rand[i - 1];

    for (let s = 0; s < n; s++) {
      const x = s + 1;
      // Horner's method
      let y = coeffs[threshold - 1];
      for (let c = threshold - 2; c >= 0; c--) {
        y = gfMul(y, x) ^ coeffs[c];
      }
      shares[s].data[byteIdx] = y;
    }
  }
  return shares;
}

/** Reconstruct the secret from any threshold-many distinct shares. */
export function combineShares(shares: Share[]): Buffer {
  if (shares.length < 2) throw new Error('combineShares: need ≥ 2 shares');
  const len = shares[0].data.length;
  for (const s of shares) {
    if (s.data.length !== len) throw new Error('combineShares: shares must be same length');
    if (s.index < 1 || s.index > 255) throw new Error('combineShares: invalid share index');
  }
  const xs = shares.map((s) => s.index);
  if (new Set(xs).size !== xs.length) {
    throw new Error('combineShares: duplicate share indexes');
  }

  const out = Buffer.alloc(len);
  for (let byteIdx = 0; byteIdx < len; byteIdx++) {
    // Lagrange interpolation evaluated at x = 0
    let result = 0;
    for (let i = 0; i < shares.length; i++) {
      let num = 1;
      let den = 1;
      const xi = xs[i];
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        const xj = xs[j];
        num = gfMul(num, xj);
        den = gfMul(den, xi ^ xj);
      }
      const li = gfDiv(num, den);
      result ^= gfMul(shares[i].data[byteIdx], li);
    }
    out[byteIdx] = result;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
//  Reveal package — symmetric encryption around a Shamir-split key
// ────────────────────────────────────────────────────────────────────────────

export interface RevealPackage {
  /** AES-256-GCM ciphertext of the JSON payload. */
  ciphertext: string; // base64
  /** GCM IV (12 bytes). */
  iv: string;        // base64
  /** GCM auth tag (16 bytes). */
  authTag: string;   // base64
  /** Threshold (k of n). */
  threshold: number;
  shareCount: number;
}

export interface SealResult {
  package: RevealPackage;
  shares: Share[];
}

export function sealRevealPackage(
  payload: Record<string, unknown>,
  threshold: number,
  shareCount: number
): SealResult {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const shares = splitSecret(key, threshold, shareCount);
  return {
    package: {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      threshold,
      shareCount,
    },
    shares,
  };
}

export function openRevealPackage(
  pkg: RevealPackage,
  shares: Share[]
): Record<string, unknown> {
  if (shares.length < pkg.threshold) {
    throw new Error(`openRevealPackage: need ≥ ${pkg.threshold} shares, got ${shares.length}`);
  }
  const key = combineShares(shares.slice(0, pkg.threshold));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(pkg.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(pkg.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(pkg.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf-8'));
}

// Default per docs/IDENTITY.md §threshold-reveal-escrow.
export const DEFAULT_THRESHOLD = 7;
export const DEFAULT_SHARE_COUNT = 12;
