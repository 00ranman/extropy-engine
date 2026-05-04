# Identity — Implementation Spec (v3.1 sandbox)

**Package:** `packages/identity`
**Server:** Express on `127.0.0.1:4101`
**Proof profile:** `extropy-zkp-v3.1-sandbox`
**Status:** All canonical-flow endpoints live. Storage in-memory. ZKP envelope is final shape, BBS+ body deferred.

This is the sibling to `IDENTITY.md`. The architecture story lives there. This file pins down exactly what other packages can rely on.

## Key types observable to other packages

```ts
// did.ts
type Did = `did:extropy:${string}`;        // suffix is 32-byte ed25519 pubkey hex
function encodeDid(publicKeyHex: string): Did;
function publicKeyHexFromDid(did: Did): string;
function isExtropyDid(s: string): boolean;
function buildDidDocument({ keyPair, services? }): W3CDidDocument;

// vc.ts
type CredentialType = 'PersonhoodCredential' | 'OnboardingCredential';
function issueCredential(opts): string;     // returns compact JWS (EdDSA)
function verifyCredential(jwt): VerifyResult;

// zkp.ts
const PROOF_PROFILE = 'extropy-zkp-v3.1-sandbox';
function newChallenge(bytes?): string;
function prove(opts): SelectiveProof;
function verifyProof(opts): VerifyProofResult;

// nullifier.ts
class NullifierRegistry { has, record, countForContext, listForContext, size, clear }
// record() returns the existing record on collision, null on first observation.

// escrow.ts
const DEFAULT_THRESHOLD = 7;
const DEFAULT_SHARE_COUNT = 12;
function sealRevealPackage(payload, threshold, shareCount): SealResult;
function openRevealPackage(pkg, shares): payload;
```

## DID encoding

```
did:extropy:<64-hex>
            └── 32-byte raw Ed25519 public key
```

DID document:

- `@context`: `["https://www.w3.org/ns/did/v1","https://w3id.org/security/suites/ed25519-2020/v1"]`
- `verificationMethod[0]`: `Ed25519VerificationKey2020`
- `publicKeyMultibase`: `'z' + base58btc(0xed01 ‖ raw32)`  (RFC 8410 multikey)
- `authentication[0]` and `assertionMethod[0]` both reference `#keys-1`

Raw 32-byte key extraction from Node's SPKI: skip the 12-byte fixed prefix `30 2a 30 05 06 03 2b 65 70 03 21 00`.

## VC envelope

Compact JWS, EdDSA over `header.payload`:

```jsonc
header   = { alg: "EdDSA", typ: "JWT", kid: "<issuerDid>#keys-1" }
payload  = { iss, sub, iat, nbf, exp, vc }
vc       = {
  "@context": ["https://www.w3.org/ns/credentials/v2",
               "https://w3id.org/security/suites/ed25519-2020/v1"],
  type: ["VerifiableCredential", "PersonhoodCredential" | "OnboardingCredential"],
  issuer: <issuerDid>,
  credentialSubject: { id: <subjectDid>, ...subjectClaims },
  issuanceDate, expirationDate,
  evidenceDigest?      // hex SHA-256 of on-device KYC attestation
}
```

