# Identity & Accountability Layer (v3.1)

**Status:** Mandatory · **Provisional defaults are governance-tunable**

## Goal

Sybil resistance + privacy + selective accountability, all backed by familiar onboarding.

## Onboarding flow

1. **OAuth/OpenID local sign-in** — Google, Apple, email, phone, etc. Standard providers.
2. **One-time on-device KYC binding** — government-ID scan + biometric, or trusted issuer attestation. Raw artifacts never leave the device.
3. **Personal AI generates a DID + Verifiable Credential** — wrapped in zero-knowledge proofs. BBS+ default; zk-SNARKs acceptable for advanced use. (Final scheme is governance-selected.)
4. **Network sees only the ZKP proof + per-context nullifier.** No raw PII is ever shared with the protocol or DAG.

## Properties

- **Sybil resistance:** one human → one identity, enforced by KYC binding + nullifier uniqueness.
- **Privacy:** zero raw PII on-DAG, ever. Existing OAuth login means no new credential burden.
- **Selective accountability:** governance can compel reveal under defined conditions.

## Governance reveal

Threshold-keyed escrow of the original credential.

**Provisional default:** 7-of-12 ecosystem-tier validators + cause-shown proposal.
Governance-tunable from day one. See `GOVERNANCE_DEFAULTS.md`.

## Boundary with personal AI

The personal AI holds the DID + VC and produces ZKP proofs on demand. The protocol never sees private keys, biometrics, or unhashed identity data.

## Open gaps

See `GAPS.md` → Privacy and Access Control (5 gaps, P2): ZKP scheme final selection, selective-reveal mechanics, nullifier collision proof, PSLL selective disclosure, cross-DFAO data isolation.
