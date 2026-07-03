#!/usr/bin/env python3
"""Rebuild the NyaaChat Docker image and restart containers.

Usage:
  python rebuild.py            # Build with cache (default)
  python rebuild.py --no-cache # Full rebuild without cache
"""

import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
COMPOSE_FILE = "docker-compose.yml"

# ANSI colour helpers (work on modern Windows, Linux, and macOS terminals).
CYAN = "\033[36m"
GREEN = "\033[32m"
RESET = "\033[0m"


def say(msg: str, *, colour: str = "") -> None:
    """Print a message with an optional ANSI colour wrapper."""
    if colour:
        print(f"{colour}{msg}{RESET}")
    else:
        print(msg)


def run(cmd: list[str], **kwargs) -> None:
    """Echo and run a command; raise on failure."""
    say(f"> {' '.join(cmd)}")
    subprocess.run(cmd, check=True, **kwargs)


def main() -> None:
    import os
    os.chdir(PROJECT_ROOT)

    no_cache = "--no-cache" in sys.argv

    # 1. Generate extension registry
    say("Generating extension registry...", colour=CYAN)
    run(["node", "scripts/generate-extension-registry.mjs"])

    # 2. Build
    if no_cache:
        say("Building image (no cache)...", colour=CYAN)
        run(["docker", "compose", "-f", COMPOSE_FILE, "build", "--no-cache"])
    else:
        say("Building image (using cache)...", colour=CYAN)
        run(["docker", "compose", "-f", COMPOSE_FILE, "build"])

    # 3. Start containers (up -d recreates only when image/config changed)
    say("Starting containers...", colour=CYAN)
    run(["docker", "compose", "-f", COMPOSE_FILE, "up", "-d"])

    # 4. Remove dangling images (after recreation so old image is released)
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
