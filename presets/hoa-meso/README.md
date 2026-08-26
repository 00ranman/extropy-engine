# HOA MESO — Engine wrapper

The Extropy Engine with an HOA-shaped job list. You download Docker Desktop, paste one line, name the street. Your laptop is a node. The DAG starts when the first job is signed closed.

**How-to (what to download, what it does, what you can do today):** https://extropyengine.com/hoa

## Start

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. Terminal (Mac) or WSL / Git Bash (Windows):

```bash
curl -fsSL https://raw.githubusercontent.com/00ranman/extropy-engine/main/scripts/join-hoa-meso.sh | bash
```

Next laptop: same command, same neighborhood name.

Face after it comes up: http://localhost:4015

Stop: `cd ~/extropy-engine && docker compose --profile sandbox down`

Sandbox handshake is HTTPS, not libp2p. First run builds. The loop is the Engine as it exists in this repo.

Dues, liens, and deed architectural control stay on the recorded paper. This wrapper runs the **jobs**.
