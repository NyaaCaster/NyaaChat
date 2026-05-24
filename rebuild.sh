#!/bin/bash
set -e
COMPOSE_FILE="docker-compose.yml"

NO_CACHE=0
for arg in "$@"; do
    case "$arg" in
        --no-cache|-NoCache) NO_CACHE=1 ;;
    esac
done

if [ "$NO_CACHE" = "1" ]; then
    echo "Building image (no cache)..."
    docker compose -f $COMPOSE_FILE build --no-cache
else
    echo "Building image (using cache)..."
    docker compose -f $COMPOSE_FILE build
fi

# `up -d` recreates the container only when image hash or service
# config changed; volumes (image-cache) are preserved automatically.
# Saves the down/up dance vs an explicit `docker compose down`.
echo "Starting containers..."
docker compose -f $COMPOSE_FILE up -d

# Cleanup AFTER recreation — before recreation the old image is still
# held by the running container and `docker rmi` would fail with
# "image is being used".
echo "Removing dangling images..."
DANGLING=$(docker images -f "dangling=true" -q)
if [ -n "$DANGLING" ]; then docker rmi -f $DANGLING; fi

echo "Done. Running containers:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
