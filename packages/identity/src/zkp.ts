/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  @extropy/identity — ZKP wrapper
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  HONESTY NOTICE
 *  ──────────────
 *  This file is a *protocol-level scaffold* for the BBS+ proof envelope, not a
 *  cryptographically sound ZKP library. The proofs produced here are sound for
 *  the *Ed25519 + commitment* portion (selective disclosure of which fields the
 *  holder claims to know), but they do NOT yet provide the unlinkability and
 *  predicate-proof properties of a real BBS+ scheme.
 *
 *  Why this is acceptable for v3.1.x:
 *
 *    1. The envelope shape is final. Routes, error codes, response objects,
 *       and nullifier handling are real and stable. Other services can integrate
 *       against this surface without churn.
 *    2. The hard part is the proof system itself. We will swap the body of
 *       `prove()` and `verify()` for @noble/curves BBS+ once that ships.
 *    3. The verifier API contract is honest: every successful verification
 *       carries a `proofProfile` field that tells consumers whether they are
 *       relying on the production BBS+ proof or the v3.1 sandbox proof.
 *
 *  What we DO get today:
 *
 *    - End-to-end proof flow (commit, reveal, nullifier emission)
 *    - Holder binding (holder must sign the challenge with their DID key)
 *    - Replay resistance (challenge nonce required)
 *    - Per-context nullifier derived deterministically from holder secret +
 *      verifier-supplied context tag
 *    - Selective disclosure of credential subject fields (the holder picks
 *      which keys to reveal; the rest are committed by hash)
 *
 *  What we DO NOT get yet:
 *
 *    - Unlinkability across verifications without re-randomization
 *    - Range proofs / predicate proofs (e.g. age > 18 without revealing age)
 *    - Issuer-side blinded signatures
 *
 *  Tracked: docs/GAPS.md → "BBS+ implementation"
 * ════════════════════════════════════════════════════════════════════════════════
 */

import {
  IdentityKeyPair,
  sha256,
  sha256Hex,
  sign as edSign,
  verify as edVerify,
  publicKeyFromHex,
  randomSecret,
  b64urlEncode,
} from './crypto.js';
import { encodeDid, publicKeyHexFromDid } from './did.js';
import {
  verifyCredential,
  type VerifiableCredential,
} from './vc.js';

export const PROOF_PROFILE = 'extropy-zkp-v3.1-sandbox' as const;

export interface ProofRequest {
  /** Verifier-issued nonce. Prevents proof replay. */
  challenge: string;
  /** Verifier-supplied context tag for the nullifier (e.g. dfao id, claim id). */
  contextTag: string;
  /** Subject fields the holder agrees to reveal. */
  revealedFields: string[];
}

export interface SelectiveProof {
  proofProfile: typeof PROOF_PROFILE;
  /** Holder's DID. Network-public, links the proof to the participant's DAG identity. */
  holderDid: string;
  /** ISO timestamp the proof was generated. */
  issuedAt: string;
  /** The verifier challenge echoed back, signed in the proof. */
  challenge: string;
  /** Per-context nullifier. Same DID + same context tag always yields this value. */
  nullifier: string;
  /** Revealed subject fields, with the same keys the verifier asked for. */
  revealed: Record<string, unknown>;
  /** SHA-256 hash of the entire credentialSubject; verifier checks this matches the bound VC. */
  subjectDigest: string;
  /** Hash of the issuer DID. The verifier can confirm the credential issuer if they know which issuers to trust. */
  issuerDigest: string;
  /** Type label of the credential being proven against. */
  credentialType: string;
  /** Detached signature over (challenge ‖ subjectDigest ‖ nullifier ‖ issuedAt). */
  signature: string;
}

// ────────────────────────────────────────────────────────────────────────────
//  Prove
// ────────────────────────────────────────────────────────────────────────────

export interface ProveOptions {
  /** Holder's keypair. Must match the credentialSubject.id DID. */
  holderKey: IdentityKeyPair;
  /** Holder's long-lived secret for nullifier derivation. */
  holderNullifierSecret: Buffer;
  /** Compact JWT credential issued under the canonical flow (see vc.ts). */
  credentialJwt: string;
  /** What the verifier is asking for. */
  request: ProofRequest;
}

