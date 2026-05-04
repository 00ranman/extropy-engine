/**
 * DID + VC + ZKP tests.
 *
 * Walks the canonical-flow primitives end-to-end:
 *   1. Generate keypair
 *   2. Encode did:extropy
 *   3. Self-issue a PersonhoodCredential
 *   4. Verify the credential
 *   5. Generate a selective proof
 *   6. Verify the proof
 *   7. Confirm tamper detection
 */
import { describe, it, expect } from 'vitest';
import { generateIdentityKeyPair, randomSecret } from '../src/crypto.js';
import {
  encodeDid,
  isExtropyDid,
  publicKeyHexFromDid,
  buildDidDocument,
} from '../src/did.js';
import { issueCredential, verifyCredential } from '../src/vc.js';
import { prove, verifyProof, newChallenge, PROOF_PROFILE } from '../src/zkp.js';

describe('did:extropy', () => {
  it('encodes and parses round-trip', () => {
    const kp = generateIdentityKeyPair();
    const did = encodeDid(kp.publicKeyHex);
    expect(isExtropyDid(did)).toBe(true);
    expect(did).toBe(`did:extropy:${kp.publicKeyHex}`);
    expect(publicKeyHexFromDid(did)).toBe(kp.publicKeyHex);
  });

  it('builds a DID document with verification method + service endpoints', () => {
    const kp = generateIdentityKeyPair();
    const doc = buildDidDocument({
      keyPair: kp,
      services: [
        { id: '#anchor', type: 'PSLLAnchor', serviceEndpoint: 'https://example.com/anchor' },
      ],
    });
    expect(doc.id).toBe(encodeDid(kp.publicKeyHex));
    expect(doc.verificationMethod.length).toBeGreaterThanOrEqual(1);
    expect(doc.service?.length).toBe(1);
  });
});

describe('verifiable credentials', () => {
  it('issues and verifies a self-signed PersonhoodCredential', () => {
    const kp = generateIdentityKeyPair();
    const jwt = issueCredential({
      type: 'PersonhoodCredential',
      issuerKey: kp,
      evidenceDigest: 'a'.repeat(64),
    });
    const v = verifyCredential(jwt);
    expect(v.valid).toBe(true);
    expect(v.vc?.type).toEqual(['VerifiableCredential', 'PersonhoodCredential']);
    expect(v.vc?.issuer).toBe(encodeDid(kp.publicKeyHex));
  });

  it('detects tampered credential', () => {
    const kp = generateIdentityKeyPair();
    const jwt = issueCredential({ type: 'PersonhoodCredential', issuerKey: kp });
    const parts = jwt.split('.');
    // Flip a character in the payload.
    const bad = `${parts[0]}.${parts[1].slice(0, -1)}A.${parts[2]}`;
    const v = verifyCredential(bad);
    expect(v.valid).toBe(false);
  });
});

describe('zkp', () => {
  it('prove + verify happy path', () => {
    const kp = generateIdentityKeyPair();
    const nullSecret = randomSecret(32);
    const jwt = issueCredential({
      type: 'PersonhoodCredential',
      issuerKey: kp,
      subjectClaims: { region: 'TX', age: 41 },
    });
    const challenge = newChallenge();
    const contextTag = 'vote:proposal-42';
    const proof = prove({
      holderKey: kp,
      holderNullifierSecret: nullSecret,
      credentialJwt: jwt,
      request: { challenge, contextTag, revealedFields: ['region'] },
    });
    expect(proof.proofProfile).toBe(PROOF_PROFILE);
    expect(proof.holderDid).toBe(encodeDid(kp.publicKeyHex));
    expect(proof.revealed).toEqual({ region: 'TX' });
    expect(proof.revealed).not.toHaveProperty('age');

    const v = verifyProof({ proof, expectedChallenge: challenge });
    expect(v.valid).toBe(true);
    expect(v.holderDid).toBe(proof.holderDid);
    expect(v.nullifier).toBe(proof.nullifier);
  });

  it('rejects on challenge mismatch', () => {
    const kp = generateIdentityKeyPair();
    const jwt = issueCredential({ type: 'PersonhoodCredential', issuerKey: kp });
    const proof = prove({
      holderKey: kp,
      holderNullifierSecret: randomSecret(32),
      credentialJwt: jwt,
      request: { challenge: newChallenge(), contextTag: 'ctx', revealedFields: [] },
    });
    const v = verifyProof({ proof, expectedChallenge: 'a-different-challenge' });
    expect(v.valid).toBe(false);
  });

  it('per-context nullifier is deterministic across two proofs by same holder in same context', () => {
    const kp = generateIdentityKeyPair();
    const nullSecret = randomSecret(32);
    const jwt = issueCredential({ type: 'PersonhoodCredential', issuerKey: kp });
    const ctx = 'vote:proposal-42';
    const p1 = prove({
      holderKey: kp,
      holderNullifierSecret: nullSecret,
      credentialJwt: jwt,
      request: { challenge: newChallenge(), contextTag: ctx, revealedFields: [] },
    });
    const p2 = prove({
      holderKey: kp,
      holderNullifierSecret: nullSecret,
      credentialJwt: jwt,
      request: { challenge: newChallenge(), contextTag: ctx, revealedFields: [] },
    });
    expect(p1.nullifier).toBe(p2.nullifier);
  });

  it('per-context nullifier diverges across contexts (unlinkability)', () => {
    const kp = generateIdentityKeyPair();
    const nullSecret = randomSecret(32);
    const jwt = issueCredential({ type: 'PersonhoodCredential', issuerKey: kp });
    const p1 = prove({
      holderKey: kp,
      holderNullifierSecret: nullSecret,
      credentialJwt: jwt,
      request: { challenge: newChallenge(), contextTag: 'ctx-A', revealedFields: [] },
    });
    const p2 = prove({
      holderKey: kp,
      holderNullifierSecret: nullSecret,
      credentialJwt: jwt,
      request: { challenge: newChallenge(), contextTag: 'ctx-B', revealedFields: [] },
    });
    expect(p1.nullifier).not.toBe(p2.nullifier);
  });
});
