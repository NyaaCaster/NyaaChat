$ErrorActionPreference = "Stop"
$COMPOSE_FILE = "docker-compose.yml"

Write-Host "Stopping containers..." -ForegroundColor Cyan
docker compose -f $COMPOSE_FILE down

Write-Host "Rebuilding image..." -ForegroundColor Cyan
docker compose -f $COMPOSE_FILE build --no-cache

Write-Host "Removing dangling images..." -ForegroundColor Cyan
$dangling = docker images -f "dangling=true" -q
if ($dangling) { docker rmi -f $dangling }

Write-Host "Starting containers..." -ForegroundColor Cyan
docker compose -f $COMPOSE_FILE up -d

Write-Host "Done. Running containers:" -ForegroundColor Green
docker ps --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}"