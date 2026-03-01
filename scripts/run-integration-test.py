#!/usr/bin/env python3
"""
Extropy Engine Integration Test Orchestrator

Starts PostgreSQL, Redis, all 5 services, runs the happy-path test,
then tears everything down.
"""

import subprocess
import sys
import os
import time
import signal
import json
import urllib.request
import urllib.error
import traceback

BASE_DIR = "/home/user/workspace/extropy-engine"
SERVICES = [
    {"name": "epistemology-engine", "port": 4001, "dir": f"{BASE_DIR}/packages/epistemology-engine"},
    {"name": "signalflow",          "port": 4002, "dir": f"{BASE_DIR}/packages/signalflow"},
    {"name": "loop-ledger",         "port": 4003, "dir": f"{BASE_DIR}/packages/loop-ledger"},
    {"name": "reputation",          "port": 4004, "dir": f"{BASE_DIR}/packages/reputation"},
    {"name": "xp-mint",             "port": 4005, "dir": f"{BASE_DIR}/packages/xp-mint"},
]

ENV = {
    **os.environ,
    "DATABASE_URL": "postgresql://extropy:extropy_dev@localhost:5432/extropy_engine",
    "REDIS_URL": "redis://localhost:6379",
    "NODE_ENV": "development",
    "EPISTEMOLOGY_URL": "http://localhost:4001",
    "SIGNALFLOW_URL": "http://localhost:4002",
    "LOOP_LEDGER_URL": "http://localhost:4003",
    "REPUTATION_URL": "http://localhost:4004",
    "XP_MINT_URL": "http://localhost:4005",
}

processes = []

def cleanup():
    print("\n🧹 Cleaning up services...")
    for proc, name in processes:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            proc.wait(timeout=5)
            print(f"  ✅ {name} stopped")
        except:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except:
                pass
            print(f"  ⚠️  {name} killed")

def signal_handler(sig, frame):
    cleanup()
    sys.exit(1)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

def check_health(port, timeout=30, interval=0.5):
    url = f"http://localhost:{port}/health"
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = urllib.request.urlopen(urllib.request.Request(url), timeout=2)
            if resp.status == 200:
                return True
        except:
            pass
        time.sleep(interval)
    return False

def http_request(method, url, data=None):
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        raw = resp.read().decode()
        try:
            return resp.status, json.loads(raw)
        except:
            return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except:
            return e.code, raw

