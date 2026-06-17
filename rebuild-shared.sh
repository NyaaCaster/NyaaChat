#!/bin/bash
set -e

# Rebuild + restart the NyaaChat shared-character backend (nyaachat-shared),
# independently of the frontend. See .docs/shared-character-system.md.

COMPOSE_FILE="docker-compose.shared.yml"

NO_CACHE=0
for arg in "$@"; do
    case "$arg" in
        --no-cache|-NoCache) NO_CACHE=1 ;;
    esac
done

# The external network is shared with the main compose project. Create it once;
# ignore the error if it already exists.
if ! docker network ls --filter "name=^nyaachat-net$" --format "{{.Name}}" | grep -q nyaachat-net; then
    echo "Creating external network nyaachat-net..."
    docker network create nyaachat-net
fi

if [ "$NO_CACHE" = "1" ]; then
    echo "Building shared backend (no cache)..."
    docker compose -f $COMPOSE_FILE build --no-cache
else
    echo "Building shared backend (using cache)..."
    docker compose -f $COMPOSE_FILE build
fi

echo "Starting shared backend..."
docker compose -f $COMPOSE_FILE up -d

echo "Removing dangling images..."
DANGLING=$(docker images -f "dangling=true" -q)
if [ -n "$DANGLING" ]; then docker rmi -f $DANGLING; fi

echo "Done. Running containers:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
