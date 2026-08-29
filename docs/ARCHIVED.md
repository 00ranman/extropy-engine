# Archived standalones

These were folded into `packages/` and archived. They are not live products. The public site (extropyengine.com) talks about this repo only. Author-asides live here, not on the website.

| Archived repo | Lives here now |
|---|---|
| 00ranman/homeflow | packages/homeflow |
| 00ranman/signalflow | packages/signalflow |
| 00ranman/levelup-academy | packages/levelup-academy |
| 00ranman/xp-net | Early wire experiment. Not the production handshake. See packages/node-handshake. |
| 00ranman/xp-dag-mesh | Early DAG experiment. packages/dag-substrate is the book. |
| 00ranman/extropy-master-control-hub | Retired. |

**v3.1 packages are skeletons.** Interface contracts are the source of truth; implementation is incremental.

## Wire, honestly

Sandbox handshake is HTTPS + Ed25519 signed JSON (`packages/node-handshake`). Production target listed in that README is libp2p + Noise. That is still a pipe. TCP/QUIC already move packets. Do not invent ExtropyTCP.

Web3 (libp2p, gossipsub, DHTs) reinvented discovery and a global shout — gossip as truth. That is not this pattern.

The overlay is the thing:

- LAN first. Next door talks node to node. No DHT for neighbors.
- Internet as exception. People who aren't next door.
- Keys on the box. did:key on first boot.
- Proof not payload. ZKP on the wire. Diary on disk.
- Looking writes a vertex. Silent fetch is a detectable act.
- Causal DAG + both edges agree. Not a lottery for a block.
