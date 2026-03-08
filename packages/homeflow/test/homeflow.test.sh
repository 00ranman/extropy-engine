#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  HomeFlow — Integration Test Script
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Usage:
#    chmod +x test/homeflow.test.sh
#    ./test/homeflow.test.sh [BASE_URL]
#
#  Default BASE_URL: http://localhost:4015
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

BASE_URL="${1:-http://localhost:4015}"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

assert_status() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    green "  ✓ $name (HTTP $actual)"
    PASS=$((PASS+1))
  else
    red "  ✗ $name — expected $expected, got $actual"
    FAIL=$((FAIL+1))
  fi
}

json_field() {
  echo "$1" | python3 -c "import sys,json; print(json.load(sys.stdin)$2)" 2>/dev/null || echo ""
}

bold "═══════════════════════════════════════════════════════════════"
bold "  HomeFlow Integration Tests"
bold "  Target: $BASE_URL"
bold "═══════════════════════════════════════════════════════════════"
echo ""

# ── 1. Health Check ──────────────────────────────────────────────────────
bold "1. Health Check"
HTTP=$(curl -s -o /tmp/hf_health.json -w "%{http_code}" "$BASE_URL/health")
assert_status "GET /health" 200 "$HTTP"
SERVICE=$(json_field "$(cat /tmp/hf_health.json)" "['service']")
assert_status "service == homeflow" "homeflow" "$SERVICE"
echo ""

# ── 2. Create Household ──────────────────────────────────────────────────
bold "2. Household Management"
HTTP=$(curl -s -o /tmp/hf_household.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/households" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Ranch","validatorId":"validator-001","timezone":"America/Chicago","area_sqft":2400,"energyBaselineKwh":30}')
assert_status "POST /api/v1/households" 201 "$HTTP"
HOUSEHOLD_ID=$(json_field "$(cat /tmp/hf_household.json)" "['id']")
echo "  → Household ID: $HOUSEHOLD_ID"

HTTP=$(curl -s -o /tmp/hf_get_household.json -w "%{http_code}" "$BASE_URL/api/v1/households/$HOUSEHOLD_ID")
assert_status "GET /api/v1/households/:id" 200 "$HTTP"
echo ""

