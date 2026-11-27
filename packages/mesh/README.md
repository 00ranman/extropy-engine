# Mesh: Web3 as promised

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

## Public record

`GET /record` and `node packages/mesh/mesh.mjs record` export settled loops as envelope A only: class, entropy-reduction proxy (`delta_s`), state, hashes. Task text, evidence bytes, reasons, and actor ids stay on the local dag. They are not in `record.json`.

`ok_to_feature` defaults to false. The strip sets it true only when the open, the done, and the confirm each passed `--ok-to-feature` (or the JSON boolean `true`). One side saying yes is not enough.

A loop is exported after CONFIRM. A later BURN stays on the strip with state `BURN`. OPEN or DONE alone is left out.

Contested confirmations are not finished. There is no contest vertex, no late-burn propagation, and no standing adjustment in this package. A receipt is the happy path. Do not read it as a finished adversarial close.

## Ad-check loops

Class `ad-check` is the "every ad gets a receipt" loop. The poster opens it. A verifier marks it done. The poster confirms.

Rules this package enforces:

- The verifier (the node that marks done) cannot be the poster or anyone passed in `parties`.
- The confirm has to be the poster's signature.
- `poster_mint` on the public strip is 0. This mesh does not mint a meter for anyone else either. Null on other classes means "not minted here," not zero.

```bash
DATA=./.mesh-a node packages/mesh/mesh.mjs open \
  --class ad-check --task "check the three claims" --parties "<other-party-id>" \
  --peer http://127.0.0.1:4210
```

Pass `--ok-to-feature` on open, done, and confirm only when that person agrees to be featured. The default is no.
