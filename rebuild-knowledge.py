#!/usr/bin/env python3
"""Rebuild the NyaaChat knowledge base backend (nyaachat-knowledge, port 5108).

Independent of the frontend and shared-server rebuilds. See
.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md.

Usage:
  python rebuild-knowledge.py            # Build with cache (default)
  python rebuild-knowledge.py --no-cache # Full rebuild without cache
"""

import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
COMPOSE_FILE = "docker-compose.knowledge.yml"

CYAN = "\033[36m"
GREEN = "\033[32m"
RESET = "\033[0m"


def say(msg: str, *, colour: str = "") -> None:
    if colour:
        print(f"{colour}{msg}{RESET}")
    else:
        print(msg)


def run(cmd: list[str], **kwargs) -> None:
    say(f"> {' '.join(cmd)}")
    subprocess.run(cmd, check=True, **kwargs)


def main() -> None:
    import os
    os.chdir(PROJECT_ROOT)

    no_cache = "--no-cache" in sys.argv

    # 1. Ensure external network exists (shared with main compose + shared-server)
    result = subprocess.run(
        ["docker", "network", "ls", "--filter", "name=^nyaachat-net$", "--format", "{{.Name}}"],
        capture_output=True, text=True,
    )
    if "nyaachat-net" not in result.stdout:
        say("Creating external network nyaachat-net...", colour=CYAN)
        run(["docker", "network", "create", "nyaachat-net"])

    # 2. Build
    if no_cache:
        say("Building knowledge backend (no cache)...", colour=CYAN)
        run(["docker", "compose", "-f", COMPOSE_FILE, "build", "--no-cache"])
    else:
        say("Building knowledge backend (using cache)...", colour=CYAN)
        run(["docker", "compose", "-f", COMPOSE_FILE, "build"])

    # 3. Start containers
    say("Starting knowledge backend...", colour=CYAN)
    run(["docker", "compose", "-f", COMPOSE_FILE, "up", "-d"])

    # 4. Remove dangling images
    say("Removing dangling images...", colour=CYAN)
    result = subprocess.run(
        ["docker", "images", "-f", "dangling=true", "-q"],
        capture_output=True, text=True,
    )
    dangling = result.stdout.strip()
    if dangling:
        run(["docker", "rmi", "-f", *dangling.splitlines()])

    # 5. Show running containers
    say("Done. Running containers:", colour=GREEN)
    run(["docker", "ps", "--format", "table {{.Names}}\t{{.Status}}\t{{.Ports}}"])


if __name__ == "__main__":
    main()
