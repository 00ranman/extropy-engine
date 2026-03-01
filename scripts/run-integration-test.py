#!/usr/bin/env python3
"""
Extropy Engine Integration Test Orchestrator

Starts all services via Docker Compose, waits for them to be healthy,
then runs the happy-path integration test and reports results.

Usage:
    python3 scripts/run-integration-test.py [--timeout 120] [--no-cleanup]
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime

# ── Configuration ──────────────────────────────────────────────────────────────

SERVICES = [
    {"name": "epistemology-engine", "port": 4001, "health_path": "/health"},
    {"name": "signalflow",          "port": 4002, "health_path": "/health"},
    {"name": "loop-ledger",         "port": 4003, "health_path": "/health"},
    {"name": "reputation",          "port": 4004, "health_path": "/health"},
    {"name": "xp-mint",             "port": 4005, "health_path": "/health"},
]

RESET  = "\033[0m"
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
BLUE   = "\033[34m"
BOLD   = "\033[1m"


# ── Helpers ─────────────────────────────────────────────────────────────────

def log(msg: str, color: str = "") -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"{color}[{ts}] {msg}{RESET}")


def run(cmd: list[str], check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    """Run a shell command, optionally capturing output."""
    result = subprocess.run(
        cmd,
        check=check,
        capture_output=capture,
        text=True,
    )
    return result


def wait_for_service(name: str, port: int, health_path: str, timeout: int = 60) -> bool:
    """Poll a service health endpoint until it responds 200 or timeout."""
    import urllib.request
    import urllib.error

    url = f"http://localhost:{port}{health_path}"
    deadline = time.time() + timeout
    attempt = 0

    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        attempt += 1
        if attempt % 5 == 0:
            log(f"  still waiting for {name} ({attempt} attempts)...", YELLOW)
        time.sleep(1)

    return False


# ── Phases ─────────────────────────────────────────────────────────────────

def phase_build(args) -> bool:
    log("\n══ Phase 1: Build ══", BOLD)
    try:
        log("Building Docker images...", BLUE)
        run(["docker", "compose", "build", "--parallel"])
        log("✓ Build complete", GREEN)
        return True
    except subprocess.CalledProcessError as e:
        log(f"✗ Build failed: {e}", RED)
        return False


def phase_start(args) -> bool:
    log("\n══ Phase 2: Start Services ══", BOLD)
    try:
        log("Starting services...", BLUE)
        run(["docker", "compose", "up", "-d"])
        log("✓ Services started", GREEN)
        return True
    except subprocess.CalledProcessError as e:
        log(f"✗ Failed to start services: {e}", RED)
        return False


def phase_wait(args) -> bool:
    log("\n══ Phase 3: Wait for Health ══", BOLD)
    all_healthy = True

    for svc in SERVICES:
        log(f"Waiting for {svc['name']} on :{svc['port']}...", BLUE)
        ok = wait_for_service(
            svc["name"],
            svc["port"],
            svc["health_path"],
            timeout=args.timeout,
        )
        if ok:
            log(f"  ✓ {svc['name']} healthy", GREEN)
        else:
            log(f"  ✗ {svc['name']} did not become healthy in {args.timeout}s", RED)
            all_healthy = False

    return all_healthy


def phase_test(args) -> bool:
    log("\n══ Phase 4: Run Integration Test ══", BOLD)
    script = os.path.join(os.path.dirname(__file__), "test-happy-path.sh")

    if not os.path.exists(script):
        log(f"✗ Test script not found: {script}", RED)
        return False

    log(f"Running {script}...", BLUE)
    try:
        result = run(["bash", script], check=False)
        if result.returncode == 0:
            log("✓ Integration test PASSED", GREEN)
            return True
        else:
            log(f"✗ Integration test FAILED (exit code {result.returncode})", RED)
            return False
    except Exception as e:
        log(f"✗ Error running test: {e}", RED)
        return False


def phase_cleanup(args) -> None:
    if args.no_cleanup:
        log("\nSkipping cleanup (--no-cleanup flag set)", YELLOW)
        return

    log("\n══ Phase 5: Cleanup ══", BOLD)
    try:
        run(["docker", "compose", "down", "-v"])
        log("✓ Cleanup complete", GREEN)
    except subprocess.CalledProcessError as e:
        log(f"Warning: cleanup failed: {e}", YELLOW)


def phase_logs(args) -> None:
    """Dump last N lines of logs per service on failure."""
    log("\n── Service Logs (last 30 lines each) ──", YELLOW)
    for svc in SERVICES:
        log(f"\n--- {svc['name']} ---", BOLD)
        try:
            result = run(
                ["docker", "compose", "logs", "--tail=30", svc["name"]],
                check=False,
                capture=True,
            )
            print(result.stdout or "(no output)")
            if result.stderr:
                print(result.stderr)
        except Exception as e:
            print(f"(error getting logs: {e})")


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Extropy Engine Integration Test Runner")
    parser.add_argument("--timeout",    type=int, default=120, help="Seconds to wait per service health check")
    parser.add_argument("--no-cleanup", action="store_true",   help="Don't tear down services after test")
    args = parser.parse_args()

    log(f"{BOLD}Extropy Engine — Integration Test Runner{RESET}")
    log(f"Timeout: {args.timeout}s per service")
    log(f"Cleanup: {'disabled' if args.no_cleanup else 'enabled'}")

    success = True

    # Phase 1: Build
    if not phase_build(args):
        success = False
        phase_logs(args)
        phase_cleanup(args)
        sys.exit(1)

    # Phase 2: Start
    if not phase_start(args):
        success = False
        phase_logs(args)
        phase_cleanup(args)
        sys.exit(1)

    # Phase 3: Wait
    if not phase_wait(args):
        success = False
        phase_logs(args)
        phase_cleanup(args)
        sys.exit(1)

    # Phase 4: Test
    if not phase_test(args):
        success = False
        phase_logs(args)

    # Phase 5: Cleanup
    phase_cleanup(args)

    if success:
        log(f"\n{BOLD}{GREEN}╔═══════════════════════════════╗{RESET}")
        log(f"{BOLD}{GREEN}║  ALL INTEGRATION TESTS PASSED  ║{RESET}")
        log(f"{BOLD}{GREEN}╚═══════════════════════════════╝{RESET}")
        sys.exit(0)
    else:
        log(f"\n{BOLD}{RED}╔═══════════════════════════════╗{RESET}")
        log(f"{BOLD}{RED}║  INTEGRATION TESTS FAILED      ║{RESET}")
        log(f"{BOLD}{RED}╚═══════════════════════════════╝{RESET}")
        sys.exit(1)


if __name__ == "__main__":
    main()
