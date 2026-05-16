#!/bin/bash
set -e
COMPOSE_FILE="docker-compose.yml"

echo "Stopping containers..."
docker compose -f $COMPOSE_FILE down

echo "Rebuilding image..."
docker compose -f $COMPOSE_FILE build --no-cache

echo "Removing dangling images..."
DANGLING=$(docker images -f "dangling=true" -q)
if [ -n "$DANGLING" ]; then docker rmi -f $DANGLING; fi

echo "Starting containers..."
docker compose -f $COMPOSE_FILE up -d

echo "Done. Running containers:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"