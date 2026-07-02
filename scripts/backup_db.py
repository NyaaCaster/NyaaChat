#!/usr/bin/env python3
"""
Back up the NyaaChat shared-server SQLite database to a timestamped snapshot.

The shared backend runs in WAL mode with a live container writing to it, so a
plain file copy of the .db file alone would miss uncommitted WAL frames and
produce an inconsistent/stale backup.  This tool uses SQLite's online backup
API (sqlite3.Connection.backup), which is safe against a live WAL database and
writes a single, self-contained, consistent .bak file.

Backups are written to the host big-disk under the project's Docker large-asset
convention (SHARED_RES_DIR/backups) so they don't clutter the live db dir.

Usage:
  python scripts/backup_db.py                          # back up to default dir
  python scripts/backup_db.py --db-path /path/to/db    # override source DB
  python scripts/backup_db.py --out-dir /path/backups  # override backup dir
"""

import argparse
import os
import sqlite3
import sys
from datetime import datetime

# Force UTF-8 stdout so CJK / special chars don't break on Windows GBK consoles.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def _shared_res_dir() -> str:
    """Resolve the host base dir for shared-backend persistent data."""
    shared_res = os.environ.get("SHARED_RES_DIR")
    if shared_res:
        return shared_res
    if sys.platform == "win32":
        return r"E:\DockerRes\nyaachat-shared"
    return os.path.expanduser("~/DockerRes/nyaachat-shared")


def _default_db_path() -> str:
    """Best-effort guess at the bind-mounted database location."""
    # Honour an explicit env var first (same var as query-users.py).
    env = os.environ.get("NYAACHAT_SHARED_DB")
    if env:
        return env
    return os.path.join(_shared_res_dir(), "db", "nyaachat-shared.db")


def _default_out_dir() -> str:
    """Default backup directory: host big-disk, alongside (not inside) db/."""
    return os.path.join(_shared_res_dir(), "backups")


def backup(db_path: str, out_dir: str) -> str:
    """Create a consistent, WAL-safe snapshot; return the backup file path."""
    if not os.path.isfile(db_path):
        print(f"Error: database not found: {db_path}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(out_dir, exist_ok=True)

    # Timestamp format mirrors AVG's backup_db.ps1: yyMMddHHmmss.
    timestamp = datetime.now().strftime("%y%m%d%H%M%S")
    backup_name = f"nyaachat-shared_{timestamp}.sqlite.bak"
    backup_path = os.path.join(out_dir, backup_name)

    # Open the source read-only so this tool can never mutate the live DB, and
    # use the online backup API for a consistent snapshot that folds in WAL.
    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        dst = sqlite3.connect(backup_path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()

    size_kb = os.path.getsize(backup_path) / 1024
    print("✓ 数据库备份成功!")
    print(f"  源数据库:   {db_path}")
    print(f"  备份文件:   {backup_name}")
    print(f"  备份目录:   {out_dir}")
    print(f"  文件大小:   {size_kb:.2f} KB")
    print(f"  备份时间:   {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    return backup_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Back up the NyaaChat shared-server SQLite database "
                    "(WAL-safe, timestamped)."
    )
    parser.add_argument(
        "--db-path", "-d",
        default=_default_db_path(),
        help="Path to the source SQLite database (default: auto-detect).",
    )
    parser.add_argument(
        "--out-dir", "-o",
        default=_default_out_dir(),
        help="Directory to write the timestamped backup into "
             "(default: SHARED_RES_DIR/backups).",
    )
    args = parser.parse_args()

    backup(args.db_path, args.out_dir)


if __name__ == "__main__":
    main()