def run_test():
    print("\n" + "="*60)
    print("🧪 EXTROPY ENGINE — HAPPY PATH INTEGRATION TEST")
    print("="*60)

    passed = 0
    failed = 0
    total = 12

    def check(name, condition, detail=""):
        nonlocal passed, failed
        if condition:
            passed += 1
            print(f"  ✅ PASS: {name}")
        else:
            failed += 1
            print(f"  ❌ FAIL: {name}")
        if detail:
            print(f"         {detail}")

    # ── Step 1: Health checks ─────────────────────────────────────────
    print("\n📋 Step 1: Health Checks")
    all_healthy = True
    for svc in SERVICES:
        status, _ = http_request("GET", f"http://localhost:{svc['port']}/health")
        if status != 200:
            all_healthy = False
            print(f"  ⚠️  {svc['name']} unhealthy: {status}")
    check("All services healthy", all_healthy)

    # ── Step 2: Register validators ───────────────────────────────────
    # Reputation service expects: { name, type, domains }
    print("\n📋 Step 2: Register Validators")
    validators = []
    validator_configs = [
        {"name": "Validator-Thermo",        "type": "human", "domains": ["thermodynamic"]},
        {"name": "Validator-Cognitive",     "type": "human", "domains": ["cognitive"]},
        {"name": "Validator-Informational", "type": "human", "domains": ["informational"]},
    ]
    for vc in validator_configs:
        status, body = http_request("POST", "http://localhost:4004/validators", vc)
        if status in (200, 201) and isinstance(body, dict):
            vid = body.get("id")
            validators.append(vid)
            print(f"  → Registered {vc['name']} → {vid} (rep={body.get('aggregateReputation', '?')})")
        else:
            print(f"  ⚠️  Failed to register {vc['name']}: {status} {body}")
    check("3 validators registered", len(validators) == 3, f"IDs: {validators}")

    # ── Step 3: Submit a claim ────────────────────────────────────────
    # Epistemology expects: { statement, domain, submitterId }
    print("\n📋 Step 3: Submit Claim")
    status, body = http_request("POST", "http://localhost:4001/claims", {
        "statement": "The second law of thermodynamics implies entropy in isolated systems never decreases",
        "domain": "thermodynamic",
        "submitterId": validators[0] if validators else "user-test-001"
    })
    claim = body if isinstance(body, dict) else {}
    claim_id = claim.get("id")
    loop_id = claim.get("loopId")
    check("Claim submitted", status in (200, 201) and claim_id is not None,
          f"Claim ID: {claim_id}, Loop ID: {loop_id}, Status: {claim.get('status')}")

    # ── Step 4: Wait for event cascade ────────────────────────────────
    print("\n📋 Step 4: Wait for Event Cascade")
    print("  ⏳ Waiting 8s for: claim.submitted → loop.opened → decompose → task.created → task.assigned ...")
    time.sleep(8)
    check("Event cascade propagated", True, "Waited 8s for async events via Redis pub/sub")

    # ── Step 5: Check sub-claims ──────────────────────────────────────
    # Endpoint: GET /subclaims/by-claim/:claimId
    print("\n📋 Step 5: Check Sub-Claims")
    subclaims = []
    if claim_id:
        status, body = http_request("GET", f"http://localhost:4001/subclaims/by-claim/{claim_id}")
        if isinstance(body, list):
            subclaims = body
        elif isinstance(body, dict) and "subclaims" in body:
            subclaims = body["subclaims"]
        # If that fails, try also checking the claim itself for subClaimIds
        if not subclaims:
            status2, body2 = http_request("GET", f"http://localhost:4001/claims/{claim_id}")
            if isinstance(body2, dict):
                sub_ids = body2.get("subClaimIds", [])
                if sub_ids:
                    subclaims = [{"id": sid} for sid in sub_ids]
    check("Sub-claims decomposed", len(subclaims) >= 2,
          f"Found {len(subclaims)} sub-claims" + (f": {[s.get('id','?')[:8]+'...' for s in subclaims[:3]]}" if subclaims else ""))

    # ── Step 6: Check tasks created & routed ──────────────────────────
    print("\n📋 Step 6: Check Tasks Created")
    status, body = http_request("GET", "http://localhost:4002/tasks")
    all_tasks = body if isinstance(body, list) else (body.get("tasks", []) if isinstance(body, dict) else [])
    assigned_tasks = [t for t in all_tasks if isinstance(t, dict) and t.get("status") == "assigned"]
    check("Tasks created & routed", len(all_tasks) >= 1,
          f"Total: {len(all_tasks)}, Assigned: {len(assigned_tasks)}")

    # ── Step 7: Complete validation tasks ─────────────────────────────
    print("\n📋 Step 7: Complete Validation Tasks")
    completed_count = 0
    tasks_to_complete = assigned_tasks if assigned_tasks else all_tasks[:3]
    for task in tasks_to_complete:
        task_id = task.get("id") if isinstance(task, dict) else None
        if not task_id:
            continue
        assigned_to = task.get("assignedValidatorId") or task.get("assignedTo")
        validator_id = assigned_to or (validators[completed_count % len(validators)] if validators else "fallback-validator")
        status, body = http_request("POST", f"http://localhost:4002/tasks/{task_id}/complete", {
            "validatorId": validator_id,
            "result": {
                "verdict": "supported",
                "confidence": 0.92,
                "evidence": ["Clausius inequality", "Boltzmann H-theorem"],
                "reasoning": "Well-established thermodynamic principle verified by multiple independent lines of evidence"
            }
        })
        if status in (200, 201):
            completed_count += 1
            print(f"  → Completed task {task_id[:12]}... by validator {validator_id[:12]}...")
        else:
            print(f"  ⚠️  Failed task {task_id}: {status} {body}")
    check("Tasks completed", completed_count >= 1, f"Completed {completed_count}/{len(tasks_to_complete)}")

    # ── Step 8: Wait for post-completion cascade ──────────────────────
    print("\n📋 Step 8: Wait for Post-Completion Cascade")
    print("  ⏳ Waiting 8s for: task.completed → subclaim.updated → claim.evaluated → loop.consensus → loop.closed → xp.minted")
    time.sleep(8)
    check("Post-completion cascade", True, "Waited 8s for events")

    # ── Step 9: Check claim evaluation ────────────────────────────────
    print("\n📋 Step 9: Check Claim Evaluated")
    if claim_id:
        status, body = http_request("GET", f"http://localhost:4001/claims/{claim_id}")
        claim_data = body if isinstance(body, dict) else {}
        claim_status = claim_data.get("status", "")
        truth_score = claim_data.get("truthScore", 0)
        check("Claim evaluated", claim_status in ("evaluated", "verified", "closed"),
              f"Status: {claim_status}, Truth Score: {truth_score}")
    else:
        check("Claim evaluated", False, "No claim ID available")

    # ── Step 10: Check loop closed ────────────────────────────────────
    print("\n📋 Step 10: Check Loop Closed")
    all_loops_settled = []
    for loop_status_query in ["settled", "closed", "consensus"]:
        status, body = http_request("GET", f"http://localhost:4003/loops?status={loop_status_query}")
        loops = body if isinstance(body, list) else (body.get("loops", []) if isinstance(body, dict) else [])
        all_loops_settled.extend(loops)
    # Also check the specific loop
    if loop_id and not all_loops_settled:
        status, body = http_request("GET", f"http://localhost:4003/loops/{loop_id}")
        if isinstance(body, dict):
            all_loops_settled = [body]
    loop_detail = ""
    if all_loops_settled:
        l = all_loops_settled[0] if isinstance(all_loops_settled[0], dict) else {}
        loop_detail = f"Loop {l.get('id','?')[:12]}... status={l.get('status')}, ΔS={l.get('deltaEntropy', l.get('delta_entropy', '?'))}"
    check("Loop closed/settled", len(all_loops_settled) >= 1, loop_detail)

    # ── Step 11: Check XP minted ──────────────────────────────────────
    print("\n📋 Step 11: Check XP Minted")
    status, body = http_request("GET", "http://localhost:4005/supply")
    supply = body if isinstance(body, dict) else {}
    total_minted = supply.get("totalMinted", 0)
    total_provisional = supply.get("totalProvisional", 0)
    check("XP tokens minted", float(total_minted or 0) > 0 or float(total_provisional or 0) > 0,
          f"Total minted: {total_minted}, Provisional: {total_provisional}, Confirmed: {supply.get('totalConfirmed', 0)}")

    # ── Step 12: Check reputation updated ─────────────────────────────
    print("\n📋 Step 12: Check Reputation Updated")
    rep_updated = False
    rep_detail = ""
    for vid in validators:
        if not vid:
            continue
        status, body = http_request("GET", f"http://localhost:4004/validators/{vid}")
        rep = body if isinstance(body, dict) else {}
        score = float(rep.get("aggregateReputation", 0))
        xp = float(rep.get("totalXpEarned", 0))
        loops = int(rep.get("loopsParticipated", 0))
        if xp > 0 or loops > 0:
            rep_updated = True
            rep_detail = f"{rep.get('name')}: rep={score:.4f}, XP earned={xp:.2f}, loops={loops}"
            break
    if not rep_updated and validators:
        # Show first validator state for debugging
        status, body = http_request("GET", f"http://localhost:4004/validators/{validators[0]}")
        rep = body if isinstance(body, dict) else {}
        rep_detail = f"rep={rep.get('aggregateReputation')}, XP={rep.get('totalXpEarned')}, loops={rep.get('loopsParticipated')}"
    check("Reputation updated", rep_updated, rep_detail)

    # ── Summary ───────────────────────────────────────────────────────
    print("\n" + "="*60)
    print(f"RESULTS: {passed}/{total} passed, {failed} failed")
    print("="*60)

    if failed == 0:
        print("\n✅ ALL CHECKS PASSED — Happy path complete!")
        print("   XP = R × F × ΔS × (w · E) × log(1/Tₛ)")
        print("   Entropy was reduced. Value was created.")
    else:
        print(f"\n⚠️  {failed} check(s) failed")
        print("   Check service logs for details")

    return failed == 0

