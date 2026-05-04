# Personal Signed Local Log — PSLL.md

**Package:** [`packages/psll-sync`](../packages/psll-sync)
**Spec parent:** [`docs/SPEC_v3.1.md`](./SPEC_v3.1.md) §9
**Status:** Skeleton; specification frozen for v3.1

## What it is

The Personal Signed Local Log is the local append-only provenance log maintained by each participant's edge intelligence. The pattern is borrowed (with credit) from Holochain's source-chain concept and reimplemented natively.

## Why it exists

Without a local signed log, edge intelligence is hand-wavy. With PSLL, the system gains provenance without surrendering sovereignty. Participants can prove their own activity history under dispute without exposing their entire local state.

## Required properties

- **Append-only.** New entries only. No edits. No deletions.
- **Hash-chained.** Each entry includes the hash of the previous entry.
- **Cryptographically signed.** Every entry signed with the participant's DID key.
- **Locally controlled.** Lives on the participant's device. The network never receives raw entries.
- **Selectively disclosable.** Inclusion proofs and ZKP-based disclosures allow targeted reveal under dispute.

## Anchoring model

The network does **not** ingest raw PSLL payloads. Instead:

```
Local PSLL entries (private, on-device)
    │
    ▼ periodic Merkle root computation
    │
    ▼ signed Merkle root commitment
    │
    ▼ anchored as DAG vertex (public, immutable)
```

Anchoring cadence: provisional default of one anchor per active session, tunable per DFAO.

## Disclosure under dispute

When the mesh needs to verify a participant's claim history (e.g., during governance review or contested validation):

1. Participant produces a Merkle inclusion proof for the relevant entry
2. Optionally wrapped in ZKP for selective disclosure (prove "I logged a claim of type X at time Y" without revealing entry content)
3. Anchor commitment in DAG verifies the inclusion proof

## Entry schema (minimum)

```ts
interface PSLLEntry {
  index: number;                    // monotonic
  prevHash: string;                 // hash of previous entry (or genesis)
  timestamp: ISO8601String;
  did: DID;                         // participant's DID
  entryType: 'claim_submitted'
           | 'validation_performed'
           | 'quest_accepted'
           | 'quest_completed'
           | 'decomposition'
           | 'governance_vote'
           | 'reputation_update'
           | 'reveal_consent'
           | 'custom';
  payload: Record<string, unknown>;  // entry-type specific
  signature: string;                 // sig over (index, prevHash, timestamp, did, entryType, payload)
}
```

## What goes in the PSLL

- Every claim submitted (with full context — what the personal AI saw, decomposition steps, decision rationale)
- Every validation performed (which slice was reviewed, how it was scored, time spent)
- Every quest accepted/completed
- Every decomposition step performed by the personal AI
- Every governance vote cast
- Every reputation update received
- Consent records for reveals or correlations

## What does NOT go in the PSLL

- Other participants' PSLL contents (each PSLL is single-author)
- Raw network-side state (the DAG is the canonical record for that)
- Personal context unrelated to Extropy activity

## Sync

PSLL is local-first. Optional sync between participant's own devices is supported via:
- E2E encrypted device-to-device sync
- Encrypted backup to participant-controlled storage (IPFS, S3, etc.)

The package `psll-sync` handles the local maintenance, anchoring, and optional device-to-device sync. It does NOT participate in network gossip.

## Open questions

- Sync conflict resolution across multiple devices (CRDT-style merge vs strict serialization)
- Long-term storage strategy (PSLL grows monotonically; pruning under what conditions?)
- Pattern for participant-controlled selective backup
- Anchoring cadence under intermittent connectivity

Tracked in [`docs/GAPS.md`](./GAPS.md).
