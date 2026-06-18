# @extropy/identity

DID, Verifiable Credentials, and selective-disclosure primitives for the Extropy Engine.

> **Honesty notice.** This package ships a working **sandbox** proof system today
> (selective disclosure with per-context nullifiers, hash commitments, and
> challenge nonces). It is **not** a zero-knowledge SNARK, and it is **not**
> production BBS+. The `proofProfile` field on every successful verification
> tells consumers exactly which scheme produced the proof. Today every proof
> carries `proofProfile: "extropy-zkp-v3.1-sandbox"`. When real BBS+ ships,
> the profile string changes; the wire format does not. Tracked in
> [`docs/GAPS.md`](../../docs/GAPS.md) item #43 ("ZKP scheme final selection:
> BBS+ vs zk-SNARK").

See [`docs/IDENTITY.md`](../../docs/IDENTITY.md) and
[`docs/IDENTITY_IMPL.md`](../../docs/IDENTITY_IMPL.md) for protocol details.

---

## What this package implements **today**

- **Ed25519 keypair generation, signing, verification** (`src/crypto.ts`)
- **`did:extropy` DID method** with content-hashed identifier and DID-document
  resolver (`src/did.ts`)
- **W3C Verifiable Credential issuance and verification** as compact JWT-like
  envelopes (`src/vc.ts`)
- **Selective-disclosure proof system, sandbox profile** (`src/zkp.ts`)
  - Holder commits to a credential, receives a server-issued challenge nonce,
    reveals chosen subject fields, and emits a per-context nullifier derived
    from `holderSecret + verifierContextTag`.
  - Replay-resistance via single-use challenge consumption.
  - Selective-reveal: only fields named in `revealedFields` cross the wire;
    the rest are committed by SHA-256 of canonical JSON.
- **Per-context nullifier derivation** (`src/nullifier.ts`)
- **Threshold-keyed reveal escrow primitives** (`src/escrow.ts`)
- **In-memory storage adapters** for credentials, challenges, and consumed
  nullifiers (`src/storage.ts`)
- **Express HTTP API** at `/health`, `/did`, `/vc/*`, `/zkp/challenge`,
  `/zkp/prove`, `/zkp/verify` (`src/index.ts`)

All of the above is exercised by the test suite in `test/`:
`crypto.test.ts`, `did-vc-zkp.test.ts`, `escrow.test.ts`, `http-flow.test.ts`.

---

## What this package does **not** implement yet

These were described in earlier drafts of this README as if they were already
built. They are not. Each is tracked in `docs/GAPS.md` and is on the roadmap,
not the current code path.

- **BBS+ anonymous-credential signatures.** No `src/zkp/bbs.ts`. Will arrive
  via `@noble/curves` BBS+ when that library reaches a stable release.
- **zk-SNARK circuits** (Groth16 / PLONK / Halo2). No `src/zkp/snark.ts`.
  Out of scope until circuit-authoring tooling (circom, noir) matures for
  the specific claim shapes Extropy needs.
- **OAuth / OIDC sign-in bridge.** No `src/oauth.ts`. Currently the
  `credentials` service handles auth and this package consumes its output.
- **On-device KYC orchestration.** No `src/kyc/` directory or pluggable
  provider drivers. KYC integration is design-only.
- **Range proofs / predicate proofs** (e.g. "age > 18 without revealing age").
  Requires BBS+ or SNARKs, both above.
- **Issuer-side blinded signatures.** Requires BBS+.
- **Cross-verification unlinkability without re-randomization.** Requires BBS+.
- **Persistent storage backends.** Storage is currently in-memory only;
  Postgres / Redis adapters are planned.

---

## What this package is **not**, by design

- **Not a custodian.** Identity material lives on the participant's device.
  This server-side package handles verification, issuance assistance, and
  challenge orchestration only.
- **Not a database of PII.** Selective-disclosure proofs are what cross the
  network; raw credential subjects are committed by hash, not stored
  centrally.
- **Not a sole authority.** Multiple `@extropy/identity` instances run in
  parallel; verification is local to each verifier.

---

## Module layout (current)

```
src/
  index.ts        # Express server, public HTTP API
  crypto.ts       # Ed25519 keypair + sign/verify + sha256 helpers
  did.ts          # did:extropy method, document resolution
  vc.ts           # Verifiable Credential issue + verify
  zkp.ts          # Sandbox selective-disclosure proof (NOT zk-SNARK)
  nullifier.ts    # Per-context nullifier derivation
  escrow.ts       # Threshold-keyed reveal escrow
  storage.ts      # In-memory adapters
test/
  crypto.test.ts
  did-vc-zkp.test.ts
  escrow.test.ts
  http-flow.test.ts
```

## Module layout (target, not yet implemented)

When the gaps above close, the package will reorganize roughly as:

```
src/
  index.ts
  oauth.ts                  # not yet implemented
  kyc/orchestrator.ts       # not yet implemented
  kyc/providers/            # not yet implemented
  did/generator.ts
  did/credential.ts
  zkp/bbs.ts                # not yet implemented (BBS+ wrapper)
  zkp/snark.ts              # not yet implemented (zk-SNARK circuits)
  zkp/sandbox.ts            # current zkp.ts, kept for backwards compat
  zkp/nullifier.ts
```

---

## Quick start

```bash
cd packages/identity
npm install
npm run dev              # starts the HTTP API on $PORT (default 4014)
npm test                 # runs the vitest suite
```

## Wire-level honesty

Every `/zkp/verify` response includes a `proofProfile` string. Consumers
MUST inspect this string before trusting a proof for a high-stakes action.
Current profiles:

| `proofProfile`              | Meaning                                                  |
|-----------------------------|----------------------------------------------------------|
| `extropy-zkp-v3.1-sandbox`  | Selective disclosure + nullifier. **Not** zk-SNARK.      |
| `extropy-bbs-plus-v1`       | (planned) BBS+ anonymous credential proof                 |
| `extropy-snark-v1`          | (planned) zk-SNARK proof for predicate / range claims     |

No proof issued today carries the `bbs-plus` or `snark` profile. Anything
claiming it is a forgery or a misconfigured client.
