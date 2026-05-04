# Identity Layer — IDENTITY.md

**Package:** [`packages/identity`](../packages/identity)
**Spec parent:** [`docs/SPEC_v3.1.md`](./SPEC_v3.1.md) §8
**Status:** Skeleton; specification frozen for v3.1

## Purpose

Establish strong Sybil resistance and selective accountability without exposing raw identity material to the network.

## Design constraints (non-negotiable)

1. Easy onboarding for normal humans
2. Strong resistance to one-person-many-identity abuse
3. No raw PII exposure to the network DAG
4. Selective reveal under governance conditions
5. Compatibility with edge-native intelligence (personal AI handles identity locally)

## Canonical flow

```
1. User signs in via OAuth/OpenID (familiar credentials)
        │
        ▼
2. On-device KYC binding (ID scan / biometric / trusted issuer handoff)
        │   [happens entirely on user device — network sees nothing]
        ▼
3. Personal AI generates DID + Verifiable Credential locally
        │
        ▼
4. Credential wrapped in ZKP (BBS+ default; zk-SNARKs supported)
        │
        ▼
5. Network receives:
        - proof of uniqueness
        - proof of valid onboarding
        - per-context nullifier
        - public DID
   Network does NOT receive:
        - raw documents
        - full biometric material
        - real-world identity tied to DID
```

## Components

- **OAuth / OIDC bridge.** Familiar entry point. Issuers list governance-tunable.
- **On-device KYC module.** ID document parse + liveness + biometric bind. Runs on participant hardware. Outputs a local-only attestation.
- **DID generator.** Generates W3C DID + key material. Stored in local secure enclave or equivalent.
- **Verifiable Credential issuer.** Local. Wraps the on-device attestation into a VC.
- **ZKP wrapper.** Default scheme: BBS+ (selective disclosure friendly, smaller proofs). Alternate: zk-SNARK circuits for specific predicates (age, jurisdiction, etc.).
- **Nullifier service.** Per-context nullifier derivation so the same DID cannot be cross-correlated across DFAOs without consent.

## Threshold reveal escrow

Under governance threshold, a DID can be linked back to enforceable real-world identity. The provisional default:

- **7-of-12 ecosystem validators** must hold a valid governance proposal with cause shown
- Threshold-keyed escrow holds the reveal material (Shamir-style or threshold encryption)
- Tunable per ecosystem DFAO

This is selective privacy under enforceable accountability. Not anonymous. Not surveillance.

## What this prevents

- Sybil farms (KYC + biometric bind makes per-identity creation costly)
- Reputation laundering (DID is sticky; you cannot mint a new identity to escape a bad reputation cheaply)
- Unaccountable speech-acts (governance threshold can pierce the veil with cause)

## What this preserves

- Default privacy (network sees ZKPs, not documents)
- Per-context unlinkability (nullifiers prevent cross-DFAO correlation)
- User-side control (KYC happens on the user's device)
- Future-proofing (BBS+ today, post-quantum-friendly schemes possible later)

## Open questions

- Bootstrap problem: who issues trusted KYC attestations before there's an ecosystem?
  - Provisional answer: bootstrap through accredited issuers; transition to community-vouched models as DFAOs mature.
- Reveal-threshold tuning: 7-of-12 is provisional. Real adversarial modeling needed.
- Cross-jurisdictional KYC compatibility (especially EU AI Act, US state-level biometric laws).
- Recovery of lost DIDs without reintroducing central authority.

Tracked in [`docs/GAPS.md`](./GAPS.md).
