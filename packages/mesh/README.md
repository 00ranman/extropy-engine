# Mesh — Web3 as promised

Two boxes. A signed loop. The other edge countersigns. A later vertex can burn it. No bag. No gas. No chain.

Web3 failed because it put a farmable number under the meter and charged you to speak. This is the thing it advertised.

## Clone and run two nodes today

Node 20+. From the repo root:

```bash
# box A
DATA=./.mesh-a PORT=4210 HOST=0.0.0.0 PEER=http://OTHER:4211 node packages/mesh/mesh.mjs serve

# box B
DATA=./.mesh-b PORT=4211 HOST=0.0.0.0 PEER=http://OTHER:4210 node packages/mesh/mesh.mjs serve
```

Same machine, two terminals, `OTHER=127.0.0.1`.

```bash
# A posts a job
DATA=./.mesh-a node packages/mesh/mesh.mjs open --task "mow the lawn" --peer http://127.0.0.1:4210

# B did it
DATA=./.mesh-b node packages/mesh/mesh.mjs done --id <loopId> --peer http://127.0.0.1:4211

# A, the other edge, confirms
DATA=./.mesh-a node packages/mesh/mesh.mjs confirm --id <loopId> --peer http://127.0.0.1:4210

# later, evidence was crap
DATA=./.mesh-a node packages/mesh/mesh.mjs burn --id <loopId> --why "photo was crap" --peer http://127.0.0.1:4210
```

`GET /health` and `GET /dag` on either box.

Self-check: `node packages/mesh/demo.mjs`

## What a tx is

Not a nonce in a mempool. A signed vertex: actor, loop id, parent hashes, evidence pointer, state `OPEN | DONE | CONFIRM | BURN`. The other edge countersigns. That pair is settlement. No gas. Cost is holding the claim while a later vertex can still burn it.

Discovery is ugly: you type the other box’s URL. QR / file / LAN later. Repo does not freeze a public peer list as the mesh.

## What this is not

Not Ethereum. Not an ERC-20. Not a wallet you withdraw. Cash still rings. Standing still does not cash out. This package is the wire for the loop. Meters live in the rest of `extropy-engine`.
