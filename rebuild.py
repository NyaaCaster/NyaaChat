#!/usr/bin/env python3
"""NyaaChat: build images → push to private registry (NyaaDockerHUB).

Builds FOUR images from three compose projects:
  nyaachat-app       — nginx frontend (root Dockerfile)
  nyaachat-ext-host  — ComfyUI T2I agent sidecar (ext-host/Dockerfile)
  nyaachat-shared    — shared-character backend (shared-server/Dockerfile)
  nyaachat-knowledge — knowledge base backend (nyaachat-knowledge/Dockerfile)

Usage:
  python rebuild.py              # build + push + registry cleanup + local cleanup
  python rebuild.py --no-cache   # force full rebuild without Docker layer cache
  python rebuild.py --skip-push  # local build only (offline / debugging)
  python rebuild.py --only=nyaachat-shared  # build+push a single image

Registry credentials read from .env (PRIVATE_DOCKER_REGISTRY_HOST / URL).
Neither value is ever hardcoded in this file.
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib import request, error as urllib_error

PROJECT = "nyaachat"
IMAGES = [
    {"name": "nyaachat-app",       "dockerfile": "Dockerfile",                   "context": "."},
    {"name": "nyaachat-ext-host",  "dockerfile": "ext-host/Dockerfile",          "context": "./ext-host"},
    {"name": "nyaachat-shared",    "dockerfile": "shared-server/Dockerfile",     "context": "./shared-server"},
    {"name": "nyaachat-knowledge", "dockerfile": "nyaachat-knowledge/Dockerfile","context": "./nyaachat-knowledge"},
]
RETRY_MAX = 3
RETRY_DELAY = 2  # seconds


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def load_env() -> dict[str, str]:
    """Load .env into a dict (simple parser, no dotenv dependency)."""
    env = {}
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        print("[ERROR] .env not found. Cannot proceed without registry config.")
        sys.exit(1)
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip()
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            env[k] = v
    return env


def mask(text: str, secrets: list[str]) -> str:
    """Replace every occurrence of each secret with <PRIVATE_REGISTRY>."""
    for s in secrets:
        if s:
            text = text.replace(s, "<PRIVATE_REGISTRY>")
    return text


def run(cmd: list[str], secrets: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Run a command, printing masked output."""
    print(f"  -> {' '.join(mask(str(x), secrets) for x in cmd)}")
    return subprocess.run(cmd, **kwargs)


def get_git_sha(length: int = 7) -> str:
    """Get short SHA from the main repo (NyaaChat root)."""
    cp = subprocess.run(
        ["git", "rev-parse", f"--short={length}", "HEAD"],
        capture_output=True, text=True, cwd=Path(__file__).resolve().parent,
    )
    if cp.returncode != 0:
        print("[ERROR] Not a git repository or no commits.")
        sys.exit(1)
    return cp.stdout.strip()


def registry_health(registry_url: str, secrets: list[str]) -> bool:
    """Check that the private registry is reachable."""
    try:
        req = request.Request(f"{registry_url}/v2/")
        with request.urlopen(req, timeout=5) as resp:
            print(f"Registry OK (status {resp.status})")
            return True
    except Exception as e:
        print(f"[WARN] Registry health check failed: {mask(str(e), secrets)}")
        return False


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------

def docker_build(host: str, image_cfg: dict, sha: str, no_cache: bool, secrets: list[str]):
    """docker build one image with double tags (sha + latest)."""
    name = image_cfg["name"]
    dockerfile = image_cfg["dockerfile"]
    ctx = image_cfg["context"]
    tags = [f"{host}/{name}:{sha}", f"{host}/{name}:latest"]
    cmd = ["docker", "build", "-f", dockerfile]
    if no_cache:
        cmd.append("--no-cache")
    for t in tags:
        cmd += ["-t", t]
    cmd.append(ctx)
    cp = run(cmd, secrets)
    if cp.returncode != 0:
        print(f"[ERROR] Docker build failed for {name}.")
        sys.exit(1)
    print(f"Build OK  {name}")


