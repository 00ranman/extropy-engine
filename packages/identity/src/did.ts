/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  @extropy/identity — DID method: did:extropy
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Custom DID method scoped to the Extropy Engine network.
 *
 *      did:extropy:<32-byte ed25519 pubkey, hex>
 *
 *  We anchor the DID identifier to the participant's long-lived signing key.
 *  The DID is a string label for the genesis vertex of that participant's
 *  DAG (see architecture/SUBSTRATE.md).
 *
 *  This file only handles the DID *string* + the W3C-compliant DID document.
 *  The cryptographic key material lives in `crypto.ts`. Lifecycle (rotation,
 *  recovery, revocation) is tracked as DAG vertices, not by mutating documents
 *  in place.
 *
 *  References:
 *    - W3C DID Core 1.0
 *    - docs/IDENTITY.md §canonical-flow step 3
 * ════════════════════════════════════════════════════════════════════════════════
 */

import type { IdentityKeyPair } from './crypto.js';

export const DID_METHOD = 'extropy';
export const DID_PREFIX = `did:${DID_METHOD}:`;

export interface DidDocument {
  '@context': string[];
  id: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  keyAgreement?: string[];
  service?: ServiceEndpoint[];
  /** ISO-8601 timestamp of issuance. Stored in the document for parity with VCs. */
  created: string;
}

export interface VerificationMethod {
  id: string;
  type: 'Ed25519VerificationKey2020';
  controller: string;
  /** multibase-encoded public key, RFC 8410. */
  publicKeyMultibase: string;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  Encode / parse
// ────────────────────────────────────────────────────────────────────────────

export function encodeDid(publicKeyHex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) {
    throw new Error('encodeDid: expected a 32-byte hex public key');
  }
  return `${DID_PREFIX}${publicKeyHex.toLowerCase()}`;
}

export function parseDid(did: string): { method: string; identifier: string } {
  const m = did.match(/^did:([a-z0-9]+):(.+)$/i);
  if (!m) throw new Error(`parseDid: malformed DID: ${did}`);
  return { method: m[1], identifier: m[2] };
}

export function isExtropyDid(did: string): boolean {
  try {
    const { method, identifier } = parseDid(did);
    return method === DID_METHOD && /^[0-9a-f]{64}$/i.test(identifier);
  } catch {
    return false;
  }
}

export function publicKeyHexFromDid(did: string): string {
  const { method, identifier } = parseDid(did);
  if (method !== DID_METHOD) {
    throw new Error(`publicKeyHexFromDid: not an Extropy DID: ${did}`);
  }
  if (!/^[0-9a-f]{64}$/i.test(identifier)) {
    throw new Error(`publicKeyHexFromDid: malformed identifier: ${identifier}`);
  }
  return identifier.toLowerCase();
}

// ────────────────────────────────────────────────────────────────────────────
//  Multibase (z-base58btc) for publicKeyMultibase
// ────────────────────────────────────────────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncode(buf: Buffer): string {
  if (buf.length === 0) return '';
  let n = 0n;
  for (const b of buf) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    const r = Number(n % 58n);
    n /= 58n;
    out = BASE58_ALPHABET[r] + out;
  }
  // Preserve leading zero bytes.
  for (let i = 0; i < buf.length && buf[i] === 0; i++) out = '1' + out;
  return out;
}

/**
 * RFC 8410 multikey prefix for Ed25519 (0xed01) followed by raw pubkey,
 * encoded as base58btc, prefixed with 'z' per the multibase spec.
 */
export function publicKeyMultibase(publicKeyHex: string): string {
  const raw = Buffer.from(publicKeyHex, 'hex');
  const prefixed = Buffer.concat([Buffer.from([0xed, 0x01]), raw]);
  return 'z' + base58btcEncode(prefixed);
}

// ────────────────────────────────────────────────────────────────────────────
//  Document
// ────────────────────────────────────────────────────────────────────────────

export interface BuildDocumentOptions {
  keyPair: IdentityKeyPair;
  /** Optional service endpoints (e.g. PSLL anchor URL, node-handshake URL). */
  services?: ServiceEndpoint[];
  /** Override creation timestamp. Defaults to now. */
  createdAt?: string;
}

export function buildDidDocument(opts: BuildDocumentOptions): DidDocument {
  const did = encodeDid(opts.keyPair.publicKeyHex);
  const keyId = `${did}#keys-1`;
  const doc: DidDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    verificationMethod: [
      {
        id: keyId,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase: publicKeyMultibase(opts.keyPair.publicKeyHex),
      },
    ],
    authentication: [keyId],
    assertionMethod: [keyId],
    created: opts.createdAt ?? new Date().toISOString(),
  };
  if (opts.services && opts.services.length > 0) {
    doc.service = opts.services;
  }
  return doc;
}
