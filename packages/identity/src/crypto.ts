/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  @extropy/identity — Cryptographic primitives
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Ed25519 signing, SHA-256 hashing, HMAC-SHA256 nullifier derivation,
 *  base64url codec.
 *
 *  All primitives use Node.js built-in `crypto` so we don't pull in extra deps
 *  for the v3.1 sandbox. Production will likely move to @noble/curves once we
 *  add BBS+ proofs (which Node crypto does not provide).
 *
 *  Style matches packages/node-handshake/src/keys.ts so the two layers can
 *  interoperate: a DID's signing key may be exported and reused for the
 *  node-handshake nodeId.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  createHmac,
  createHash,
  randomBytes,
  sign as nodeSign,
  verify as nodeVerify,
  KeyObject,
} from 'node:crypto';

// ────────────────────────────────────────────────────────────────────────────
//  Base64url
// ────────────────────────────────────────────────────────────────────────────

export function b64urlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

// ────────────────────────────────────────────────────────────────────────────
//  Hashing
// ────────────────────────────────────────────────────────────────────────────

export function sha256(input: Buffer | string): Buffer {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return createHash('sha256').update(buf).digest();
}

export function sha256Hex(input: Buffer | string): string {
  return sha256(input).toString('hex');
}

// ────────────────────────────────────────────────────────────────────────────
//  Ed25519 keypair
// ────────────────────────────────────────────────────────────────────────────

export interface IdentityKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Raw 32-byte Ed25519 public key, base64url-encoded. */
  publicKeyB64u: string;
  /** Raw 32-byte Ed25519 public key as a hex string. Used for did:extropy:<hex>. */
  publicKeyHex: string;
}

/** Strip the 12-byte SPKI prefix to get the raw 32-byte Ed25519 pubkey. */
function rawPub(publicKey: KeyObject): Buffer {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return Buffer.from(der.subarray(der.length - 32));
}

/** SPKI wrapper for a raw 32-byte Ed25519 pubkey. */
const ED25519_SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

export function generateIdentityKeyPair(): IdentityKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = rawPub(publicKey);
  return {
    privateKey,
    publicKey,
    publicKeyB64u: b64urlEncode(raw),
    publicKeyHex: raw.toString('hex'),
  };
}

export function publicKeyFromHex(hex: string): KeyObject {
  const raw = Buffer.from(hex, 'hex');
  if (raw.length !== 32) {
    throw new Error(`invalid Ed25519 public key length: ${raw.length} (expected 32)`);
  }
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  return createPublicKey({ key: spki, format: 'der', type: 'spki' });
}

export function privateKeyFromPem(pem: string): KeyObject {
  return createPrivateKey({ key: pem, format: 'pem' });
}

// ────────────────────────────────────────────────────────────────────────────
//  Sign / verify
// ────────────────────────────────────────────────────────────────────────────

export function sign(privateKey: KeyObject, payload: string | Buffer): string {
  const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload;
  // Ed25519 ignores the algorithm parameter (must be null).
  return b64urlEncode(nodeSign(null, buf, privateKey));
}

export function verify(
  publicKey: KeyObject,
  payload: string | Buffer,
  signatureB64u: string
): boolean {
  const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload;
  try {
    return nodeVerify(null, buf, publicKey, b64urlDecode(signatureB64u));
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  HMAC nullifier derivation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Derive a per-context nullifier from a long-lived secret + context tag.
 *
 * The same DID acting in different DFAOs MUST produce different nullifiers,
 * so observers in DFAO A cannot correlate that participant's actions with
 * their actions in DFAO B without explicit consent.
 *
 * In production this is a Pedersen commitment inside the BBS+ proof. In the
 * v3.1 sandbox we use HMAC-SHA256(secret, contextTag) which gives the same
 * unlinkability property as long as `secret` never leaves the device.
 */
export function deriveNullifier(secret: Buffer, contextTag: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(contextTag).digest());
}

export function randomSecret(bytes = 32): Buffer {
  return randomBytes(bytes);
}
