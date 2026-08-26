# Neighborhood app

Job board + MICRO crews + DAG **on your machine**. Hostinger is not the book. Phone app is a luxury.

Need [Node 18+](https://nodejs.org/) or Docker.

## Today — just Node

```bash
git clone https://github.com/00ranman/extropy-engine.git
cd extropy-engine/packages/neighborhood-app
node server.mjs
```

Open http://localhost:4016

Name yourself. Post a job (yard's not mowed). Take it. Sign it closed. That's the book, as a JSON file in `data/board.json`. Next house on the LAN can hit the IP this process prints.

```bash
MESO_NAME="Sunset Oaks" node server.mjs
```

## Full Engine

Docker Desktop, then:

```bash
HOA_MESO_NAME="Sunset Oaks" curl -fsSL https://raw.githubusercontent.com/00ranman/extropy-engine/main/scripts/join-hoa-meso.sh | bash
```

That boots SignalFlow, loop-ledger, XP mint, DFAO registry, and this app on :4016.

How-to: https://extropyengine.com/hoa
Sunset Oaks: https://extropyengine.com/hoa/sunset-oaks
