/**
 * End-to-end HTTP test of the canonical v3.1 identity flow.
 *
 * Drives the Express app with no live socket — uses a local listener on an
 * ephemeral port. Walks:
 *
 *   1. POST /onboard/oauth          → sessionId
 *   2. POST /onboard/kyc            → kyc-attested
 *   3. POST /did/generate           → DID + VC + private key + nullifier secret
 *   4. POST /zkp/challenge          → challenge
 *   5. POST /zkp/prove              → proof
 *   6. POST /zkp/verify             → valid + nullifier registered
 *   7. POST /zkp/verify (replay)    → 409 nullifier_already_used
 *   8. POST /reveal/initiate        → shares + revealId
 *   9. POST /reveal/open/:revealId  → original payload
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';

// Ensure the app does not bind on its own.
process.env.IDENTITY_NO_LISTEN = '1';

import { app } from '../src/index.js';

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  return { status: r.status, json };
}

describe('canonical v3.1 identity flow over HTTP', () => {
  it('walks the full happy path', async () => {
    // 1. OAuth
    const oauthDigest = createHash('sha256').update('user@example.test:google').digest('hex');
    const oauth = await post('/onboard/oauth', {
      provider: 'google',
      subjectDigest: oauthDigest,
    });
    expect(oauth.status).toBe(201);
    const sessionId = oauth.json.sessionId;
    expect(sessionId).toBeTruthy();

    // 2. KYC
    const kycDigest = createHash('sha256').update('on-device-kyc-attestation-blob').digest('hex');
    const kyc = await post('/onboard/kyc', { sessionId, attestationDigest: kycDigest });
    expect(kyc.status).toBe(200);
    expect(kyc.json.stage).toBe('kyc-attested');

    // 3. DID
    const did = await post('/did/generate', { sessionId });
    expect(did.status).toBe(201);
    expect(did.json.did).toMatch(/^did:extropy:[0-9a-f]{64}$/);
    expect(did.json.credentialJwt).toBeTruthy();
    expect(did.json.privateKeyPem).toContain('PRIVATE KEY');
    expect(did.json.nullifierSecretB64u).toBeTruthy();
    const { credentialJwt, privateKeyPem, nullifierSecretB64u } = did.json;
    const publicKeyHex = did.json.did.split(':')[2];

    // 4. Challenge
    const ch = await post('/zkp/challenge', { contextTag: 'vote:proposal-42' });
    expect(ch.status).toBe(201);
    const challenge = ch.json.challenge;

    // 5. Prove
    const prove = await post('/zkp/prove', {
      privateKeyPem,
      publicKeyHex,
      nullifierSecretB64u,
      credentialJwt,
      request: {
        challenge,
        contextTag: 'vote:proposal-42',
        revealedFields: [],
      },
    });
    expect(prove.status).toBe(201);
    const proof = prove.json.proof;
    expect(proof.holderDid).toBe(did.json.did);

    // 6. Verify (with action label, registers nullifier)
    const verify = await post('/zkp/verify', { proof, action: 'vote:proposal-42' });
    expect(verify.status).toBe(200);
    expect(verify.json.valid).toBe(true);

    // 7. Replay must fail — challenge consumed.
    const replay = await post('/zkp/verify', { proof, action: 'vote:proposal-42' });
    expect(replay.status).toBe(409);

    // 8. Reveal escrow
    const reveal = await post('/reveal/initiate', {
      targetDid: did.json.did,
      governanceProposalDigest: createHash('sha256').update('proposal-1').digest('hex'),
      payload: { realIdHash: 'a'.repeat(64), contact: 'court@example.test' },
    });
    expect(reveal.status).toBe(201);
    expect(reveal.json.shares.length).toBe(12);
    expect(reveal.json.threshold).toBe(7);

    // 9. Open with 7 shares
    const opened = await post(`/reveal/open/${reveal.json.revealId}`, {
      shares: reveal.json.shares.slice(0, 7),
    });
    expect(opened.status).toBe(200);
    expect(opened.json.payload.contact).toBe('court@example.test');
  });

  it('rejects ZKP verify without a known challenge', async () => {
    const fakeProof = {
      proofProfile: 'extropy-zkp-v3.1-sandbox',
      holderDid: 'did:extropy:' + 'a'.repeat(64),
      issuedAt: new Date().toISOString(),
      challenge: randomBytes(16).toString('base64url'),
      nullifier: randomBytes(32).toString('base64url'),
      revealed: {},
      subjectDigest: 'b'.repeat(64),
      issuerDigest: 'c'.repeat(64),
      credentialType: 'PersonhoodCredential',
      signature: 'd'.repeat(86),
    };
    const r = await post('/zkp/verify', { proof: fakeProof });
    expect(r.status).toBe(409);
    expect(r.json.reason).toBe('challenge_unknown_or_consumed');
  });
});