# ---------------------------------------------------------------------------
# push
# ---------------------------------------------------------------------------

def docker_push(host: str, image_name: str, tag: str, secrets: list[str]):
    """Push a single tag with retry on transient errors."""
    full = f"{host}/{image_name}:{tag}"
    for attempt in range(1, RETRY_MAX + 1):
        cp = run(["docker", "push", full], secrets)
        if cp.returncode == 0:
            print(f"Push OK  {image_name}:{tag}")
            return
        print(f"Push failed ({image_name}:{tag}, attempt {attempt}/{RETRY_MAX})")
        if attempt < RETRY_MAX:
            time.sleep(RETRY_DELAY)
    print(f"[ERROR] Push exhausted retries for {image_name}:{tag}")
    sys.exit(1)


# ---------------------------------------------------------------------------
# registry cleanup
# ---------------------------------------------------------------------------

# Media types a manifest HEAD/GET may answer with. registry:2 cannot pick a
# representation without them and replies 404 for every tag — which silently
# turned the old keep-only-latest cleanup into a no-op (all tags accumulated).
MANIFEST_ACCEPT = ", ".join([
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.oci.image.index.v1+json",
])


def manifest_digest(registry_url: str, image_name: str, reference: str) -> str:
    """Resolve a tag (or digest) to its manifest digest, '' when unavailable."""
    req = request.Request(
        f"{registry_url}/v2/{image_name}/manifests/{reference}",
        headers={"Accept": MANIFEST_ACCEPT},
        method="HEAD",
    )
    with request.urlopen(req, timeout=10) as resp:
        return resp.headers.get("Docker-Content-Digest", "")


def delete_manifest(registry_url: str, image_name: str, digest: str) -> bool:
    """Delete one manifest by digest. Returns True on 200/202."""
    req = request.Request(
        f"{registry_url}/v2/{image_name}/manifests/{digest}",
        method="DELETE",
    )
    with request.urlopen(req, timeout=10) as resp:
        return resp.status in (200, 202)


def registry_cleanup(registry_url: str, host: str, image_name: str, sha: str, secrets: list[str]):
    """Delete obsolete remote tags, never touching a digest we must keep.

    registry:2 has no per-tag delete: DELETE addresses a *manifest digest*, and
    every tag pointing at it dies with it. Back-to-back builds of the same
    source are content-identical, so an obsolete tag can share its digest with
    the tags we keep — deleting that digest would wipe the image just published.
    Therefore: resolve the kept tags first and skip any obsolete tag whose
    digest is one of theirs.
    """
    print(f"Registry cleanup for {image_name} (keep-only-latest)...")
    try:
        req = request.Request(f"{registry_url}/v2/{image_name}/tags/list")
        with request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        all_tags = data.get("tags") or []
    except Exception as e:
        print(f"[WARN] Cannot list registry tags for {image_name}: {mask(str(e), secrets)}")
        return

    keep = {sha, "latest"}

    # Digests behind the tags we must keep — never delete these.
    protected: set[str] = set()
    for tag in sorted(keep):
        if tag not in all_tags:
            continue
        try:
            digest = manifest_digest(registry_url, image_name, tag)
        except Exception as e:
            print(f"  Skip {image_name}:{tag}: {mask(str(e), secrets)}")
            continue
        if digest:
            protected.add(digest)
    if not protected:
        # Cannot tell friend from foe — better to leave the registry alone.
        print("  [WARN] No kept tag could be resolved; skipping cleanup.")
        return

    obsolete = [t for t in all_tags if t not in keep]
    if not obsolete:
        print(f"  No obsolete remote tags for {image_name}.")
        return

    deleted: set[str] = set()
    for tag in obsolete:
        try:
            digest = manifest_digest(registry_url, image_name, tag)
        except Exception as e:
            print(f"  Skip {image_name}:{tag}: {mask(str(e), secrets)}")
            continue
        if not digest:
            print(f"  Skip {image_name}:{tag}: no manifest digest")
            continue
        if digest in protected:
            print(f"  Keep {image_name}:{tag} (digest shared with a kept tag)")
            continue
        if digest in deleted:
            print(f"  Skip {image_name}:{tag}: digest already deleted")
            continue
        try:
            if delete_manifest(registry_url, image_name, digest):
                deleted.add(digest)
                print(f"  Deleted {image_name}:{tag}")
            else:
                print(f"  Delete {image_name}:{tag} -> unexpected status")
        except Exception as e:
            print(f"  Skip {image_name}:{tag}: {mask(str(e), secrets)}")


