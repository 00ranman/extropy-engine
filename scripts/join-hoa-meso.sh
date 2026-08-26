#!/bin/bash
# Extropy Engine — join an HOA-shaped MESO (laptop node)
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
REPO_URL="https://github.com/00ranman/extropy-engine.git"
INSTALL_DIR="${INSTALL_DIR:-$HOME/extropy-engine}"

echo ""
echo -e "${CYAN}Extropy Engine — Neighborhood MESO${NC}"
echo ""

if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}Docker is not installed.${NC} Get Docker Desktop: https://docker.com/products/docker-desktop"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo -e "${RED}Docker is not running.${NC} Start Docker Desktop, then re-run."
  if [[ "${OSTYPE:-}" == darwin* ]]; then open -a Docker || true; fi
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo -e "${RED}git is not installed.${NC}"
  exit 1
fi
echo -e "${GREEN}  Docker ok${NC}"

if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only origin main || git -C "$INSTALL_DIR" pull origin main
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo -e "${YELLOW}  wrote .env from example — change the passwords if this box is shared${NC}"
fi

NAME="${HOA_MESO_NAME:-}"
if [ -z "$NAME" ]; then
  if [ -r /dev/tty ]; then
    printf "Neighborhood name (e.g. Sunset Oaks): "
    read -r NAME </dev/tty || true
  fi
fi
NAME="${NAME:-neighborhood}"

echo -e "${YELLOW}  starting Engine… first run builds, give it a few minutes${NC}"
docker compose up -d postgres redis
docker compose up --build -d epistemology-engine signalflow loop-ledger reputation xp-mint dag-substrate dfao-registry governance
docker compose --profile sandbox up --build -d node-handshake || docker compose --profile node-handshake up --build -d node-handshake || true

SEED_DIR="$HOME/.extropy-engine"
mkdir -p "$SEED_DIR"
SEED="$SEED_DIR/hoa-meso.json"
if command -v python3 >/dev/null 2>&1; then
  python3 - "$INSTALL_DIR/presets/hoa-meso/preset.json" "$SEED" "$NAME" <<'PY'
import json, sys
src, dest, name = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(src))
data["name"] = name
json.dump(data, open(dest, "w"), indent=2)
print(dest)
PY
else
  cp presets/hoa-meso/preset.json "$SEED"
fi

# Register MESO if the registry is up. Body is best-effort; file on disk is the source of truth.
if curl -sf http://localhost:4009/health >/dev/null 2>&1 || curl -sf http://localhost:4009/ >/dev/null 2>&1; then
  curl -sS -X POST http://localhost:4009/dfaos \
    -H 'content-type: application/json' \
    -d "{\"name\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$NAME"),\"scale\":\"MESO\",\"status\":\"SHADOW\",\"preset\":\"hoa-meso\"}" \
    >/dev/null 2>&1 || echo -e "${YELLOW}  registry did not take the POST — preset is at $SEED${NC}"
fi

echo ""
echo -e "${GREEN}  You are a node.${NC} Neighborhood: $NAME (MESO, SHADOW)"
echo "  SignalFlow     http://localhost:4002"
echo "  Loop ledger    http://localhost:4003"
echo "  XP mint        http://localhost:4005"
echo "  DFAO registry  http://localhost:4009"
echo "  Handshake      http://localhost:4200"
echo "  Preset         $SEED"
echo ""
echo "  Next laptop: same command. Same neighborhood name."
echo "  Post a job. Confirm it. XP mints on verified work."
echo "  Stop: cd $INSTALL_DIR && docker compose --profile sandbox down"
echo ""
