#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  EXTROPY ENGINE — Happy-Path Integration Test
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Exercises the complete loop lifecycle through the real HTTP API:
#
#    1. Submit a claim  →  Epistemology Engine
#    2. Open a loop     →  Loop Ledger
#    3. Register validators → Reputation Service
#    4. Create & complete tasks  → SignalFlow
#    5. Record measurements → Loop Ledger
#    6. Close the loop  →  Loop Ledger
#    7. Verify XP mint  →  XP Mint Service
#    8. Confirm the mint → XP Mint Service
#    9. Verify final supply + rep changes
#
#  Prerequisites: All services running on localhost (docker compose up)
#
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Colours ─────────────────────────────────────────────────────────────────────────

RESET="\e[0m"
GREEN="\e[32m"
RED="\e[31m"
YELLOW="\e[33m"
BLUE="\e[34m"
BOLD="\e[1m"

# ── Config ─────────────────────────────────────────────────────────────────────────

EPISTEMOLOGY="http://localhost:4001"
SIGNALFLOW="http://localhost:4002"
LOOP_LEDGER="http://localhost:4003"
REPUTATION="http://localhost:4004"
XP_MINT="http://localhost:4005"

# Test IDs
VALIDATOR_A="test-validator-$(date +%s)-a"
VALIDATOR_B="test-validator-$(date +%s)-b"

PASSED=0
FAILED=0

# ── Helpers ────────────────────────────────────────────────────────────────────────

log()     { echo -e "${BLUE}[$(date +%H:%M:%S)]${RESET} $*"; }
pass()    { PASSED=$((PASSED+1)); echo -e "${GREEN}✓${RESET} $*"; }
fail()    { FAILED=$((FAILED+1)); echo -e "${RED}✗${RESET} $*"; }
die()     { echo -e "${RED}${BOLD}FATAL: $*${RESET}"; exit 1; }

check_status() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass "$label (HTTP $actual)"
  else
    fail "$label (expected HTTP $expected, got $actual)"
  fi
}

check_field() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass "$label = \"$actual\""
  else
    fail "$label: expected \"$expected\", got \"$actual\""
  fi
}

check_nonempty() {
  local label="$1"
  local val="$2"
  if [[ -n "$val" && "$val" != "null" ]]; then
    pass "$label is non-empty (\"${val:0:40}\")"
  else
    fail "$label is empty or null"
  fi
}

check_gt() {
  local label="$1"
  local threshold="$2"
  local val="$3"
  if (( $(echo "$val > $threshold" | bc -l) )); then
    pass "$label = $val (> $threshold)"
  else
    fail "$label = $val (expected > $threshold)"
  fi
}

# ── Test Suite ──────────────────────────────────────────────────────────────────

echo -e "\n${BOLD}Extropy Engine — Happy-Path Integration Test${RESET}"
echo "Validators: $VALIDATOR_A, $VALIDATOR_B"
echo ""

# ---- Step 0: Health checks ----
log "Step 0: Verifying service health..."
for url in $EPISTEMOLOGY $SIGNALFLOW $LOOP_LEDGER $REPUTATION $XP_MINT; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url/health")
  check_status "Health $url" "200" "$status"
done

# ---- Step 1: Submit a claim ----
log "Step 1: Submitting claim to epistemology-engine..."
CLAIM_RESP=$(curl -s -w "\n%{http_code}" -X POST "$EPISTEMOLOGY/claims" \
  -H "Content-Type: application/json" \
  -d '{
    "statement": "Reducing redundant computation lowers thermodynamic entropy in the cognitive domain",
    "domain": "cognitive",
    "submitterId": "'$VALIDATOR_A'",
    "bayesianPrior": {"confidence": 0.7}
  }')

CLAIM_BODY=$(echo "$CLAIM_RESP" | head -n1)
CLAIM_STATUS=$(echo "$CLAIM_RESP" | tail -n1)
check_status "Submit claim" "201" "$CLAIM_STATUS"

CLAIM_ID=$(echo "$CLAIM_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
check_nonempty "claim.id" "$CLAIM_ID"

# ---- Step 2: Open a loop ----
log "Step 2: Opening loop in loop-ledger..."
LOOP_RESP=$(curl -s -w "\n%{http_code}" -X POST "$LOOP_LEDGER/loops" \
  -H "Content-Type: application/json" \
  -d '{
    "claimId": "'$CLAIM_ID'",
    "domain": "cognitive",
    "causalClosureSpeed": 0.0002,
    "entropyBefore": {"value": 8.5, "unit": "bits"}
  }')

LOOP_BODY=$(echo "$LOOP_RESP" | head -n1)
LOOP_STATUS=$(echo "$LOOP_RESP" | tail -n1)
check_status "Open loop" "201" "$LOOP_STATUS"

LOOP_ID=$(echo "$LOOP_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
check_nonempty "loop.id" "$LOOP_ID"

# ---- Step 3: Register validators ----
log "Step 3: Registering validators..."
for vid in "$VALIDATOR_A" "$VALIDATOR_B"; do
  REG_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$REPUTATION/reputation/register" \
    -H "Content-Type: application/json" \
    -d '{"validatorId": "'$vid'"}')
  check_status "Register validator $vid" "201" "$REG_STATUS"
done

# ---- Step 4: Create tasks ----
log "Step 4: Creating validation tasks via signalflow..."
TASK_RESP=$(curl -s -w "\n%{http_code}" -X POST "$SIGNALFLOW/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "subClaimId": "sub-1",
    "loopId": "'$LOOP_ID'",
    "assignedValidatorId": "'$VALIDATOR_A'",
    "priority": 80
  }')

TASK_BODY=$(echo "$TASK_RESP" | head -n1)
TASK_STATUS=$(echo "$TASK_RESP" | tail -n1)
check_status "Create task" "201" "$TASK_STATUS"

TASK_ID=$(echo "$TASK_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
check_nonempty "task.id" "$TASK_ID"

# Complete the task with a positive signal
COMP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SIGNALFLOW/tasks/$TASK_ID/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "validatorId": "'$VALIDATOR_A'",
    "outcome": "confirmed",
    "confidence": 0.92,
    "notes": "Entropy reduction verified empirically"
  }')
check_status "Complete task" "200" "$COMP_STATUS"

# ---- Step 5: Record measurements ----
log "Step 5: Recording entropy measurements..."
MEAS_BEFORE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$LOOP_LEDGER/loops/$LOOP_ID/measurements" \
  -H "Content-Type: application/json" \
  -d '{
    "phase": "before",
    "value": 8.5,
    "uncertainty": 0.1,
    "source": {"method": "empirical", "observer": "'$VALIDATOR_A'"}
  }')
check_status "Record 'before' measurement" "201" "$MEAS_BEFORE_STATUS"

MEAS_AFTER_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$LOOP_LEDGER/loops/$LOOP_ID/measurements" \
  -H "Content-Type: application/json" \
  -d '{
    "phase": "after",
    "value": 5.8,
    "uncertainty": 0.1,
    "source": {"method": "empirical", "observer": "'$VALIDATOR_A'"}
  }')
