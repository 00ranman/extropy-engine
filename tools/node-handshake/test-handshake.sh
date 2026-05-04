#!/usr/bin/env bash
#
# End-to-end sandbox test of the VPS↔local node handshake.
#
# Usage:
#   PEER_URL=https://your-vps-host:4200 ./tools/node-handshake/test-handshake.sh
#
# Defaults to a local two-process test if PEER_URL is not set.

set -euo pipefail

cd "$(dirname "$0")/../.."

PEER_URL="${PEER_URL:-http://localhost:4200}"

echo "═══════════════════════════════════════════════════════════════════════════"
echo " Extropy Engine — Node Handshake Sandbox Test"
echo "═══════════════════════════════════════════════════════════════════════════"
echo " Peer URL: $PEER_URL"
echo

echo "[1/3] Probing /health on peer..."
if ! curl -fsS "$PEER_URL/health" | tee /tmp/peer-health.json; then
  echo
  echo "  ✗ peer is not reachable — start it with:"
  echo "    NODE_ROLE=vps pnpm --filter @extropy/node-handshake start"
  exit 1
fi
echo
echo "  ✓ peer reachable"
echo

echo "[2/3] Performing /hello handshake..."
NODE_ROLE=local PEER_URL="$PEER_URL" pnpm --filter @extropy/node-handshake client:hello
echo "  ✓ handshake complete"
echo

echo "[3/3] Performing /dag/replay round-trip..."
NODE_ROLE=local PEER_URL="$PEER_URL" pnpm --filter @extropy/node-handshake client:replay
echo "  ✓ replay endpoint responsive"
echo

echo "═══════════════════════════════════════════════════════════════════════════"
echo " Sandbox test PASSED."
echo "═══════════════════════════════════════════════════════════════════════════"
