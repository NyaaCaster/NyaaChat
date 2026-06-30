#!/usr/bin/env python3
"""
Query NyaaChat shared-server SQLite user records with human-readable timestamps.

Reads the nyaachat-shared SQLite database (bind-mounted on host) and prints a
table of user accounts.  Timestamps are shown in the local timezone.

Usage:
  python scripts/query-users.py                       # all users
  python scripts/query-users.py --active-only          # only users with last_active > 0
  python scripts/query-users.py --account nyaa         # exact account match
  python scripts/query-users.py --username alex        # partial username (LIKE)
  python scripts/query-users.py --db-path /path/to/db  # override DB location
"""

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timezone

# Force UTF-8 stdout so CJK / special chars don't break on Windows GBK consoles.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _default_db_path() -> str:
    """Best-effort guess at the bind-mounted database location."""
    # Honour an explicit env var first.
    env = os.environ.get("NYAACHAT_SHARED_DB")
    if env:
        return env

    # SHARED_RES_DIR from docker-compose.shared.yml
    shared_res = os.environ.get("SHARED_RES_DIR")
    if shared_res:
        return os.path.join(shared_res, "db", "nyaachat-shared.db")

    # Platform-specific fallbacks matching the project's docker-compose convention.
    if sys.platform == "win32":
        return r"E:\DockerRes\nyaachat-shared\db\nyaachat-shared.db"
    # Linux / macOS — common convention.
    return os.path.expanduser("~/DockerRes/nyaachat-shared/db/nyaachat-shared.db")


def _fmt_ms(ms: int) -> str:
    """Convert a Unix-ms timestamp to local datetime string, or a placeholder."""
    if ms <= 0:
        return "(never)"
    dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
    local = dt.astimezone()  # system local timezone
    return local.strftime("%Y-%m-%d %H:%M:%S")


def query_users(
    db_path: str,
    account: str | None,
    username: str | None,
    active_only: bool,
) -> list[dict]:
    """Return matching user rows as dicts with formatted timestamps."""
    if not os.path.isfile(db_path):
        print(f"Error: database not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    sql = """
        SELECT account, username, created_at, last_active
        FROM users
        WHERE 1=1
    """
    params: list = []

    if account:
        sql += " AND account = ?"
        params.append(account)
    if username:
        sql += " AND username LIKE ? ESCAPE '\\'"
        # Escape the built-in LIKE wildcards so user input like "50%" is literal.
        escaped = username.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params.append(f"%{escaped}%")
    if active_only:
        sql += " AND last_active > 0"

    sql += " ORDER BY last_active DESC, created_at DESC"

    cur.execute(sql, params)
    rows = cur.fetchall()
    conn.close()

    results: list[dict] = []
    for row in rows:
        results.append({
            "account": row["account"],
            "username": row["username"],
            "created": _fmt_ms(row["created_at"]),
            "last_active": _fmt_ms(row["last_active"]),
        })
    return results


def _print_table(rows: list[dict]) -> None:
    """Print a simple aligned table to stdout."""
    if not rows:
        print("No matching users found.")
        return

    # column widths
    cols = ("account", "username", "created", "last_active")
    headers = ("Account", "Username", "Created", "LastActive")
    widths = [len(h) for h in headers]

    for r in rows:
        for i, c in enumerate(cols):
            widths[i] = max(widths[i], len(r[c]))

    # Header
    line = "  ".join(headers[i].ljust(widths[i]) for i in range(len(headers)))
    print(line)
    print("-" * len(line))

    # Rows
    for r in rows:
        print("  ".join(r[cols[i]].ljust(widths[i]) for i in range(len(cols))))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Query NyaaChat shared-server user records."
    )
    parser.add_argument(
        "--account", "-a",
        help="Show only the given account (exact match).",
    )
    parser.add_argument(
        "--username", "-u",
        help="Filter by username (partial, case-insensitive LIKE match).",
    )
    parser.add_argument(
        "--active-only", "-A",
        action="store_true",
        help="Show only users whose last_active > 0.",
    )
    parser.add_argument(
        "--db-path", "-d",
        default=_default_db_path(),
        help="Path to the SQLite database (default: auto-detect).",
    )
    args = parser.parse_args()

    rows = query_users(args.db_path, args.account, args.username, args.active_only)
    _print_table(rows)


if __name__ == "__main__":
    main()
