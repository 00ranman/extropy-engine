# HOA MESO — Engine wrapper

This is the Extropy Engine. The HOA is a skin: the jobs an association already does, posted as LocalFlow, confirmed, XP minted.

Site: https://extropyengine.com/hoa

## Become a node

Install Docker Desktop once. Then:

```bash
curl -fsSL https://raw.githubusercontent.com/00ranman/extropy-engine/main/scripts/join-hoa-meso.sh | bash
```

Windows: Docker Desktop + WSL or Git Bash, same line.

What it does: clones this repo into `~/extropy-engine` if needed, starts the Engine (SignalFlow, loop ledger, XP mint, DFAO registry, node handshake), loads this preset, asks the neighborhood name, registers a MESO DFAO in SHADOW.

First run builds images. Later runs just start. Sandbox handshake is HTTPS, not libp2p. The loop is real. A boxed plug-and-play kit is later — this is the same stack.

Stop:

```bash
cd ~/extropy-engine && docker compose --profile sandbox down
```

## What this is not

Not a dissolution filing. Dues, liens, and deed architectural control stay on the recorded paper until that paper changes. The wrapper runs the *jobs*.
