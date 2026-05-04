# @extropy/identity

Hybrid identity layer for Extropy Engine v3.1: OAuth + on-device KYC + W3C DID + ZKP (BBS+ default).

**Status:** Skeleton — interfaces defined, implementation in progress.

See [`docs/IDENTITY.md`](../../docs/IDENTITY.md) for the full spec.

## What this package is responsible for

- OAuth/OIDC sign-in bridge
- On-device KYC orchestration (driver: pluggable KYC providers)
- W3C DID generation and storage hooks
- Verifiable Credential issuance (locally to the participant)
- ZKP proof generation (BBS+ default, zk-SNARK supported)
- Per-context nullifier derivation
- Threshold-keyed reveal escrow integration

## What this package is NOT

- Not a custodian. Identity material lives on the participant's device.
- Not a database. The network sees ZKPs; this package never stores raw PII.
- Not a sole authority. Multiple instances run in parallel; verification is local.

## Module layout (target)

```
src/
├── index.ts                 # Express server, public API
├── oauth.ts                 # OAuth/OIDC bridge
├── kyc/
│   ├── orchestrator.ts      # Local KYC flow coordination
│   └── providers/           # Pluggable KYC provider drivers
├── did/
│   ├── generator.ts         # DID + key material
│   └── credential.ts        # VC issuance (local)
├── zkp/
│   ├── bbs.ts               # BBS+ wrapper
│   ├── snark.ts             # zk-SNARK circuits
│   └── nullifier.ts         # Per-context nullifier derivation
└── reveal/
    └── escrow.ts            # Threshold-keyed reveal escrow
```

## API surface (target)

| Endpoint | Purpose |
|---|---|
| `POST /onboard/oauth` | Begin OAuth flow |
| `POST /onboard/kyc` | Submit on-device KYC attestation (local-only proof) |
| `POST /did/generate` | Generate DID + VC for the participant |
| `POST /zkp/prove` | Generate proof for a stated predicate |
| `POST /zkp/verify` | Verify a ZKP against expected predicate |
| `POST /nullifier/derive` | Derive per-context nullifier |
| `POST /reveal/initiate` | Begin governance reveal flow (requires threshold proposal) |

## Status against gaps

Tracked in [`docs/GAPS.md`](../../docs/GAPS.md). Open critical gaps:
- KYC bootstrap: trusted issuer transition path
- Recovery: lost-DID recovery without central authority
- Cross-jurisdictional KYC compatibility
