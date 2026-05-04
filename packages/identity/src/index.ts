/**
 * ════════════════════════════════════════════════════════════════════════════════
 *  EXTROPY ENGINE — Identity Layer (v3.1)
 * ════════════════════════════════════════════════════════════════════════════════
 *
 *  Hybrid identity: OAuth + on-device KYC + W3C DID + ZKP wrapper.
 *
 *  The network never sees raw identity material. KYC happens on-device.
 *  The DID is generated locally. Network verification operates on ZKPs only.
 *
 *  See docs/IDENTITY.md for the full spec.
 *
 *  STATUS: v3.1 sandbox — all canonical-flow endpoints are live with real
 *  primitives (Ed25519 sign/verify, JWT-encoded VCs, deterministic per-context
 *  nullifiers, Shamir 7-of-12 reveal escrow). Storage is in-memory; swap
 *  IdentityStore for the Postgres implementation when production hits.
 *
 *  The proof profile is honestly labeled `extropy-zkp-v3.1-sandbox` — it is
 *  sound for the Ed25519 + commitment construction we ship today, NOT yet
 *  full BBS+ selective disclosure. See zkp.ts for the upgrade path.
 * ════════════════════════════════════════════════════════════════════════════════
 */

import express, { Request, Response, NextFunction, Express } from 'express';
import { z } from 'zod';

import {
  generateIdentityKeyPair,
  sha256Hex,
  deriveNullifier,
  randomSecret,
  b64urlDecode,
  privateKeyFromPem,
  publicKeyFromHex,
} from './crypto.js';
import {
  encodeDid,
  isExtropyDid,
  publicKeyHexFromDid,
  buildDidDocument,
} from './did.js';
import { issueCredential } from './vc.js';
import {
  prove,
  verifyProof,
  newChallenge,
  PROOF_PROFILE,
} from './zkp.js';
import {
  sealRevealPackage,
  openRevealPackage,
  DEFAULT_THRESHOLD,
  DEFAULT_SHARE_COUNT,
  Share,
} from './escrow.js';
import { IdentityStore } from './storage.js';

// ────────────────────────────────────────────────────────────────────────────
//  Service bootstrap
// ────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4101);
const SERVICE_NAME = '@extropy/identity';
const VERSION = '0.2.0';
const SPEC_VERSION = 'v3.1';
const STARTED_AT = new Date().toISOString();

const store = new IdentityStore();

const app: Express = express();
app.use(express.json({ limit: '1mb' }));

// Tiny request logger so the service is not a black box at runtime.
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.path !== '/health') {
    // eslint-disable-next-line no-console
    console.log(`[${SERVICE_NAME}] ${req.method} ${req.path}`);
  }
  next();
});

// ────────────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────────────

function badRequest(res: Response, reason: string, details?: unknown) {
  return res.status(400).json({ error: 'bad_request', reason, details });
}

function notFound(res: Response, what: string) {
  return res.status(404).json({ error: 'not_found', what });
}

function serverError(res: Response, err: unknown) {
  // eslint-disable-next-line no-console
  console.error(`[${SERVICE_NAME}] error:`, err);
  const msg = err instanceof Error ? err.message : String(err);
  return res.status(500).json({ error: 'internal_error', reason: msg });
}

function parseBody<T>(schema: z.ZodSchema<T>, req: Request, res: Response): T | null {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    badRequest(res, 'invalid_body', r.error.flatten());
    return null;
  }
  return r.data;
}

// ────────────────────────────────────────────────────────────────────────────
//  Health + introspection
// ────────────────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    service: SERVICE_NAME,
    status: 'ok',
    version: VERSION,
    spec: SPEC_VERSION,
    proofProfile: PROOF_PROFILE,
    startedAt: STARTED_AT,
    stats: store.stats(),
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  Onboarding — step 1: OAuth (provider verification, on-device)
// ────────────────────────────────────────────────────────────────────────────
//
// Spec note: the network never sees the raw OAuth subject. The participant's
// device verifies the OAuth flow and submits a digest. We treat the digest as
// opaque proof-of-account-existence and bind it to a session id.