check_status "Record 'after' measurement" "201" "$MEAS_AFTER_STATUS"

# ---- Step 6: Close the loop ----
log "Step 6: Closing the loop..."
CLOSE_RESP=$(curl -s -w "\n%{http_code}" -X POST "$LOOP_LEDGER/loops/$LOOP_ID/close" \
  -H "Content-Type: application/json" \
  -d '{
    "validatorIds": ["'$VALIDATOR_A'", "'$VALIDATOR_B'"],
    "consensus": {"vPlus": 8, "vMinus": 1, "quorumReached": true},
    "settlementTimeSeconds": 0.001
  }')

CLOSE_BODY=$(echo "$CLOSE_RESP" | head -n1)
CLOSE_STATUS=$(echo "$CLOSE_RESP" | tail -n1)
check_status "Close loop" "200" "$CLOSE_STATUS"

CLOSED_STATUS=$(echo "$CLOSE_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
check_field "loop.status after close" "closed" "$CLOSED_STATUS"

DELTA_S=$(echo "$CLOSE_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('deltaS',0))" 2>/dev/null || echo "0")
check_gt "loop.deltaS" "0" "$DELTA_S"

# ---- Step 7: Wait for auto-mint then verify ----
log "Step 7: Waiting for auto-mint (LOOP_CLOSED event)..."
sleep 2

MINT_RESP=$(curl -s -w "\n%{http_code}" "$XP_MINT/mint/by-loop/$LOOP_ID")
MINT_BODY=$(echo "$MINT_RESP" | head -n1)
MINT_STATUS=$(echo "$MINT_RESP" | tail -n1)
check_status "Fetch mint by loop" "200" "$MINT_STATUS"

MINT_ID=$(echo "$MINT_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
check_nonempty "mint.id" "$MINT_ID"

MINT_PROV_STATUS=$(echo "$MINT_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
check_field "mint.status" "provisional" "$MINT_PROV_STATUS"

XP_VAL=$(echo "$MINT_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('xpValue',0))" 2>/dev/null || echo "0")
check_gt "mint.xpValue" "0" "$XP_VAL"

# ---- Step 8: Confirm the mint (RCV phase) ----
log "Step 8: Confirming mint (retroactive validation)..."
CONFIRM_RESP=$(curl -s -w "\n%{http_code}" -X POST "$XP_MINT/mint/$MINT_ID/confirm")
CONFIRM_STATUS=$(echo "$CONFIRM_RESP" | tail -n1)
check_status "Confirm mint" "200" "$CONFIRM_STATUS"

CONFIRMED_BODY=$(echo "$CONFIRM_RESP" | head -n1)
CONFIRMED_MINT_STATUS=$(echo "$CONFIRMED_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
check_field "mint.status after confirm" "confirmed" "$CONFIRMED_MINT_STATUS"

# ---- Step 9: Verify supply ----
log "Step 9: Verifying XP supply..."
SUPPLY_RESP=$(curl -s "$XP_MINT/supply")
TOTAL_CONFIRMED=$(echo "$SUPPLY_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('totalConfirmed',0))" 2>/dev/null || echo "0")
check_gt "supply.totalConfirmed" "0" "$TOTAL_CONFIRMED"

# Verify reputation accrual
REP_RESP=$(curl -s "$REPUTATION/reputation/$VALIDATOR_A")
XP_BALANCE=$(echo "$REP_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('xpBalance',0))" 2>/dev/null || echo "0")
check_gt "reputation.xpBalance ($VALIDATOR_A)" "0" "$XP_BALANCE"

# ── Summary ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Results: ${GREEN}${PASSED} passed${RESET}, ${RED}${FAILED} failed${RESET}"
echo ""

if [[ $FAILED -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}╔═══════════════════════════════╗${RESET}"
  echo -e "${GREEN}${BOLD}║  HAPPY PATH: ALL TESTS PASSED  ║${RESET}"
  echo -e "${GREEN}${BOLD}╚═══════════════════════════════╝${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}╔═══════════════════════════════╗${RESET}"
  echo -e "${RED}${BOLD}║  HAPPY PATH: SOME TESTS FAILED  ║${RESET}"
  echo -e "${RED}${BOLD}╚═══════════════════════════════╝${RESET}"
  exit 1
fi
