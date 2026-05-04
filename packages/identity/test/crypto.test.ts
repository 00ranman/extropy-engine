/**
 * Crypto + nullifier determinism tests.
 *
 * The whole identity layer rests on these primitives behaving correctly. If
 * these tests pass we have:
 *   - working Ed25519 sign/verify
 *   - deterministic per-context nullifiers
 *   - correct base64url round-tripping
 */
import { describe, it, expect } from 'vitest';
import {
  generateIdentityKeyPair,
  sign,
  verify,
  deriveNullifier,
  randomSecret,
  b64urlEncode,
  b64urlDecode,
  sha256,
  sha256Hex,
} from '../src/crypto.js';

describe('crypto', () => {
  it('Ed25519 sign/verify round-trips', () => {
    const kp = generateIdentityKeyPair();
    const msg = 'hello world';
    const sig = sign(kp.privateKey, msg);
    expect(verify(kp.publicKey, msg, sig)).toBe(true);
    expect(verify(kp.publicKey, 'tampered', sig)).toBe(false);
  });

  it('publicKeyHex is 32 bytes (64 hex chars)', () => {
    const kp = generateIdentityKeyPair();
    expect(kp.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('deriveNullifier is deterministic for same secret + context', () => {
    const secret = randomSecret(32);
    const a = deriveNullifier(secret, 'vote:proposal-42');
    const b = deriveNullifier(secret, 'vote:proposal-42');
    expect(a).toBe(b);
  });

  it('deriveNullifier diverges across contexts', () => {
    const secret = randomSecret(32);
    const a = deriveNullifier(secret, 'vote:proposal-42');
    const b = deriveNullifier(secret, 'vote:proposal-43');
    expect(a).not.toBe(b);
  });

  it('deriveNullifier diverges across secrets', () => {
    const a = deriveNullifier(randomSecret(32), 'ctx');
    const b = deriveNullifier(randomSecret(32), 'ctx');
    expect(a).not.toBe(b);
  });

  it('b64url round-trip', () => {
    const buf = Buffer.from('the quick brown fox');
    expect(b64urlDecode(b64urlEncode(buf)).equals(buf)).toBe(true);
  });

  it('sha256 + sha256Hex agree', () => {
    expect(sha256Hex('abc')).toBe(sha256('abc').toString('hex'));
  });
});
