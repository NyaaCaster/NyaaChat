#!/usr/bin/env python3
"""NyaaChat restart script (macmini side).

Manages THREE independent compose projects that share the external network
`nyaachat-net`.  Restarts them in dependency order so backends are ready
before the main nginx starts proxying traffic.

Principle: pull FIRST, then stop — minimizes client disconnection time.

Usage:
  python3 restart.py              # standard restart (pull → down → up → prune)
  python3 restart.py --no-pull    # skip pull (restart with existing images)
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

PROJECT = "nyaachat"
CONTAINERS = ["nyaachat-app-1", "nyaachat-ext-host-1", "nyaachat-shared", "nyaachat-knowledge"]

# Compose files in DEPENDENCY ORDER for up (backends first, then frontend).
# For down we reverse this; for pull order does not matter.
COMPOSE_FILES_UP = [
    "docker-compose.shared.yml",
    "docker-compose.knowledge.yml",
    "docker-compose.yml",
]


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    print(f"  -> {' '.join(cmd)}")
    return subprocess.run(cmd)


def ensure_network():
    """Create the shared external network if it does not exist (idempotent)."""
    cp = subprocess.run(
        ["docker", "network", "ls", "--filter", "name=^nyaachat-net$", "--format", "{{.Name}}"],
        capture_output=True, text=True,
    )
    if "nyaachat-net" not in cp.stdout:
        print("[0/5] Creating external network nyaachat-net...")
        run(["docker", "network", "create", "nyaachat-net"])
    else:
        print("[0/5] External network nyaachat-net already exists.")


def main():
    parser = argparse.ArgumentParser(description=f"Restart {PROJECT}")
    parser.add_argument("--no-pull", action="store_true", help="Skip docker compose pull")
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    os.chdir(here)

    # ---- 0. ensure network ----
    ensure_network()

    # ---- 1. pull first (minimise downtime) ----
    if not args.no_pull:
        print("[1/5] Pulling latest images...")
        all_ok = True
        for cf in COMPOSE_FILES_UP:
            cp = run(["docker", "compose", "-f", cf, "pull"], check=False)
            if cp.returncode != 0:
                print(f"[WARN] Pull failed for {cf}, continuing with existing image...")
                all_ok = False
        if all_ok:
            print("All pulls successful.")
    else:
        print("[1/5] Skipping pull (--no-pull).")

    # ---- 2. stop all (reverse order) ----
    print("[2/5] Stopping all compose projects...")
    for cf in reversed(COMPOSE_FILES_UP):
        run(["docker", "compose", "-f", cf, "down"])

    # ---- 3. start in dependency order (backends first) ----
    print("[3/5] Starting in dependency order (shared → knowledge → app)...")
    for cf in COMPOSE_FILES_UP:
        run(["docker", "compose", "-f", cf, "up", "-d"])

    # ---- 4. prune dangling images ----
    print("[4/5] Cleaning up dangling images...")
    run(["docker", "image", "prune", "-f"])

    # ---- 5. status report ----
    print(f"\n=== {PROJECT} status ===")
    run(["docker", "ps", "--filter", "name=nyaachat",
         "--format", "table {{.Names}}\t{{.Status}}\t{{.Ports}}"])


if __name__ == "__main__":
    main()
