/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  @extropy/identity — Verifiable Credentials
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  W3C VC Data Model 2.0, encoded as JWT with EdDSA (Ed25519).
 *
 *  Two credential shapes ship in v3.1:
 *
 *    PersonhoodCredential    — issued after on-device KYC, attests that a real
 *                              human controls this DID. Issuer is the local
 *                              personal-AI; the network never sees the raw
 *                              claims, only the ZKP-wrapped envelope (see zkp.ts).
 *
 *    OnboardingCredential    — issued when a participant completes the OAuth
 *                              + KYC handshake. Confirms valid onboarding.
 *
 *  Note: in the canonical v3.1 flow, the credential issuer is the participant's
 *  personal AI on their own device — i.e. self-issued from a KYC attestation
 *  the device verified locally. This is unusual for VCs but is the privacy
 *  primitive that makes Digital Autarky work. The network does not trust the
 *  raw VC; it trusts the ZKP wrapper that proves the VC exists, was issued
 *  against valid KYC, and that the holder controls the DID.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import {
  IdentityKeyPair,
  b64urlEncode,
  b64urlDecode,
  sign,
  verify,
} from './crypto.js';
import { encodeDid, publicKeyHexFromDid } from './did.js';
import { publicKeyFromHex } from './crypto.js';

export type CredentialType =
  | 'PersonhoodCredential'
  | 'OnboardingCredential';

export interface VerifiableCredential {
  '@context': string[];
  type: ['VerifiableCredential', CredentialType];
  issuer: string;        // DID of the issuer
  credentialSubject: {
    id: string;          // DID of the subject (usually same as issuer for self-issued)
    [k: string]: unknown;
  };
  issuanceDate: string;  // ISO 8601
  expirationDate?: string;
  /** Hash of the on-device KYC attestation. Network never sees the attestation itself. */
  evidenceDigest?: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  JWT (compact JWS)
// ────────────────────────────────────────────────────────────────────────────

interface JwtHeader {
  alg: 'EdDSA';
  typ: 'JWT';
  kid: string;
}

interface JwtClaims {
  iss: string;
  sub: string;
  iat: number;
  nbf: number;
  exp?: number;
  vc: VerifiableCredential;
}

export interface IssueCredentialOptions {
  type: CredentialType;
  /** Issuer keypair. */
  issuerKey: IdentityKeyPair;
  /** Subject DID. Defaults to the issuer DID (self-issued). */
  subjectDid?: string;
  /** Additional credential subject fields. */
  subjectClaims?: Record<string, unknown>;
  /** Hex digest of on-device evidence (KYC attestation). */
  evidenceDigest?: string;
  /** Validity in seconds. Defaults to 1 year. */
  validitySeconds?: number;
}

export function issueCredential(opts: IssueCredentialOptions): string {
  const issuerDid = encodeDid(opts.issuerKey.publicKeyHex);
  const subjectDid = opts.subjectDid ?? issuerDid;
  const now = Math.floor(Date.now() / 1000);
  const ttl = opts.validitySeconds ?? 365 * 24 * 3600;

  const vc: VerifiableCredential = {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    type: ['VerifiableCredential', opts.type],
    issuer: issuerDid,
    credentialSubject: {
      id: subjectDid,
      ...(opts.subjectClaims ?? {}),
    },
    issuanceDate: new Date(now * 1000).toISOString(),
    expirationDate: new Date((now + ttl) * 1000).toISOString(),
    evidenceDigest: opts.evidenceDigest,
  };

  const header: JwtHeader = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid: `${issuerDid}#keys-1`,
  };
  const claims: JwtClaims = {
    iss: issuerDid,
    sub: subjectDid,
    iat: now,
    nbf: now,
    exp: now + ttl,
    vc,
  };

  const headerB64 = b64urlEncode(Buffer.from(JSON.stringify(header), 'utf-8'));
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(claims), 'utf-8'));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = sign(opts.issuerKey.privateKey, signingInput);
  return `${signingInput}.${sig}`;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  vc?: VerifiableCredential;
  issuerDid?: string;
  subjectDid?: string;
}

export function verifyCredential(jwt: string): VerifyResult {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed JWT (expected 3 parts)' };
  }
  const [headerB64, payloadB64, sigB64] = parts;
  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString('utf-8'));
    claims = JSON.parse(b64urlDecode(payloadB64).toString('utf-8'));
  } catch (e) {
    return { valid: false, reason: 'invalid base64url or JSON in header/payload' };
  }
  if (header.alg !== 'EdDSA') {
    return { valid: false, reason: `unsupported alg: ${header.alg}` };
  }
  const issuerDid = claims.iss;
  let issuerPubKey;
  try {
    const hex = publicKeyHexFromDid(issuerDid);
    issuerPubKey = publicKeyFromHex(hex);
  } catch (e) {
    return { valid: false, reason: `cannot resolve issuer DID: ${(e as Error).message}` };
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  if (!verify(issuerPubKey, signingInput, sigB64)) {
    return { valid: false, reason: 'signature verification failed' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && now > claims.exp) {
    return { valid: false, reason: 'credential expired', vc: claims.vc };
  }
  if (claims.nbf && now < claims.nbf) {
    return { valid: false, reason: 'credential not yet valid', vc: claims.vc };
  }

  return {
    valid: true,
    vc: claims.vc,
    issuerDid: claims.iss,
    subjectDid: claims.sub,
  };
}