# ── 3. Create Zone ───────────────────────────────────────────────────────
bold "3. Zone Management"
HTTP=$(curl -s -o /tmp/hf_zone.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/zones" \
  -H "Content-Type: application/json" \
  -d "{\"householdId\":\"$HOUSEHOLD_ID\",\"name\":\"Living Room\",\"floor\":1,\"area_sqft\":400,\"targetTemperatureF\":72}")
assert_status "POST /api/v1/zones" 201 "$HTTP"
ZONE_ID=$(json_field "$(cat /tmp/hf_zone.json)" "['id']")
echo "  → Zone ID: $ZONE_ID"
echo ""

# ── 4. Register Devices ─────────────────────────────────────────────────
bold "4. Device Management"

# Thermostat
HTTP=$(curl -s -o /tmp/hf_thermo.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/devices" \
  -H "Content-Type: application/json" \
  -d "{\"householdId\":\"$HOUSEHOLD_ID\",\"zoneId\":\"$ZONE_ID\",\"name\":\"Living Room Thermostat\",\"type\":\"thermostat\",\"manufacturer\":\"Nest\",\"model\":\"Learning 3rd Gen\",\"firmwareVersion\":\"5.9.3\"}")
assert_status "POST /devices (thermostat)" 201 "$HTTP"
THERMO_ID=$(json_field "$(cat /tmp/hf_thermo.json)" "['id']")
echo "  → Thermostat ID: $THERMO_ID"

# Energy Monitor
HTTP=$(curl -s -o /tmp/hf_monitor.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/devices" \
  -H "Content-Type: application/json" \
  -d "{\"householdId\":\"$HOUSEHOLD_ID\",\"name\":\"Whole Home Monitor\",\"type\":\"energy_monitor\",\"manufacturer\":\"Sense\",\"model\":\"Energy Monitor\",\"firmwareVersion\":\"1.2.0\"}")
assert_status "POST /devices (energy_monitor)" 201 "$HTTP"
MONITOR_ID=$(json_field "$(cat /tmp/hf_monitor.json)" "['id']")

# Lighting
HTTP=$(curl -s -o /tmp/hf_light.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/devices" \
  -H "Content-Type: application/json" \
  -d "{\"householdId\":\"$HOUSEHOLD_ID\",\"zoneId\":\"$ZONE_ID\",\"name\":\"Smart Bulb\",\"type\":\"lighting\",\"manufacturer\":\"Philips\",\"model\":\"Hue A19\",\"firmwareVersion\":\"1.88\"}")
assert_status "POST /devices (lighting)" 201 "$HTTP"
LIGHT_ID=$(json_field "$(cat /tmp/hf_light.json)" "['id']")

# List devices
HTTP=$(curl -s -o /tmp/hf_devices_list.json -w "%{http_code}" "$BASE_URL/api/v1/devices?householdId=$HOUSEHOLD_ID")
assert_status "GET /devices?householdId=" 200 "$HTTP"
DEVICE_COUNT=$(json_field "$(cat /tmp/hf_devices_list.json)" "['total']")
assert_status "device count == 3" "3" "$DEVICE_COUNT"
echo ""

# ── 5. Issue Commands ────────────────────────────────────────────────────
bold "5. Device Commands"

# Set thermostat to 72°F
HTTP=$(curl -s -o /tmp/hf_cmd1.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/devices/$THERMO_ID/commands" \
  -H "Content-Type: application/json" \
  -d '{"commandType":"set_temperature","parameters":{"temperatureF":72},"issuedBy":"validator-001"}')
assert_status "SET thermostat to 72°F" 201 "$HTTP"
CMD1_STATUS=$(json_field "$(cat /tmp/hf_cmd1.json)" "['status']")
assert_status "command status == confirmed" "confirmed" "$CMD1_STATUS"

# Turn off lights
HTTP=$(curl -s -o /tmp/hf_cmd2.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/devices/$LIGHT_ID/commands" \
  -H "Content-Type: application/json" \
  -d '{"commandType":"toggle_power","parameters":{"on":false},"issuedBy":"validator-001"}')
assert_status "TOGGLE lights off" 201 "$HTTP"

# Set HVAC mode
HTTP=$(curl -s -o /tmp/hf_cmd3.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/devices/$THERMO_ID/commands" \
  -H "Content-Type: application/json" \
  -d '{"commandType":"set_hvac_mode","parameters":{"mode":"auto"},"issuedBy":"validator-001"}')
assert_status "SET HVAC to auto" 201 "$HTTP"

# Get command history
HTTP=$(curl -s -o /tmp/hf_cmd_hist.json -w "%{http_code}" "$BASE_URL/api/v1/devices/$THERMO_ID/commands")
assert_status "GET command history" 200 "$HTTP"
echo ""

# ── 6. Entropy Measurement ──────────────────────────────────────────────
bold "6. Entropy Measurement"

# Take first snapshot (before)
HTTP=$(curl -s -o /tmp/hf_snap1.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/entropy/snapshot" \
  -H "Content-Type: application/json" \
  -d "{\"householdId\":\"$HOUSEHOLD_ID\"}")
assert_status "POST entropy snapshot 1 (before)" 201 "$HTTP"
ENTROPY1=$(json_field "$(cat /tmp/hf_snap1.json)" "['entropyJoulePerKelvin']")
echo "  → Snapshot 1 entropy: $ENTROPY1 J/K"

# Simulate energy reduction: update device states to show lower consumption
curl -s -X PATCH "$BASE_URL/api/v1/devices/$MONITOR_ID" \
  -H "Content-Type: application/json" \
  -d '{"state":{"powerWatts":500,"energyGeneratedWh":0}}' > /dev/null
sleep 1

# Take second snapshot (after)
HTTP=$(curl -s -o /tmp/hf_snap2.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/entropy/snapshot" \
  -H "Content-Type: application/json" \
  -d "{\"householdId\":\"$HOUSEHOLD_ID\"}")
assert_status "POST entropy snapshot 2 (after)" 201 "$HTTP"
ENTROPY2=$(json_field "$(cat /tmp/hf_snap2.json)" "['entropyJoulePerKelvin']")
echo "  → Snapshot 2 entropy: $ENTROPY2 J/K"

# Measure reduction
HTTP=$(curl -s -o /tmp/hf_measure.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/entropy/measure" \
  -H "Content-Type: application/json" \
  -d "{\"householdId\":\"$HOUSEHOLD_ID\",\"causalCommandIds\":[\"cmd1\",\"cmd2\"]}")
assert_status "POST entropy measure" "201" "$HTTP"
echo "  → Measurement result:"
cat /tmp/hf_measure.json | python3 -m json.tool 2>/dev/null | head -10 || true

# Get entropy history
HTTP=$(curl -s -o /tmp/hf_entropy_hist.json -w "%{http_code}" "$BASE_URL/api/v1/entropy/$HOUSEHOLD_ID/history")
assert_status "GET entropy history" 200 "$HTTP"
echo ""

# ── 7. Schedules (Temporal) ─────────────────────────────────────────────
bold "7. Automation Schedules"
HTTP=$(curl -s -o /tmp/hf_schedule.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/schedules" \
  -H "Content-Type: application/json" \
  -d "{\"householdId\":\"$HOUSEHOLD_ID\",\"name\":\"Night Mode\",\"type\":\"time_based\",\"cronExpression\":\"0 22 * * *\",\"actions\":[{\"deviceId\":\"$THERMO_ID\",\"commandType\":\"set_temperature\",\"parameters\":{\"temperatureF\":68}},{\"deviceId\":\"$LIGHT_ID\",\"commandType\":\"toggle_power\",\"parameters\":{\"on\":false}}]}")
assert_status "POST create schedule" 201 "$HTTP"
SCHEDULE_ID=$(json_field "$(cat /tmp/hf_schedule.json)" "['id']")
echo "  → Schedule ID: $SCHEDULE_ID"

HTTP=$(curl -s -o /tmp/hf_schedules.json -w "%{http_code}" "$BASE_URL/api/v1/schedules?householdId=$HOUSEHOLD_ID")
assert_status "GET list schedules" 200 "$HTTP"
echo ""

# ── 8. Governance (DFAO) ────────────────────────────────────────────────
bold "8. Governance — Household DFAO"
HTTP=$(curl -s -o /tmp/hf_dfao.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/governance/dfao" \
  -H "Content-Type: application/json" \
  -d "{\"householdId\":\"$HOUSEHOLD_ID\",\"householdName\":\"Test Ranch\",\"founderValidatorId\":\"validator-001\"}")
assert_status "POST create household DFAO" 201 "$HTTP"
echo ""

# ── 9. Token Balances ───────────────────────────────────────────────────
bold "9. Token Economy"
HTTP=$(curl -s -o /tmp/hf_tokens.json -w "%{http_code}" "$BASE_URL/api/v1/tokens/$HOUSEHOLD_ID")
assert_status "GET token balances" 200 "$HTTP"
echo ""

# ── 10. Credentials ─────────────────────────────────────────────────────
bold "10. Credentials"
HTTP=$(curl -s -o /tmp/hf_creds.json -w "%{http_code}" "$BASE_URL/api/v1/credentials/$HOUSEHOLD_ID")
assert_status "GET credentials" 200 "$HTTP"
echo ""

# ── 11. Interop ─────────────────────────────────────────────────────────
bold "11. Ecosystem Interoperability"

# Get manifest
HTTP=$(curl -s -o /tmp/hf_manifest.json -w "%{http_code}" "$BASE_URL/api/v1/interop/manifest")
assert_status "GET interop manifest" 200 "$HTTP"
APP_ID=$(json_field "$(cat /tmp/hf_manifest.json)" "['appId']")
assert_status "manifest appId == homeflow" "homeflow" "$APP_ID"

# List adapters
HTTP=$(curl -s -o /tmp/hf_adapters.json -w "%{http_code}" "$BASE_URL/api/v1/interop/adapters")
assert_status "GET list adapters" 200 "$HTTP"
ADAPTER_COUNT=$(json_field "$(cat /tmp/hf_adapters.json)" "['total']")
echo "  → Registered adapters: $ADAPTER_COUNT"

# Register a new adapter (runtime)
HTTP=$(curl -s -o /tmp/hf_new_adapter.json -w "%{http_code}" -X POST "$BASE_URL/api/v1/interop/adapters" \
  -H "Content-Type: application/json" \
  -d '{"appId":"test-app","appName":"Test App","entropyDomains":["cognitive"],"publishedEvents":["test.event"],"subscribedEvents":["homeflow.entropy.reduction"]}')
assert_status "POST register adapter" 201 "$HTTP"

# Send a cross-domain event via webhook
HTTP=$(curl -s -o /tmp/hf_webhook.json -w "%{http_code}" -X POST "$BASE_URL/events" \
  -H "Content-Type: application/json" \
  -d "{\"eventId\":\"test-event-001\",\"type\":\"academicxp.study.completed\",\"source\":\"academic-xp\",\"payload\":{\"deltaS\":5.2,\"domain\":\"cognitive\",\"householdId\":\"$HOUSEHOLD_ID\"},\"correlationId\":\"loop-test-001\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"version\":1}")
assert_status "POST /events (cross-domain webhook)" 200 "$HTTP"
PROCESSED=$(json_field "$(cat /tmp/hf_webhook.json)" "['processed']")
assert_status "event processed == True" "True" "$PROCESSED"
echo ""

# ── 12. DAG References ──────────────────────────────────────────────────
bold "12. DAG Substrate"
HTTP=$(curl -s -o /tmp/hf_dag.json -w "%{http_code}" "$BASE_URL/api/v1/dag/$HOUSEHOLD_ID")
assert_status "GET DAG references" 200 "$HTTP"
echo ""

# ── Results ──────────────────────────────────────────────────────────────
echo ""
bold "═══════════════════════════════════════════════════════════════"
bold "  Results: $PASS passed, $FAIL failed"
bold "═══════════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
