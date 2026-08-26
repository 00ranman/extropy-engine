# Neighborhood app

Job board + MICRO crews + DAG **on your machine**. First boot writes a W3C `did:key` (Ed25519) to `data/keys/node.pem`. No registrar. Hostinger is not the book.

Need [Node 18+](https://nodejs.org/) or Docker.

## Today — just Node

```bash
git clone https://github.com/00ranman/extropy-engine.git
cd extropy-engine/packages/neighborhood-app
node server.mjs
```

Open http://localhost:4016

The DID prints in the terminal and at the top of the board. Backup `data/keys/node.pem`. Lose it and you are a new node.

Name yourself. Post a job. Take it. Sign it closed. Vertices are signed by that key.

```bash
MESO_NAME="Sunset Oaks" node server.mjs
```

`GET /api/did` returns the public document (no private key).

## Full Engine

Docker Desktop, then:

```bash
HOA_MESO_NAME="Sunset Oaks" curl -fsSL https://raw.githubusercontent.com/00ranman/extropy-engine/main/scripts/join-hoa-meso.sh | bash
```

How-to: https://extropyengine.com/hoa
The node: https://extropyengine.com/#node
