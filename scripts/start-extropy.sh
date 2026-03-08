#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Extropy Engine — One-Click Starter
# ═══════════════════════════════════════════════════════════════════
#
# Drop this file on your Desktop and double-click to launch.
#
# What it does:
#   1. Checks Docker is running
#   2. Clones or pulls the latest extropy-engine repo
#   3. Starts PostgreSQL 16 + Redis 7 (infrastructure)
#   4. Starts all 5 core services (Epistemology, SignalFlow, Loop Ledger, Reputation, XP Mint)
#   5. Starts HomeFlow IoT application
#   6. Waits for health checks
#   7. Opens the dashboard in your browser
#
# Ports:
#   PostgreSQL  5432    Redis       6379
#   Epistemology 4001   SignalFlow  4002   Loop Ledger 4003
#   Reputation   4004   XP Mint    4005   HomeFlow    4015
#
# ═══════════════════════════════════════════════════════════════════

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_URL="https://github.com/00ranman/extropy-engine.git"
INSTALL_DIR="$HOME/extropy-engine"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Extropy Engine — Starting Full Stack + HomeFlow${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# ── Step 0: Check Docker ──────────────────────────────────────────
echo -e "${YELLOW}[0/7] Checking Docker...${NC}"
if ! command -v docker &> /dev/null; then
  echo -e "${RED}ERROR: Docker is not installed.${NC}"
  echo "  Install Docker Desktop from https://docker.com/products/docker-desktop"
  echo "  Then re-run this script."
  exit 1
fi

if ! docker info &> /dev/null; then
  echo -e "${RED}ERROR: Docker is not running.${NC}"
  echo "  Start Docker Desktop, wait for it to be ready, then re-run this script."
  # Try to open Docker Desktop on Mac
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "  Attempting to open Docker Desktop..."
    open -a Docker
    echo "  Waiting 30 seconds for Docker to start..."
    sleep 30
    if ! docker info &> /dev/null; then
      echo -e "${RED}Docker still not ready. Please wait for the whale icon in your menu bar, then re-run.${NC}"
      exit 1
    fi
  else
    exit 1
  fi
fi
echo -e "${GREEN}  ✓ Docker is running${NC}"

# ── Step 1: Clone or pull ─────────────────────────────────────────
echo -e "${YELLOW}[1/7] Getting latest code...${NC}"
if [ -d "$INSTALL_DIR" ]; then
  cd "$INSTALL_DIR"
  git pull origin main
  echo -e "${GREEN}  ✓ Updated existing repo${NC}"
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  echo -e "${GREEN}  ✓ Cloned fresh repo${NC}"
fi

# ── Step 2: Stop any existing containers ──────────────────────────
echo -e "${YELLOW}[2/7] Cleaning up old containers...${NC}"
docker compose -f docker-compose.yml -f packages/homeflow/docker-compose.homeflow.yaml down 2>/dev/null || true
echo -e "${GREEN}  ✓ Clean slate${NC}"

# ── Step 3: Start infrastructure ──────────────────────────────────
echo -e "${YELLOW}[3/7] Starting PostgreSQL + Redis...${NC}"
docker compose up -d postgres redis
echo "  Waiting for health checks..."
sleep 10
echo -e "${GREEN}  ✓ PostgreSQL :5432 + Redis :6379 healthy${NC}"

# ── Step 4: Start 5 core services ─────────────────────────────────
echo -e "${YELLOW}[4/7] Starting core services...${NC}"
docker compose up --build -d epistemology-engine signalflow loop-ledger reputation xp-mint
echo "  Building and starting (this may take a minute on first run)..."
sleep 15
echo -e "${GREEN}  ✓ Epistemology Engine  :4001${NC}"
echo -e "${GREEN}  ✓ SignalFlow           :4002${NC}"
echo -e "${GREEN}  ✓ Loop Ledger          :4003${NC}"
echo -e "${GREEN}  ✓ Reputation           :4004${NC}"
echo -e "${GREEN}  ✓ XP Mint              :4005${NC}"

# ── Step 5: Start HomeFlow ────────────────────────────────────────
echo -e "${YELLOW}[5/7] Starting HomeFlow IoT Application...${NC}"
docker compose -f docker-compose.yml -f packages/homeflow/docker-compose.homeflow.yaml up --build -d homeflow
sleep 10
echo -e "${GREEN}  ✓ HomeFlow             :4015${NC}"

# ── Step 6: Health check ──────────────────────────────────────────
echo -e "${YELLOW}[6/7] Running health checks...${NC}"
SERVICES=("4001:Epistemology" "4002:SignalFlow" "4003:LoopLedger" "4004:Reputation" "4005:XPMint" "4015:HomeFlow")
ALL_HEALTHY=true
for svc in "${SERVICES[@]}"; do
  PORT="${svc%%:*}"
  NAME="${svc##*:}"
  if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓ $NAME (:$PORT) — healthy${NC}"
  else
    echo -e "  ${RED}✗ $NAME (:$PORT) — not responding (may still be starting)${NC}"
    ALL_HEALTHY=false
  fi
done

# ── Step 7: Done ──────────────────────────────────────────────────
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
if [ "$ALL_HEALTHY" = true ]; then
  echo -e "${GREEN}  ALL SERVICES RUNNING${NC}"
else
  echo -e "${YELLOW}  SERVICES STARTED (some may need a few more seconds)${NC}"
fi
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}HomeFlow API:${NC}        http://localhost:4015"
echo -e "  ${CYAN}Interop Manifest:${NC}    http://localhost:4015/interop/manifest"
echo -e "  ${CYAN}Epistemology:${NC}        http://localhost:4001"
echo -e "  ${CYAN}SignalFlow:${NC}          http://localhost:4002"
echo -e "  ${CYAN}Loop Ledger:${NC}         http://localhost:4003"
echo -e "  ${CYAN}Reputation:${NC}          http://localhost:4004"
echo -e "  ${CYAN}XP Mint:${NC}             http://localhost:4005"
echo ""
echo -e "  ${YELLOW}To stop everything:${NC}"
echo "    cd $INSTALL_DIR"
echo "    docker compose -f docker-compose.yml -f packages/homeflow/docker-compose.homeflow.yaml down"
echo ""
echo -e "  ${YELLOW}To view logs:${NC}"
echo "    cd $INSTALL_DIR"
echo "    docker compose -f docker-compose.yml -f packages/homeflow/docker-compose.homeflow.yaml logs -f"
echo ""

# Open browser to HomeFlow health endpoint
if [[ "$OSTYPE" == "darwin"* ]]; then
  open "http://localhost:4015/health"
elif command -v xdg-open &> /dev/null; then
  xdg-open "http://localhost:4015/health"
fi

echo -e "${GREEN}Done! Extropy Engine is live.${NC}"
