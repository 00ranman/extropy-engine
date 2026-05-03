# Substrate Decision — Native, End-to-End

**Status:** Final (v3.1)

## Decision

Extropy Engine builds a native substrate end-to-end. We do not ship as a hApp on Holochain or any other existing framework.

## Why

Digital Autarky requires owning the lowest shared layer (handshake + DAG). Dependency on another project's plumbing creates a supply-chain control point we don't control. The protocol's coordination guarantees would be only as strong as someone else's roadmap.

We are not anti-Holochain. We are pro-sovereignty. Some Holochain patterns are excellent and we adopt them — see below.

## Borrowed patterns (reimplemented natively, credit given)

| Holochain pattern | Extropy name | Purpose |
|---|---|---|
| Source chain | **Personal Signed Local Log (PSLL)** | Per-node append-only signed provenance |
| Neighborhood DHT | **Validation Neighborhoods** | Sharded validation load + task discovery |
| Zomes / DNA modules | **Rule Modules** | Composable, fractal DFAO inheritance |

Credit: the patterns are good. The implementations are ours.

## What "native" means in practice

- Custom DAG ledger (`packages/dag-substrate`) — vertex/edge primitives, causal ordering, signature requirements, replay.
- Custom event bus (Redis-backed in sandbox; planned migration to libp2p gossip for production).
- Custom validation orchestration (`packages/signalflow`, `packages/validation-neighborhoods`).
- Custom rule modules and DFAO inheritance (`packages/dfao-registry`).
- Custom identity stack (`packages/identity`, see IDENTITY.md).
- Custom PSLL (`packages/psll-sync`, see PSLL.md).

## What we will NOT do

- Build on Ethereum or any L1/L2 that imposes block timing on contribution loops
- Build on a system whose governance can be captured by token-weighted voting alone
- Build on infrastructure that requires central trust roots (CA-only PKI)
- Lock the network to any one node implementation

## Multi-implementation goal

The protocol must be specifiable to the point that a second independent implementation can run alongside the reference implementation. v3.1 is the first version that is approaching this bar. v3.2 should commit to a formal protocol document distinct from the reference implementation.

## Production-vs-sandbox honesty

The current repository is a sandbox. See [`docs/VPS_NODE.md`](../docs/VPS_NODE.md). Production substrate decisions (libp2p vs custom gossip, persistent DAG storage, formal node discovery) are tracked in [`docs/GAPS.md`](../docs/GAPS.md).