const onboardOauthSchema = z.object({
  provider: z.string().min(1).max(64),
  /** Hex SHA-256 of the OAuth subject identifier. Computed on-device. */
  subjectDigest: z.string().regex(/^[0-9a-f]{64}$/i, 'must be 32-byte hex digest'),
});

app.post('/onboard/oauth', (req: Request, res: Response) => {
  const body = parseBody(onboardOauthSchema, req, res);
  if (!body) return;
  const session = store.createOnboardingSession({
    stage: 'oauth-verified',
    oauthProvider: body.provider,
    oauthSubjectDigest: body.subjectDigest.toLowerCase(),
  });
  res.status(201).json({
    sessionId: session.sessionId,
    stage: session.stage,
    spec: 'docs/IDENTITY.md §canonical-flow step 1',
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  Onboarding — step 2: KYC attestation (on-device)
// ────────────────────────────────────────────────────────────────────────────
//
// The participant runs KYC ON THEIR DEVICE. The network only sees a hash.

const onboardKycSchema = z.object({
  sessionId: z.string().min(1),
  /** Hex SHA-256 of the on-device KYC attestation document. */
  attestationDigest: z.string().regex(/^[0-9a-f]{64}$/i, 'must be 32-byte hex digest'),
});

app.post('/onboard/kyc', (req: Request, res: Response) => {
  const body = parseBody(onboardKycSchema, req, res);
  if (!body) return;
  const existing = store.getOnboardingSession(body.sessionId);
  if (!existing) return notFound(res, 'session');
  if (existing.stage !== 'oauth-verified') {
    return badRequest(res, 'wrong_stage', { stage: existing.stage, expected: 'oauth-verified' });
  }
  const updated = store.updateOnboardingSession(body.sessionId, {
    stage: 'kyc-attested',
    kycAttestationDigest: body.attestationDigest.toLowerCase(),
  });
  res.json({
    sessionId: updated!.sessionId,
    stage: updated!.stage,
    spec: 'docs/IDENTITY.md §canonical-flow step 2',
  });
});

// ────────────────────────────────────────────────────────────────────────────
//  Onboarding — step 3: DID generation + self-issued PersonhoodCredential
// ────────────────────────────────────────────────────────────────────────────
//
// Per docs/architecture/AUTARKY.md the credential is self-issued from the
// on-device KYC attestation. The keypair is GENERATED ON THE SERVER ONLY for
// the sandbox flow — production clients generate locally and POST the public
// key. This endpoint returns the private key in PKCS8 PEM so a client can
// drive the v3.1 happy-path with one HTTP call. Do NOT use this endpoint as
// a real key custody surface.

const didGenerateSchema = z.object({
  sessionId: z.string().min(1).optional(),
  /** Optional: client-provided 32-byte hex public key. If omitted, server generates a fresh keypair. */
  publicKeyHex: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  /** Optional service endpoints to advertise in the DID document. */
  services: z
    .array(
      z.object({
        id: z.string().min(1),
        type: z.string().min(1),
        serviceEndpoint: z.string().url(),
      }),
    )
    .optional(),
});

app.post('/did/generate', (req: Request, res: Response) => {
  const body = parseBody(didGenerateSchema, req, res);
  if (!body) return;

  let publicKeyHex: string;
  let credentialJwt: string | undefined;
  let exportedPrivateKeyPem: string | undefined;
  let nullifierSecretB64u: string | undefined;

  try {
    let keyPair: ReturnType<typeof generateIdentityKeyPair>;
    if (body.publicKeyHex) {
      // Client-supplied public key: we cannot self-issue a VC because we don't
      // have their private key. The client signs locally. We synthesize a
      // partial keypair containing only the public side for did-doc emission.
      publicKeyHex = body.publicKeyHex.toLowerCase();
      const publicKey = publicKeyFromHex(publicKeyHex);
      keyPair = {
        privateKey: undefined as unknown as ReturnType<typeof generateIdentityKeyPair>['privateKey'],
        publicKey,
        publicKeyHex,
        publicKeyB64u: Buffer.from(publicKeyHex, 'hex').toString('base64url'),
      };
    } else {
      keyPair = generateIdentityKeyPair();
      publicKeyHex = keyPair.publicKeyHex;
      const session = body.sessionId ? store.getOnboardingSession(body.sessionId) : undefined;
      const evidenceDigest = session?.kycAttestationDigest;
      credentialJwt = issueCredential({
        type: 'PersonhoodCredential',
        issuerKey: keyPair,
        subjectClaims: {
          onboardingSession: session?.sessionId,
          oauthProvider: session?.oauthProvider,
        },
        evidenceDigest,
      });
      exportedPrivateKeyPem = keyPair.privateKey
        .export({ format: 'pem', type: 'pkcs8' })
        .toString();
      nullifierSecretB64u = randomSecret(32).toString('base64url');
    }

    const did = encodeDid(publicKeyHex);
    const doc = buildDidDocument({
      keyPair,
      services: body.services,
    });

    if (body.sessionId) {
      store.updateOnboardingSession(body.sessionId, { stage: 'did-issued', did });
    }

    res.status(201).json({
      did,
      didDocument: doc,
      credentialJwt,
      privateKeyPem: exportedPrivateKeyPem,
      nullifierSecretB64u,
      spec: 'docs/IDENTITY.md §canonical-flow step 3',
      warning: exportedPrivateKeyPem
        ? 'Private key returned for sandbox bootstrap only. Client-side key generation is the production path.'
        : undefined,
    });
  } catch (err) {
    serverError(res, err);
  }
});

// ────────────────────────────────────────────────────────────────────────────
//  ZKP — challenge issuance, prove, verify
// ────────────────────────────────────────────────────────────────────────────

const zkpChallengeSchema = z.object({
  contextTag: z.string().min(1).max(256),
});

app.post('/zkp/challenge', (req: Request, res: Response) => {
  const body = parseBody(zkpChallengeSchema, req, res);
  if (!body) return;
  const challenge = newChallenge();
  store.recordChallenge(challenge, body.contextTag);
  res.status(201).json({ challenge, contextTag: body.contextTag });
});

const zkpProveSchema = z.object({
  /** Holder's PKCS8 PEM private key (sandbox only). */
  privateKeyPem: z.string().min(1),
  /** Holder's 32-byte hex public key. */
  publicKeyHex: z.string().regex(/^[0-9a-f]{64}$/i),
  /** Base64url-encoded nullifier secret (32 bytes). */
  nullifierSecretB64u: z.string().min(1),
  credentialJwt: z.string().min(1),
  request: z.object({
    challenge: z.string().min(1),
    contextTag: z.string().min(1),
    revealedFields: z.array(z.string()),
  }),
});

app.post('/zkp/prove', (req: Request, res: Response) => {
  const body = parseBody(zkpProveSchema, req, res);
  if (!body) return;

  try {
    // Reconstruct an IdentityKeyPair from the PEM + public hex.
    const privateKey = privateKeyFromPem(body.privateKeyPem);
    const publicKey = publicKeyFromHex(body.publicKeyHex);
    const holderKey = {
      privateKey,
      publicKey,
      publicKeyHex: body.publicKeyHex.toLowerCase(),
      publicKeyB64u: Buffer.from(body.publicKeyHex, 'hex').toString('base64url'),
    };
    const nullifierSecret = b64urlDecode(body.nullifierSecretB64u);
    const proof = prove({
      holderKey,
      holderNullifierSecret: nullifierSecret,
      credentialJwt: body.credentialJwt,
      request: body.request,
    });
    res.status(201).json({ proof });
  } catch (err) {
    serverError(res, err);
  }
});

const zkpVerifySchema = z.object({
  proof: z.object({
    proofProfile: z.literal(PROOF_PROFILE),
    holderDid: z.string().min(1),
    issuedAt: z.string().min(1),
    challenge: z.string().min(1),
    nullifier: z.string().min(1),
    revealed: z.record(z.unknown()),
    subjectDigest: z.string().min(1),
    issuerDigest: z.string().min(1),
    credentialType: z.string().min(1),
    signature: z.string().min(1),
  }),
  /** Optional action label. If supplied, the registry binds the nullifier to it for double-spend detection. */
  action: z.string().min(1).optional(),
  /** Optional max age override (seconds). */
  maxAgeSeconds: z.number().int().positive().optional(),
});

app.post('/zkp/verify', (req: Request, res: Response) => {
  const body = parseBody(zkpVerifySchema, req, res);
  if (!body) return;
  try {
    const proof = body.proof;
    // Look up the challenge we issued (consume on first verify).
    const challengeRec = store.consumeChallenge(proof.challenge);
    if (!challengeRec) {
      return res.status(409).json({ valid: false, reason: 'challenge_unknown_or_consumed' });
    }
    const result = verifyProof({
      proof,
      expectedChallenge: proof.challenge,
      maxAgeSeconds: body.maxAgeSeconds,
    });
    if (!result.valid) {
      return res.status(400).json({ valid: false, reason: result.reason });
    }

    // Per-context nullifier double-use detection.
    if (body.action) {
      const collision = store.nullifiers.record({
        nullifier: proof.nullifier,
        contextTag: challengeRec.contextTag,
        action: body.action,
        observedAt: new Date().toISOString(),
        holderDid: proof.holderDid,
      });
      if (collision) {
        return res.status(409).json({
          valid: false,
          reason: 'nullifier_already_used',
          firstObservedAt: collision.observedAt,
          firstAction: collision.action,
        });
      }
    }

    res.json({
      valid: true,
      proofProfile: result.proofProfile,
      holderDid: result.holderDid,
      nullifier: result.nullifier,
      revealed: result.revealed,
      issuerDigest: proof.issuerDigest,
      credentialType: proof.credentialType,
      contextTag: challengeRec.contextTag,
    });
  } catch (err) {
    serverError(res, err);
  }
});

// ────────────────────────────────────────────────────────────────────────────
//  Nullifier derivation (client convenience; canonical impl lives on-device)
// ────────────────────────────────────────────────────────────────────────────

const nullifierDeriveSchema = z.object({
  /** Base64url-encoded 32-byte holder secret. */
  secretB64u: z.string().min(1),
  contextTag: z.string().min(1),
});

app.post('/nullifier/derive', (req: Request, res: Response) => {
  const body = parseBody(nullifierDeriveSchema, req, res);
  if (!body) return;
  try {
    const secret = b64urlDecode(body.secretB64u);
    const nullifier = deriveNullifier(secret, body.contextTag);
    res.json({ nullifier, contextTag: body.contextTag });
  } catch (err) {
    serverError(res, err);
  }
});

// ────────────────────────────────────────────────────────────────────────────
//  Reveal escrow — initiate, contribute share, open
// ────────────────────────────────────────────────────────────────────────────

const revealInitiateSchema = z.object({
  /** DID being escrowed. Must be a did:extropy. */
  targetDid: z.string().refine(isExtropyDid, 'must be a did:extropy'),
  /** Hex SHA-256 of the governance proposal authorizing this escrow. */
  governanceProposalDigest: z.string().regex(/^[0-9a-f]{64}$/i),
  /** Reveal payload. The participant chooses what to escrow. */
  payload: z.record(z.unknown()),
  threshold: z.number().int().min(2).max(255).optional(),
  shareCount: z.number().int().min(2).max(255).optional(),
});

app.post('/reveal/initiate', (req: Request, res: Response) => {
  const body = parseBody(revealInitiateSchema, req, res);
  if (!body) return;
  try {
    const threshold = body.threshold ?? DEFAULT_THRESHOLD;
    const shareCount = body.shareCount ?? DEFAULT_SHARE_COUNT;
    if (shareCount < threshold) {
      return badRequest(res, 'share_count_below_threshold', { threshold, shareCount });
    }
    const sealed = sealRevealPackage(body.payload, threshold, shareCount);
    const reveal = store.recordRevealRequest({
      targetDid: body.targetDid,
      governanceProposalDigest: body.governanceProposalDigest.toLowerCase(),
      package: sealed.package,
      threshold,
      shareCount,
    });
    // Shares returned to the caller for distribution to validators. The
    // server does NOT retain them — that is the whole point.
    res.status(201).json({
      revealId: reveal.revealId,
      package: sealed.package,
      shares: sealed.shares.map((s) => ({
        index: s.index,
        dataB64: s.data.toString('base64'),
      })),
      threshold,
      shareCount,
      stage: reveal.stage,
      spec: 'docs/IDENTITY.md §threshold-reveal-escrow',
    });
  } catch (err) {
    serverError(res, err);
  }
});

const revealContributeSchema = z.object({
  /** Caller-provided share for accounting only. We don't store it. */
  shareIndex: z.number().int().min(1).max(255),
});

app.post('/reveal/contribute-share/:revealId', (req: Request, res: Response) => {
  const body = parseBody(revealContributeSchema, req, res);
  if (!body) return;
  const reveal = store.getRevealRequest(req.params.revealId);
  if (!reveal) return notFound(res, 'reveal');
  if (reveal.stage !== 'pending-shares') {
    return badRequest(res, 'wrong_stage', { stage: reveal.stage, expected: 'pending-shares' });
  }
  const updated = store.incrementRevealShares(req.params.revealId)!;
  res.json({
    revealId: updated.revealId,
    collectedShares: updated.collectedShares,
    threshold: updated.threshold,
    stage: updated.stage,
  });
});

const revealOpenSchema = z.object({
  /** Validator-supplied shares — base64-encoded, with their indexes. */
  shares: z
    .array(
      z.object({
        index: z.number().int().min(1).max(255),
        dataB64: z.string().min(1),
      }),
    )
    .min(2),
});

app.post('/reveal/open/:revealId', (req: Request, res: Response) => {
  const body = parseBody(revealOpenSchema, req, res);
  if (!body) return;
  const reveal = store.getRevealRequest(req.params.revealId);
  if (!reveal) return notFound(res, 'reveal');
  if (body.shares.length < reveal.threshold) {
    return badRequest(res, 'insufficient_shares', {
      threshold: reveal.threshold,
      provided: body.shares.length,
    });
  }
  try {
    const shares: Share[] = body.shares.map((s) => ({
      index: s.index,
      data: Buffer.from(s.dataB64, 'base64'),
    }));
    const payload = openRevealPackage(reveal.package, shares);
    store.setRevealStage(req.params.revealId, 'opened');
    res.json({
      revealId: reveal.revealId,
      targetDid: reveal.targetDid,
      governanceProposalDigest: reveal.governanceProposalDigest,
      payload,
      openedAt: new Date().toISOString(),
    });
  } catch (err) {
    store.setRevealStage(req.params.revealId, 'rejected');
    serverError(res, err);
  }
});

// ────────────────────────────────────────────────────────────────────────────
//  DID document resolver — pure function over the DID, useful for clients
// ────────────────────────────────────────────────────────────────────────────

app.get('/did/:did/document', (req: Request, res: Response) => {
  try {
    const did = req.params.did;
    if (!isExtropyDid(did)) return badRequest(res, 'not_extropy_did');
    const publicKeyHex = publicKeyHexFromDid(did);
    const publicKey = publicKeyFromHex(publicKeyHex);
    const keyPair = {
      privateKey: undefined as unknown as ReturnType<typeof generateIdentityKeyPair>['privateKey'],
      publicKey,
      publicKeyHex,
      publicKeyB64u: Buffer.from(publicKeyHex, 'hex').toString('base64url'),
    };
    const doc = buildDidDocument({ keyPair });
    res.json(doc);
  } catch (err) {
    serverError(res, err);
  }
});

// ────────────────────────────────────────────────────────────────────────────
//  Fall-through
// ────────────────────────────────────────────────────────────────────────────

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// ────────────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test' && !process.env.IDENTITY_NO_LISTEN) {
  app.listen(PORT, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(
      `[${SERVICE_NAME}] listening on 127.0.0.1:${PORT} ` +
        `(v${VERSION}, spec ${SPEC_VERSION}, profile ${PROOF_PROFILE})`,
    );
  });
}

export { app, store, sha256Hex };
export default app;