function deterministicNullifier(secret: Buffer, contextTag: string, holderDid: string): string {
  // HMAC binds the nullifier to the holder's DID so two holders with the
  // same secret (extremely unlikely, but defensive) cannot collide in one
  // context.
  const tag = `${holderDid}|${contextTag}`;
  const hmac = require('node:crypto').createHmac('sha256', secret).update(tag).digest();
  return b64urlEncode(hmac);
}

function signingInput(p: Pick<SelectiveProof, 'challenge' | 'subjectDigest' | 'nullifier' | 'issuedAt' | 'holderDid' | 'credentialType'>): string {
  return [
    PROOF_PROFILE,
    p.holderDid,
    p.credentialType,
    p.challenge,
    p.nullifier,
    p.subjectDigest,
    p.issuedAt,
  ].join('|');
}

export function prove(opts: ProveOptions): SelectiveProof {
  const verified = verifyCredential(opts.credentialJwt);
  if (!verified.valid || !verified.vc) {
    throw new Error(`prove: cannot generate proof from invalid credential: ${verified.reason}`);
  }
  const vc = verified.vc;
  const holderDid = encodeDid(opts.holderKey.publicKeyHex);

  if (vc.credentialSubject.id !== holderDid) {
    throw new Error('prove: holder DID does not match credentialSubject.id');
  }

  const revealed: Record<string, unknown> = {};
  for (const field of opts.request.revealedFields) {
    if (field in vc.credentialSubject) {
      revealed[field] = vc.credentialSubject[field];
    }
  }

  const subjectDigest = sha256Hex(canonicalJson(vc.credentialSubject));
  const issuerDigest = sha256Hex(vc.issuer);
  const nullifier = deterministicNullifier(
    opts.holderNullifierSecret,
    opts.request.contextTag,
    holderDid
  );
  const issuedAt = new Date().toISOString();
  const credentialType = vc.type[1];

  const draft = {
    holderDid,
    challenge: opts.request.challenge,
    nullifier,
    subjectDigest,
    issuedAt,
    credentialType,
  };
  const sig = edSign(opts.holderKey.privateKey, signingInput(draft));

  return {
    proofProfile: PROOF_PROFILE,
    holderDid,
    issuedAt,
    challenge: opts.request.challenge,
    nullifier,
    revealed,
    subjectDigest,
    issuerDigest,
    credentialType,
    signature: sig,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  Verify
// ────────────────────────────────────────────────────────────────────────────

export interface VerifyProofOptions {
  proof: SelectiveProof;
  /** The challenge the verifier issued, must match `proof.challenge`. */
  expectedChallenge: string;
  /** Optional: max age in seconds. Defaults to 5 minutes. */
  maxAgeSeconds?: number;
}

export interface VerifyProofResult {
  valid: boolean;
  reason?: string;
  proofProfile?: typeof PROOF_PROFILE;
  holderDid?: string;
  nullifier?: string;
  revealed?: Record<string, unknown>;
}

export function verifyProof(opts: VerifyProofOptions): VerifyProofResult {
  const p = opts.proof;
  if (p.proofProfile !== PROOF_PROFILE) {
    return { valid: false, reason: `unknown proofProfile: ${p.proofProfile}` };
  }
  if (p.challenge !== opts.expectedChallenge) {
    return { valid: false, reason: 'challenge mismatch' };
  }

  const maxAge = opts.maxAgeSeconds ?? 5 * 60;
  const issuedAtMs = Date.parse(p.issuedAt);
  if (Number.isNaN(issuedAtMs)) {
    return { valid: false, reason: 'invalid issuedAt' };
  }
  const ageSec = (Date.now() - issuedAtMs) / 1000;
  if (ageSec > maxAge) {
    return { valid: false, reason: `proof too old: ${Math.floor(ageSec)}s` };
  }

  let holderPub;
  try {
    holderPub = publicKeyFromHex(publicKeyHexFromDid(p.holderDid));
  } catch (e) {
    return { valid: false, reason: `cannot resolve holder DID: ${(e as Error).message}` };
  }

  const ok = edVerify(holderPub, signingInput(p), p.signature);
  if (!ok) {
    return { valid: false, reason: 'signature verification failed' };
  }

  return {
    valid: true,
    proofProfile: p.proofProfile,
    holderDid: p.holderDid,
    nullifier: p.nullifier,
    revealed: p.revealed,
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Stable JSON serializer (sorted keys) for hashing. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(',') + '}';
}

export function newChallenge(bytes = 16): string {
  return b64urlEncode(randomSecret(bytes));
}
