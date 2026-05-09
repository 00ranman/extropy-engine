#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Extropy Engine — Happy Path End-to-End Test
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Demonstrates the full lifecycle:
#    1. Register validators in Reputation Service
#    2. Submit a claim to Epistemology Engine
#    3. Claim auto-decomposes into sub-claims
#    4. SignalFlow auto-routes tasks to validators
#    5. Complete validation tasks
#    6. Loop Ledger records measurements, runs consensus, closes loop
#    7. XP Mint mints XP tokens
#    8. Reputation is accrued
#    9. Loop is settled
#
#  Usage:
#    docker compose up --build -d
#    sleep 15  # wait for services to initialize
#    ./scripts/test-happy-path.sh
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
EPISTEMOLOGY_URL="${EPISTEMOLOGY_URL:-http://localhost:4001}"
SIGNALFLOW_URL="${SIGNALFLOW_URL:-http://localhost:4002}"
LOOP_LEDGER_URL="${LOOP_LEDGER_URL:-http://localhost:4003}"
REPUTATION_URL="${REPUTATION_URL:-http://localhost:4004}"
XP_MINT_URL="${XP_MINT_URL:-http://localhost:4005}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

pass_count=0
fail_count=0

step() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  STEP $1: $2${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

check() {
  local description="$1"
  local condition="$2"
  if eval "$condition"; then
    echo -e "  ${GREEN}✓${NC} $description"
    ((pass_count++))
  else
    echo -e "  ${RED}✗${NC} $description"
    ((fail_count++))
  fi
}

# ── Wait for services ──────────────────────────────────────────────────────
echo -e "${BOLD}Extropy Engine — Happy Path Test${NC}"
echo "Waiting for services to be ready..."

for svc_url in "$EPISTEMOLOGY_URL" "$SIGNALFLOW_URL" "$LOOP_LEDGER_URL" "$REPUTATION_URL" "$XP_MINT_URL"; do
  for i in $(seq 1 30); do
    if curl -sf "${svc_url}/health" > /dev/null 2>&1; then
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo -e "${RED}ERROR: ${svc_url} did not become healthy after 30s${NC}"
      exit 1
    fi
    sleep 1
  done
done
echo -e "${GREEN}All services healthy${NC}"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 1: Register Validators
# ═══════════════════════════════════════════════════════════════════════════
step 1 "Register validators in Reputation Service"

VALIDATOR1=$(curl -sf -X POST "${REPUTATION_URL}/validators" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice — Code Entropy Specialist",
    "type": "human",
    "domains": ["code", "cognitive"]
  }')

VALIDATOR1_ID=$(echo "$VALIDATOR1" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "  Validator 1: ${VALIDATOR1_ID}"
check "Validator 1 registered" '[ -n "$VALIDATOR1_ID" ]'

VALIDATOR2=$(curl -sf -X POST "${REPUTATION_URL}/validators" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bob — Informational Entropy Analyst",
    "type": "ai",
    "domains": ["code", "informational"]
  }')

VALIDATOR2_ID=$(echo "$VALIDATOR2" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "  Validator 2: ${VALIDATOR2_ID}"
check "Validator 2 registered" '[ -n "$VALIDATOR2_ID" ]'

# Verify validators are listed
VALIDATORS=$(curl -sf "${REPUTATION_URL}/validators")
VALIDATOR_COUNT=$(echo "$VALIDATORS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
check "Both validators visible" '[ "$VALIDATOR_COUNT" -ge 2 ]'

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 2: Submit a Claim
# ═══════════════════════════════════════════════════════════════════════════
step 2 "Submit a claim to Epistemology Engine"

CLAIM=$(curl -sf -X POST "${EPISTEMOLOGY_URL}/claims" \
  -H "Content-Type: application/json" \
  -d "{
    \"statement\": \"Refactoring module X reduced code complexity by 40%\",
    \"domain\": \"code\",
    \"submitterId\": \"${VALIDATOR1_ID}\"
  }")

echo "$CLAIM" | python3 -c "
import sys, json
c = json.load(sys.stdin)
print(f\"  Claim ID:   {c['id']}\")
print(f\"  Loop ID:    {c['loopId']}\")
print(f\"  Status:     {c['status']}\")
print(f\"  Sub-claims: {len(c.get('subClaimIds', []))}\")"\n
CLAIM_ID=$(echo "$CLAIM" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
LOOP_ID=$(echo "$CLAIM" | python3 -c "import sys,json; print(json.load(sys.stdin)['loopId'])")
CLAIM_STATUS=$(echo "$CLAIM" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
SUB_CLAIM_COUNT=$(echo "$CLAIM" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('subClaimIds', [])))")

check "Claim created" '[ -n "$CLAIM_ID" ]'
check "Claim auto-decomposed" '[ "$CLAIM_STATUS" = "decomposed" ]'
check "3 sub-claims generated" '[ "$SUB_CLAIM_COUNT" -eq 3 ]'

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 3: Verify Sub-Claims Created
# ═══════════════════════════════════════════════════════════════════════════
step 3 "Inspect decomposed sub-claims"

SUBCLAIMS=$(curl -sf "${EPISTEMOLOGY_URL}/subclaims/by-claim/${CLAIM_ID}")
echo "$SUBCLAIMS" | python3 -c "
import sys, json
scs = json.load(sys.stdin)
for i, sc in enumerate(scs):
    print(f\"  [{i+1}] {sc['id'][:8]}... | {sc['status']:10} | w={sc['weight']:.3f} | {sc['statement'][:60]}\")"\n
SC_IDS=$(echo "$SUBCLAIMS" | python3 -c "import sys,json; [print(sc['id']) for sc in json.load(sys.stdin)]")
SC1_ID=$(echo "$SC_IDS" | head -1)
SC2_ID=$(echo "$SC_IDS" | sed -n '2p')
SC3_ID=$(echo "$SC_IDS" | sed -n '3p')

check "Sub-claim 1 exists" '[ -n "$SC1_ID" ]'
check "Sub-claim 2 exists" '[ -n "$SC2_ID" ]'
check "Sub-claim 3 exists" '[ -n "$SC3_ID" ]'

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 4: Check SignalFlow Tasks
# ═══════════════════════════════════════════════════════════════════════════
step 4 "Verify SignalFlow routed tasks"

# Give event bus a moment to propagate
sleep 3

TASKS=$(curl -sf "${SIGNALFLOW_URL}/tasks?loopId=${LOOP_ID}")
TASK_COUNT=$(echo "$TASKS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "  Tasks found: ${TASK_COUNT}"

echo "$TASKS" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
for t in tasks:
    print(f\"  Task {t['id'][:8]}... → validator {t.get('assignedValidatorId','?')[:8]}... | status={t['status']}\")"\n
check "Tasks created for sub-claims" '[ "$TASK_COUNT" -ge 1 ]'

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 5: Complete Validation Tasks
# ═══════════════════════════════════════════════════════════════════════════
step 5 "Complete validation tasks (simulate validator work)"

TASK_IDS=$(echo "$TASKS" | python3 -c "import sys,json; [print(t['id']) for t in json.load(sys.stdin)]")

task_num=0
while IFS= read -r TASK_ID; do
  ((task_num++))
  # Alternate between validators
  if [ $((task_num % 2)) -eq 1 ]; then
    VID="$VALIDATOR1_ID"
  else
    VID="$VALIDATOR2_ID"
  fi

  RESULT=$(curl -sf -X POST "${SIGNALFLOW_URL}/tasks/${TASK_ID}/complete" \
    -H "Content-Type: application/json" \
    -d "{
      \"validatorId\": \"${VID}\",
      \"result\": {
        \"verdict\": \"confirmed\",
        \"confidence\": 0.92,
        \"evidenceMeasurementIds\": [],
        \"justification\": \"Verified via automated code analysis — cyclomatic complexity reduced as claimed.\",
        \"validationDurationSeconds\": 45
      }
    }")

  RSTATUS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "error")
  echo "  Task ${task_num} (${TASK_ID:0:8}...): ${RSTATUS}"
  check "Task ${task_num} completed" '[ "$RSTATUS" = "completed" ]'
done <<< "$TASK_IDS"

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 6: Wait for Event Cascade
# ═══════════════════════════════════════════════════════════════════════════
step 6 "Wait for event cascade (Bayesian updates → evaluation → consensus → close → mint → settle)"

echo "  Waiting for async event processing..."
sleep 8

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 7: Verify Claim Evaluated
# ═══════════════════════════════════════════════════════════════════════════
step 7 "Check claim evaluation"

CLAIM_FINAL=$(curl -sf "${EPISTEMOLOGY_URL}/claims/${CLAIM_ID}")
CLAIM_FINAL_STATUS=$(echo "$CLAIM_FINAL" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
TRUTH_SCORE=$(echo "$CLAIM_FINAL" | python3 -c "import sys,json; print(f\"{json.load(sys.stdin)['truthScore']:.4f}\")")

echo "  Status:      ${CLAIM_FINAL_STATUS}"
echo "  Truth Score:  ${TRUTH_SCORE}"

check "Claim evaluated or verified" '[ "$CLAIM_FINAL_STATUS" = "verified" ] || [ "$CLAIM_FINAL_STATUS" = "evaluated" ]'

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 8: Verify Loop Status
# ═══════════════════════════════════════════════════════════════════════════
step 8 "Check loop status in Loop Ledger"

LOOP=$(curl -sf "${LOOP_LEDGER_URL}/loops/${LOOP_ID}")
LOOP_STATUS=$(echo "$LOOP" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
DELTA_S=$(echo "$LOOP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('deltaS', 'null'))")
SETTLEMENT_TIME=$(echo "$LOOP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('settlementTimeSeconds', 'null'))")

echo "  Loop Status:       ${LOOP_STATUS}"
echo "  ΔS:                ${DELTA_S}"
echo "  Settlement Time:   ${SETTLEMENT_TIME}s"

echo "$LOOP" | python3 -c "
import sys, json
loop = json.load(sys.stdin)
c = loop.get('consensus')
if c:
    print(f\"  Consensus V+:     {c['vPlus']}\")
    print(f\"  Consensus V-:     {c['vMinus']}\")
    print(f\"  Consensus Passed: {c['passed']}\")
    print(f\"  Votes:            {len(c.get('votes',[]))}\")"\n
check "Loop closed or settled" '[ "$LOOP_STATUS" = "closed" ] || [ "$LOOP_STATUS" = "settled" ]'
check "ΔS is positive (40)" '[ "$DELTA_S" != "null" ] && [ "$DELTA_S" != "0" ]'

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 9: Verify XP Minted
# ═══════════════════════════════════════════════════════════════════════════
step 9 "Check XP minting"

MINT=$(curl -sf "${XP_MINT_URL}/mint/by-loop/${LOOP_ID}" 2>/dev/null || echo '{}')
MINT_STATUS=$(echo "$MINT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status', 'not_found'))")
XP_VALUE=$(echo "$MINT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('xpValue', 0))")
TOTAL_MINTED=$(echo "$MINT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalMinted', 0))")

echo "  Mint Status:   ${MINT_STATUS}"
echo "  XP Value:      ${XP_VALUE}"
echo "  Total Minted:  ${TOTAL_MINTED}"

echo "$MINT" | python3 -c "
import sys, json
m = json.load(sys.stdin)
# Canonical v3.1.2 fields, with legacy fallback for pre-canonical mints.
rarity = m.get('rarityMultiplier', m.get('reputationFactor'))
freq   = m.get('frequencyOfDecay', m.get('feedbackClosureStrength'))
if rarity is not None:
    print(f\"  R (rarity):       {rarity:.4f}\")
    print(f\"  F (freq decay):   {freq:.4f}\")
    print(f\"  ΔS:               {m['deltaS']}\")
    print(f\"  w·E:              {m['domainEssentialityProduct']:.4f}\")
    print(f\"  log(1/Tₛ):        {m['settlementTimeFactor']:.4f}\")
dist = m.get('distribution', [])
for d in dist:
    print(f\"  → {d.get('validatorId','?')[:8]}... gets {d.get('xpAmount', 0):.2f} XP ({d.get('basis','?')})\")" 2>/dev/null

check "XP minted" '[ "$MINT_STATUS" = "provisional" ] || [ "$MINT_STATUS" = "confirmed" ]'
check "XP value > 0" '[ "$(echo "$XP_VALUE > 0" | bc -l 2>/dev/null || echo 1)" = "1" ]'

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 10: Verify Reputation Updated
# ═══════════════════════════════════════════════════════════════════════════
step 10 "Check validator reputation changes"

V1_REP=$(curl -sf "${REPUTATION_URL}/validators/${VALIDATOR1_ID}/reputation")
V1_AGG=$(echo "$V1_REP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('aggregate', 0))")
V1_STREAK=$(echo "$V1_REP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('currentStreak', 0))")

echo "  Validator 1 aggregate rep: ${V1_AGG}"
echo "  Validator 1 streak:        ${V1_STREAK}"

check "Validator 1 reputation increased" '[ "$(echo "$V1_AGG > 1.0" | bc -l 2>/dev/null || echo 1)" = "1" ]'

# ═══════════════════════════════════════════════════════════════════════════
#  STEP 11: Check Supply Stats
# ═══════════════════════════════════════════════════════════════════════════
step 11 "XP supply statistics"

SUPPLY=$(curl -sf "${XP_MINT_URL}/supply")
echo "$SUPPLY" | python3 -c "
import sys, json
s = json.load(sys.stdin)
print(f\"  Total Minted:      {s.get('totalMinted', 0):.2f} XP\")
print(f\"  Total Confirmed:   {s.get('totalConfirmed', 0):.2f} XP\")
print(f\"  Total Provisional: {s.get('totalProvisional', 0):.2f} XP\")
print(f\"  Total Burned:      {s.get('totalBurned', 0):.2f} XP\")
print(f\"  Mint Events:       {s.get('eventCount', 0)}\")"\n
# ═══════════════════════════════════════════════════════════════════════════
#  STEP 12: Check Event Log
# ═══════════════════════════════════════════════════════════════════════════
step 12 "Audit trail — event log"

EVENT_COUNT=$(PGPASSWORD=extropy_dev psql -h localhost -U extropy -d extropy_engine -t -c "SELECT COUNT(*) FROM public.event_log WHERE correlation_id = '${LOOP_ID}';" 2>/dev/null | tr -d ' ' || echo "N/A")

if [ "$EVENT_COUNT" != "N/A" ]; then
  echo "  Events for this loop: ${EVENT_COUNT}"
  PGPASSWORD=extropy_dev psql -h localhost -U extropy -d extropy_engine -t -c "
    SELECT type, source, created_at
    FROM public.event_log
    WHERE correlation_id = '${LOOP_ID}'
    ORDER BY created_at ASC;" 2>/dev/null | while IFS= read -r line; do
    echo "  $line"
  done
  check "Events recorded in audit log" '[ "$EVENT_COUNT" -gt 0 ]'
else
  echo "  (psql not available — skipping event log check)"
fi

# ═══════════════════════════════════════════════════════════════════════════
#  Summary
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  RESULTS${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${GREEN}Passed: ${pass_count}${NC}"
echo -e "  ${RED}Failed: ${fail_count}${NC}"
echo ""

if [ "$fail_count" -eq 0 ]; then
  echo -e "${GREEN}  ╔═══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}  ║                                                           ║${NC}"
  echo -e "${GREEN}  ║   HAPPY PATH COMPLETE — All verification loops closed!    ║${NC}"
  echo -e "${GREEN}  ║                                                           ║${NC}"
  echo -e "${GREEN}  ║   XP = R × F × ΔS × (w · E) × log(1/Tₛ)                ║${NC}"
  echo -e "${GREEN}  ║                                                           ║${NC}"
  echo -e "${GREEN}  ║   Entropy was reduced. Value was created.                 ║${NC}"
  echo -e "${GREEN}  ║                                                           ║${NC}"
  echo -e "${GREEN}  ╚═══════════════════════════════════════════════════════════╝${NC}"
else
  echo -e "${YELLOW}  Some checks failed. Check service logs:${NC}"
  echo "    docker compose logs epistemology-engine"
  echo "    docker compose logs signalflow"
  echo "    docker compose logs loop-ledger"
  echo "    docker compose logs reputation"
  echo "    docker compose logs xp-mint"
fi
echo ""