Default validity: 1 year. Self-issued is the canonical case (issuer = subject = the participant's DID).

## Nullifier construction

```
nullifier = b64url( HMAC_SHA256( holderSecret, holderDid + '|' + contextTag ) )
```

- `holderSecret`: 32 random bytes, generated once per participant, never leaves the device. Production stores it in secure enclave; sandbox returns it base64url-encoded from `/did/generate`.
- `contextTag`: verifier-supplied label (e.g. `"vote:proposal-42"`, `"dfao:research-physics"`).
- HMAC binds to `holderDid` so two participants who somehow share a secret cannot collide in one context.

Properties: deterministic, unforgeable without the secret, unlinkable across distinct `contextTag` values.

Production note: this is an HMAC sandbox stand-in. The production swap is a Pedersen commitment in BBS+, plumbed through the same ZKP envelope so other packages do not change.

## Session and challenge flow

```
[1] POST /onboard/oauth          { provider, subjectDigest }     → 201 { sessionId, stage:'oauth-verified' }
[2] POST /onboard/kyc            { sessionId, attestationDigest } → 200 { stage:'kyc-attested' }
[3] POST /did/generate           { sessionId? , publicKeyHex? }   → 201 { did, didDocument, credentialJwt,
                                                                          privateKeyPem, nullifierSecretB64u }
[4] POST /zkp/challenge          { contextTag }                   → 201 { challenge }
[5] POST /zkp/prove              { holderKey, secret, jwt, request{ challenge, contextTag, revealedFields } }
                                                                  → 201 { proof }
[6] POST /zkp/verify             { proof, action? }               → 200 { valid, ...revealed, contextTag }
                                                                  → 409 challenge_unknown_or_consumed   (replay)
                                                                  → 409 nullifier_already_used          (double-vote)

[esc] POST /reveal/initiate           { targetDid, governanceProposalDigest, payload, threshold?, shareCount? }
                                                                  → 201 { revealId, package, shares[] }
      POST /reveal/contribute-share/:revealId { shareIndex }      → 200 { collectedShares, stage }
      POST /reveal/open/:revealId      { shares[] }               → 200 { payload } when shares ≥ threshold
```

### Onboarding stages (storage.ts)

```
oauth-pending → oauth-verified → kyc-attested → did-issued → closed
```

State transitions are guarded server-side: KYC cannot run before OAuth, DID issuance reads `kycAttestationDigest` if present and embeds it as `evidenceDigest` on the VC.

### Replay protection (the 409s)

Two distinct nonce surfaces:

1. **Challenge nonce.** `/zkp/challenge` mints a fresh nonce; `/zkp/verify` calls `consumeChallenge()` which atomically marks it consumed. Second verify with the same proof returns `409 challenge_unknown_or_consumed`. This prevents proof replay end-to-end.
2. **Per-context nullifier.** When the verifier passes an `action` label, the nullifier is recorded against `(contextTag, action)`. A second proof from the same holder for the same action collides on the nullifier and returns `409 nullifier_already_used`. This is what makes one-vote-per-DID enforceable across distinct challenges in the same context.

The flow test exercises both: replay attempt after consume → 409, second valid action under the same challenge would be impossible because the challenge is consumed first.

### Proof signing input

Detached Ed25519 signature over the canonical join:

```
PROOF_PROFILE | holderDid | credentialType | challenge | nullifier | subjectDigest | issuedAt
```

`subjectDigest` is `sha256Hex(canonicalJson(credentialSubject))`. Canonical JSON: sorted keys, no whitespace, recursive.

### Verifier's contract

```ts
verifyProof({ proof, expectedChallenge, maxAgeSeconds=300 }): VerifyProofResult
```

1. Reject unknown `proofProfile`
2. Reject challenge mismatch
3. Reject `issuedAt` older than `maxAgeSeconds` (default 5 min)
4. Resolve `holderDid` to public key via `publicKeyHexFromDid`
5. EdDSA verify the join string

The HTTP layer adds the challenge-consumed and nullifier-collision checks on top.

## Threshold reveal escrow

Pure Shamir over GF(256), byte-by-byte, with a generator-`0x03` log/exp table and reduction polynomial `0x11b` (the AES field).

Default policy: 7-of-12. Tunable per request, `threshold ≥ 2`, `shareCount ≤ 255`, `shareCount ≥ threshold`.

Wrapper:

```
key       ← randomBytes(32)
iv        ← randomBytes(12)
ciphertext = AES-256-GCM(key, iv, JSON(payload))
shares     = splitSecret(key, threshold, shareCount)
package    = { ciphertext, iv, authTag, threshold, shareCount }
```

Server returns `package + shares` from `/reveal/initiate` and **does not retain shares**. The caller distributes shares to validators (out-of-band, encrypted to validator DID keys — that wrapping is the next layer). `/reveal/open` reconstructs by Lagrange interpolation at `x=0` and AES-GCM-decrypts.

## What other packages can build on today

- **Stable surface.** DID format, JWT shape, nullifier semantics, escrow output, all 9 endpoints, all error codes (400/404/409/500) are final.
- **Stable identity primitives.** `encodeDid`, `publicKeyHexFromDid`, `isExtropyDid`, `verifyCredential`, `verifyProof`, `NullifierRegistry` are all importable.
- **Network-DID binding.** Anywhere the mesh needs "this participant" the answer is a `did:extropy:<hex>` string. Sybil clustering, validator weighting, and reputation graphs all key on this string.

## What WILL change before production

1. ZKP body swaps from Ed25519+commitment to BBS+ via `@noble/curves`. Envelope shape and routes do not change.
2. `IdentityStore` swaps in-memory for Postgres. `IdentityStore` interface does not change.
3. Server-side keypair generation in `/did/generate` is removed; clients post a `publicKeyHex` and sign locally. The server already supports this branch; the sandbox bootstrap path is the additive convenience.
4. Validator-side share wrapping (Shamir share encrypted to each validator's DID public key) lands as a thin layer above `/reveal/initiate`.

Tracked in `docs/GAPS.md` § "BBS+ implementation" and § "Postgres identity store".
