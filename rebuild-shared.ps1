param(
    [switch]$NoCache
)

# Rebuild + restart the NyaaChat shared-character backend (nyaachat-shared),
# independently of the frontend. See .docs/shared-character-system.md.

$ErrorActionPreference = "Stop"
$COMPOSE_FILE = "docker-compose.shared.yml"

# The external network is shared with the main compose project. Create it once;
# `network create` errors if it already exists, so ignore that case.
$existing = docker network ls --filter "name=^nyaachat-net$" --format "{{.Name}}"
if (-not $existing) {
    Write-Host "Creating external network nyaachat-net..." -ForegroundColor Cyan
    docker network create nyaachat-net | Out-Null
}

if ($NoCache) {
    Write-Host "Building shared backend (no cache)..." -ForegroundColor Cyan
    docker compose -f $COMPOSE_FILE build --no-cache
} else {
    Write-Host "Building shared backend (using cache)..." -ForegroundColor Cyan
    docker compose -f $COMPOSE_FILE build
}

Write-Host "Starting shared backend..." -ForegroundColor Cyan
docker compose -f $COMPOSE_FILE up -d

Write-Host "Removing dangling images..." -ForegroundColor Cyan
$dangling = docker images -f "dangling=true" -q
if ($dangling) { docker rmi -f $dangling }

Write-Host "Done. Running containers:" -ForegroundColor Green
docker ps --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}"