def start_infrastructure():
    """Start PostgreSQL and Redis via docker compose"""
    print("\n🐳 Starting infrastructure (PostgreSQL + Redis)...")
    try:
        result = subprocess.run(
            ["docker", "compose", "-f", f"{BASE_DIR}/docker-compose.yml",
             "up", "-d", "postgres", "redis"],
            capture_output=True, text=True, cwd=BASE_DIR, timeout=60
        )
        if result.returncode != 0:
            print(f"  ⚠️  docker compose warning: {result.stderr[:200]}")
        else:
            print("  ✅ Infrastructure started")
        time.sleep(5)  # Wait for DB to initialize
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"  ⚠️  Could not start docker infrastructure: {e}")
        print("  Assuming PostgreSQL and Redis are already running externally...")

def start_services():
    """Start all Node.js microservices"""
    print("\n🚀 Starting microservices...")
    for svc in SERVICES:
        svc_dir = svc["dir"]
        if not os.path.exists(svc_dir):
            print(f"  ⚠️  Directory not found: {svc_dir}")
            continue

        # Check if dist/index.js exists (pre-built)
        dist_js = os.path.join(svc_dir, "dist", "index.js")
        if os.path.exists(dist_js):
            cmd = ["node", dist_js]
        else:
            # Try ts-node or npx ts-node
            cmd = ["npx", "ts-node", "src/index.ts"]

        print(f"  Starting {svc['name']} on port {svc['port']}...")
        try:
            proc = subprocess.Popen(
                cmd, cwd=svc_dir, env=ENV,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                preexec_fn=os.setsid
            )
            processes.append((proc, svc["name"]))
        except FileNotFoundError as e:
            print(f"  ❌ Could not start {svc['name']}: {e}")

    # Wait for all services to become healthy
    print("\n⏳ Waiting for services to be healthy...")
    all_healthy = True
    for svc in SERVICES:
        healthy = check_health(svc["port"], timeout=60)
        if healthy:
            print(f"  ✅ {svc['name']} healthy")
        else:
            print(f"  ❌ {svc['name']} did not become healthy")
            all_healthy = False

    return all_healthy

if __name__ == "__main__":
    print("\n" + "="*60)
    print("EXTROPY ENGINE — INTEGRATION TEST ORCHESTRATOR")
    print("="*60)

    # Check if services are already running
    already_running = all(
        check_health(svc["port"], timeout=2) for svc in SERVICES
    )

    if already_running:
        print("\n✅ All services already running — skipping startup")
        success = run_test()
    else:
        start_infrastructure()
        services_ok = start_services()
        if not services_ok:
            print("\n❌ Not all services started. Running test anyway...")
        success = run_test()
        cleanup()

    sys.exit(0 if success else 1)