# ---------------------------------------------------------------------------
# local cleanup
# ---------------------------------------------------------------------------

def local_cleanup(host: str, sha: str, secrets: list[str], only: str | None = None):
    """Remove local obsolete tags and dangling images for this project."""
    images_to_clean = [i for i in IMAGES if only is None or i["name"] == only]
    for image_cfg in images_to_clean:
        name = image_cfg["name"]
        # list all local tags for this image
        cp = subprocess.run(
            ["docker", "images", f"{host}/{name}", "--format", "{{.Tag}}"],
            capture_output=True, text=True,
        )
        if cp.returncode != 0:
            continue
        keep = {sha, "latest"}
        for tag in cp.stdout.strip().splitlines():
            tag = tag.strip()
            if tag and tag not in keep:
                subprocess.run(["docker", "rmi", "-f", f"{host}/{name}:{tag}"],
                               capture_output=True)

    # dangling images
    subprocess.run(
        ["docker", "image", "prune", "-f"],
        capture_output=True,
    )


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=f"Rebuild {PROJECT}")
    parser.add_argument("--no-cache", action="store_true",
                        help="Force full rebuild without Docker layer cache")
    parser.add_argument("--skip-push", action="store_true",
                        help="Local build only (offline / debugging)")
    parser.add_argument("--only", type=str, metavar="NAME", default=None,
                        help="Build and push only a single image (e.g. nyaachat-shared)")
    args = parser.parse_args()

    env = load_env()
    host = env.get("PRIVATE_DOCKER_REGISTRY_HOST", "")
    url = env.get("PRIVATE_DOCKER_REGISTRY_URL", "")
    if not host:
        print("[ERROR] PRIVATE_DOCKER_REGISTRY_HOST not set in .env")
        sys.exit(1)
    if not url:
        # derive URL from host if not explicitly set
        url = f"http://{host}"

    secrets = [host, url]
    sha = get_git_sha()

    # filter images if --only is specified
    if args.only:
        targets = [i for i in IMAGES if i["name"] == args.only]
        if not targets:
            print(f"[ERROR] Unknown image name: {args.only}")
            print(f"  Valid names: {', '.join(i['name'] for i in IMAGES)}")
            sys.exit(1)
    else:
        targets = list(IMAGES)

    print(f"=== {PROJECT} rebuild ===")
    print(f"  SHA:       {sha}")
    print(f"  Registry:  <PRIVATE_REGISTRY>")
    if args.only:
        print(f"  Only:      {args.only}")
    print()

    # 1. registry health check
    if not args.skip_push:
        registry_health(url, secrets)

    # 2. build
    for image_cfg in targets:
        docker_build(host, image_cfg, sha, args.no_cache, secrets)

    if args.skip_push:
        print("--skip-push: done (local build only)")
        return

    # 3. push (sha + latest)
    for image_cfg in targets:
        name = image_cfg["name"]
        docker_push(host, name, sha, secrets)
        docker_push(host, name, "latest", secrets)

    # 4. registry keep-only-latest
    for image_cfg in targets:
        registry_cleanup(url, host, image_cfg["name"], sha, secrets)

    # 5. local cleanup
    local_cleanup(host, sha, secrets, args.only)

    print(f"\n=== {PROJECT} rebuild done ===")
    for image_cfg in targets:
        name = image_cfg["name"]
        print(f"Image: <PRIVATE_REGISTRY>/{name}:{sha}")
        print(f"       <PRIVATE_REGISTRY>/{name}:latest")


if __name__ == "__main__":
    main()
