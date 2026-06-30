<#
.SYNOPSIS
Query NyaaChat shared-server SQLite user records with human-readable timestamps.

.DESCRIPTION
Reads the nyaachat-shared SQLite database (bind-mounted on host) and prints a
table of user accounts.  Timestamps are shown in Asia/Shanghai local time.

.PARAMETER Account
If provided, only show the matching account (exact match on the `account` column).

.PARAMETER ActiveOnly
If set, only show users whose last_active > 0 (have been active since the
last_active tracking feature was deployed).

.PARAMETER DbPath
Override the default database path.  Defaults to the production bind-mount
location configured in the project .env (SHARED_RES_DIR).

.EXAMPLE
.\scripts\query-users.ps1
# Show all users

.EXAMPLE
.\scripts\query-users.ps1 -Account nyaa
# Show only user "nyaa"

.EXAMPLE
.\scripts\query-users.ps1 -ActiveOnly
# Show only users who have been active
#>

param(
    [string]$Account,
    [switch]$ActiveOnly,
    [string]$DbPath = "E:\DockerRes\nyaachat-shared\db\nyaachat-shared.db"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if (-not (Test-Path $DbPath)) {
    Write-Error "Database not found: $DbPath"
    exit 1
}

# Build the query.  sqlite3 can only parse a single statement per call,
# so we concat with semicolons for the multi-step case.
$sql = @"
SELECT
  account,
  username,
  created_at,
  last_active
FROM users
WHERE 1=1
"@

if ($Account) {
    $sql += "`n  AND account = '$($Account -replace "'","''")'"
}
if ($ActiveOnly) {
    $sql += "`n  AND last_active > 0"
}

$sql += "`nORDER BY last_active DESC, created_at DESC;"

# Pipe to sqlite3.  Using --readonly for safety.
$result = $sql | sqlite3 -readonly -separator "`t" $DbPath 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Error "sqlite3 query failed: $result"
    exit $LASTEXITCODE
}

if (-not $result -or $result.Count -eq 0) {
    Write-Host "No matching users found."
    exit 0
}

# Parse TSV output into objects for formatting.
$users = $result | ForEach-Object {
    $parts = $_ -split "`t"
    if ($parts.Count -lt 4) { return }
    $created_ms  = [long]$parts[2]
    $last_ms     = [long]$parts[3]

    # Convert unix-ms → local datetime string.  .NET's
    # DateTimeOffset accounts for the system timezone (Asia/Shanghai).
    $created_fmt = if ($created_ms -gt 0) {
        [DateTimeOffset]::FromUnixTimeMilliseconds($created_ms).LocalDateTime.ToString("yyyy-MM-dd HH:mm:ss")
    } else { "-" }

    $last_fmt = if ($last_ms -gt 0) {
        [DateTimeOffset]::FromUnixTimeMilliseconds($last_ms).LocalDateTime.ToString("yyyy-MM-dd HH:mm:ss")
    } else { "(never)" }

    [PSCustomObject]@{
        Account    = $parts[0]
        Username   = $parts[1]
        Created    = $created_fmt
        LastActive = $last_fmt
    }
}

$users | Format-Table -AutoSize
