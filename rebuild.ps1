param(
    [switch]$NoCache
)

$ErrorActionPreference = "Stop"
$COMPOSE_FILE = "docker-compose.yml"

Write-Host "Generating extension registry..." -ForegroundColor Cyan
node .\scripts\generate-extension-registry.mjs

if ($NoCache) {
    Write-Host "Building image (no cache)..." -ForegroundColor Cyan
    docker compose -f $COMPOSE_FILE build --no-cache
} else {
    Write-Host "Building image (using cache)..." -ForegroundColor Cyan
    docker compose -f $COMPOSE_FILE build
}

# `up -d` recreates the container only when image hash or service
# config changed; volumes (image-cache) are preserved automatically.
# Saves the down/up dance vs an explicit `docker compose down`.
Write-Host "Starting containers..." -ForegroundColor Cyan
docker compose -f $COMPOSE_FILE up -d

# Cleanup AFTER recreation — before recreation the old image is still
# held by the running container and `docker rmi` would fail with
# "image is being used".
Write-Host "Removing dangling images..." -ForegroundColor Cyan
$dangling = docker images -f "dangling=true" -q
if ($dangling) { docker rmi -f $dangling }

Write-Host "Done. Running containers:" -ForegroundColor Green
docker ps --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}"
