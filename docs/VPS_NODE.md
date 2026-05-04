# VPS Node — Sandbox-Node Posture (v3.1)

**Status:** Sandbox. This is a live engineering testbed, not a production deployment.

## What this document is

A clear statement of the deployment posture for the current Extropy Engine VPS instance and the testing harness used to exercise the protocol between the VPS and a local laptop node.

## What the VPS is

The VPS hosts a sandbox instance of the Extropy Engine v3.1 architecture. It runs:

- The active core packages from `packages/` (xp-formula, loop-ledger, signalflow, dag-substrate, etc.)
- The redefined `epistemology-engine` (mesh observability layer)
- The new v3.1 skeletons (`identity`, `psll-sync`, `quest-market`, `validation-neighborhoods`)
- The **node-handshake** sandbox service (`packages/node-handshake`) on port 4200

The VPS exists to:

- Demonstrate the protocol shape end-to-end on real infrastructure
- Provide a peer for local laptop nodes to handshake with
- Surface integration failures the local-only stack hides
- Hold a long-running DAG instance for replay testing
- Run the `epistemology-engine` against multi-node mesh activity

## What the VPS is NOT

- **Not a production node.** The transport is HTTPS + body signing, not libp2p + Noise.
- **Not a reference implementation lock.** Multiple node implementations are expected.
- **Not a custodial service.** No participant identity material lives on the VPS beyond what the Identity layer's escrow design explicitly allows.
- **Not a censorship gateway.** Other nodes can run independently; the VPS holds no canonical authority.

## Local laptop node ↔ VPS handshake

The minimum viable test harness is in [`packages/node-handshake`](../packages/node-handshake). It implements:

1. `/hello` — mutual identity exchange + capability advertisement
2. `/capabilities` — package + domain + load exchange
3. `/dag/replay` — DAG segment replay between peers
4. `/heartbeat` — signed liveness pings

### Running the VPS side

On the VPS host (assumes Node 20+, pnpm, and the repo cloned):

```bash
cd extropy-engine
pnpm install
NODE_ROLE=vps PORT=4200 pnpm --filter @extropy/node-handshake start
```

If you want a stable node identity across restarts, set `NODE_PRIVATE_KEY_PEM` to a PKCS8 Ed25519 PEM. Otherwise the node generates an ephemeral key per launch.

Make sure the VPS exposes port 4200 (or your reverse-proxy port) over HTTPS. Cloudflare, Caddy, or nginx in front of the service is fine for sandbox.

### Running the local laptop side

On the laptop:

```bash
cd extropy-engine
pnpm install

# Verify VPS reachability:
curl -sS https://your-vps-host:4200/health | jq

# Run the handshake:
NODE_ROLE=local PEER_URL=https://your-vps-host:4200 \
  pnpm --filter @extropy/node-handshake client:hello

# Test DAG replay request:
NODE_ROLE=local PEER_URL=https://your-vps-host:4200 \
  pnpm --filter @extropy/node-handshake client:replay
```

You should see:
- The VPS public key (verified)
- A session ID
- Capability advertisement
- An empty replay window response (until `dag-substrate` indexing is wired in)

### What success looks like (sandbox)

- Both nodes verify each other's signatures
- Session IDs persist across multiple heartbeats
- DAG replay returns structurally valid (even if empty) envelopes
- Heartbeat endpoints update `lastHeartbeat` server-side
- `/health` on both sides reports each other's session counts

### What failure modes are valuable

- Clock skew breaking signature validation (signal that timestamps need a tolerance window)
- Reverse-proxy stripping `Content-Type` (signal that we need a mandatory client header)
- Signature mismatch across canonicalization edge cases (signal that the canonicalizer is incomplete)
- Network partition behavior under heartbeat loss (signal that the session lifecycle needs real timeouts)

These failures are the point. They are how the protocol earns its shape.

## Adversarial-deployment checklist (for when this leaves sandbox)

- [ ] Replace HTTPS+body-signing with libp2p + Noise framing
- [ ] Replace ephemeral Ed25519 keys with DID-derived material from `@extropy/identity`
- [ ] Wire `dag-substrate` index into `/dag/replay` and verify per-vertex signatures
- [ ] Add rate-limiting and per-peer scoring
- [ ] Add NAT traversal (relay or hole-punch)
- [ ] Add formal session timeout + reconnection semantics
- [ ] Move from in-memory session map to durable session store
- [ ] Wire `epistemology-engine` to observe and attest cross-node validation patterns
- [ ] Add adversarial peer testing (Byzantine peer that signs valid envelopes but lies in payload)

Tracked in [`docs/GAPS.md`](./GAPS.md) under "P2P substrate" and "Adversarial hardening."

## Honesty clause

The repository runs. The protocol shape is real. The proof-of-concept handshake exists and can be exercised today. None of that is the same as "this is production-ready."

The architecture earns its right to exist by being run, broken, observed, and patched. The sandbox node-handshake is the smallest plausible thing that exercises cryptographic identity, mutual capability exchange, DAG portability, and heartbeat-driven liveness across two real machines. If it works between the VPS and Randall's laptop, the v3.1 protocol shape is real. If it doesn't, we find out before scaling.
