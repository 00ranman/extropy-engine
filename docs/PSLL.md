# Personal Signed Local Log (PSLL)

**Status:** Mandatory per node · **Borrowed pattern:** Holochain source chain (re-implemented natively)

## Purpose

Every node maintains an append-only, hash-chained, signed local event log of every personal-AI decision and action. Provenance + audit + portability — without exporting raw payloads to the network.

## Format

- **Append-only**, hash-chained per entry.
- **Signature:** Ed25519 default (governance-tunable).
- **Storage:** local-only payloads.
- **Anchoring:** only Merkle roots / receipts are anchored to the shared DAG via `psll-sync`.

## Contents

Every one of the following produces a PSLL entry:

- Personal-AI decisions (decomposition, prioritization, routing recommendations).
- Claim submissions.
- Quest acceptances and proof submissions.
- Validation votes cast.
- Identity proof issuances.
- Reputation events.

## Privacy & disclosure

- Default: local-only.
- Selective disclosure via **ZKP-of-inclusion**: a user can prove an entry exists in their PSLL without revealing surrounding entries.
- Governance disputes can compel disclosure of specific entries via the same threshold mechanism as identity reveal (see `IDENTITY.md`).

## Portability

PSLL is exportable and importable across devices under the same DID. Re-anchoring receipts on import is automatic.

## Anchoring service: `psll-sync`

- Receives Merkle roots from clients.
- Records anchor receipt vertices on the DAG.
- Verifies ZKP-of-inclusion proofs on demand.
- Cadence: provisional 1 anchor per loop close (governance-tunable).

## Open gaps

See `GAPS.md`:
- DAG Distributed Consensus #29 (PSLL-anchor receipt cadence)
- Privacy and Access Control #46 (PSLL selective-disclosure protocol)
- Performance and Scalability #56 (PSLL local-storage growth bounds)
