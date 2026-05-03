# @extropy/psll-sync

Personal Signed Local Log — local append-only signed provenance per participant, with optional device-to-device sync and DAG anchoring.

**Status:** Skeleton. See [`docs/PSLL.md`](../../docs/PSLL.md) for spec.

## Responsibilities

- Maintain the local PSLL (append-only, hash-chained, signed)
- Compute periodic Merkle roots
- Anchor Merkle roots into the DAG (via `dag-substrate`)
- Serve inclusion proofs on request (under participant consent)
- Support optional E2E-encrypted device-to-device sync
- Expose ZKP-friendly disclosure helpers

## Non-responsibilities

- Does NOT participate in network gossip
- Does NOT receive other participants' PSLLs
- Does NOT decide what enters the log (that's the personal AI's job)

## Module layout (target)

```
src/
├── index.ts        # Express server, local API
├── log.ts          # Append-only chain, sign, verify
├── merkle.ts       # Periodic root computation
├── anchor.ts       # DAG anchoring client
├── proofs.ts       # Inclusion proofs + ZKP helpers
└── sync/           # Optional device-to-device sync
```

## Storage

Local-first. Defaults to LevelDB or SQLite. Encrypted-at-rest with key derived from the participant's DID material.
