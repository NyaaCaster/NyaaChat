#!/usr/bin/env python3
"""
P7-3 migration: add users.nyaa_uid and backfill it from NyaaAcount.

NyaaChat's login key is `account` (not the display-only `username`), and P6
imported those accounts into NyaaAcount as unified login names — so the
backfill resolves each local account via GET /api/project/uid?username=<account>
(Bearer project token, plaintext query per the NyaaAcount convention).

Run with the nyaachat-shared container STOPPED (single writer, no WAL races):

  python scripts/migrate_add_nyaa_uid.py                   # add column/index + backfill
  python scripts/migrate_add_nyaa_uid.py --drop-passwords  # phase 2: after E2E passes,
                                                           # blank all local passwords

The password column stays NOT NULL (rebuilding a table that four FK-anchored
tables reference is not worth it), so "dropping" a password means setting it
to '' — the credential itself lives in NyaaAcount from P7-3 on.

Any account that fails to resolve is listed and the script exits non-zero;
do NOT proceed to --drop-passwords in that case.

Reads NYAAACOUNT_PUBLIC_URL / NYAAACOUNT_API_TOKEN from the project .env
(same values the shared container gets via docker-compose.shared.yml).
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import urllib.parse
import urllib.request

# Force UTF-8 stdout so CJK / special chars don't break on Windows GBK consoles.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _shared_res_dir() -> str:
    """Resolve the host base dir for shared-backend persistent data."""
    shared_res = os.environ.get("SHARED_RES_DIR")
    if shared_res:
        return shared_res
    if sys.platform == "win32":
        return r"E:\DockerRes\nyaachat-shared"
    return os.path.expanduser("~/DockerRes/nyaachat-shared")


def _default_db_path() -> str:
    env = os.environ.get("NYAACHAT_SHARED_DB")
    if env:
        return env
    return os.path.join(_shared_res_dir(), "db", "nyaachat-shared.db")


def _load_env() -> dict:
    """Minimal .env parser — KEY=VALUE lines, # comments, no quoting rules."""
    vals = {}
    path = os.path.join(PROJECT_ROOT, ".env")
    if not os.path.isfile(path):
        return vals
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line.strip())
            if m:
                vals[m.group(1)] = m.group(2)
    return vals


def get_uid_by_username(base_url: str, token: str, username: str):
    """GET /api/project/uid?username= → (status, data|None)."""
    url = f"{base_url}/api/project/uid?username={urllib.parse.quote(username)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, None
    except Exception as e:
        print(f"  ! 请求失败: {e}", file=sys.stderr)
        return 0, None


def ensure_column(db: sqlite3.Connection) -> None:
    cols = [r[1] for r in db.execute("PRAGMA table_info(users)")]
    if "nyaa_uid" in cols:
        print("- 字段已存在: nyaa_uid")
    else:
        db.execute("ALTER TABLE users ADD COLUMN nyaa_uid INTEGER")
        print("✓ 已添加字段: nyaa_uid")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nyaa_uid ON users(nyaa_uid)")
    db.commit()
    print("✓ nyaa_uid 唯一索引已就绪")


def backfill(db: sqlite3.Connection, base_url: str, token: str) -> bool:
    rows = db.execute(
        "SELECT account FROM users WHERE nyaa_uid IS NULL"
    ).fetchall()
    print(f"\n待回填用户: {len(rows)} 个（按 account 匹配统一登录名）")

    missing = []
    filled = 0
    for (account,) in rows:
        status, data = get_uid_by_username(base_url, token, account)
        if status == 200 and data and data.get("uid"):
            db.execute("UPDATE users SET nyaa_uid = ? WHERE account = ?", (data["uid"], account))
            filled += 1
            print(f"  ✓ {account} → nyaa_uid={data['uid']}")
        else:
            missing.append(account)
            print(f"  ✗ {account} 未命中: status={status} {data}")
    db.commit()

    total = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    linked = db.execute("SELECT COUNT(*) FROM users WHERE nyaa_uid IS NOT NULL").fetchone()[0]
    print(f"\n回填结果: 本次 {filled} 个；总计 {linked}/{total} 已链接")

    if missing:
        print(f"\n❌ {len(missing)} 个账号未能回填，请先在 NyaaAcount 侧核对后重跑", file=sys.stderr)
        return False
    print("✅ 全部用户已链接 nyaa_uid")
    return True


def drop_passwords(db: sqlite3.Connection) -> bool:
    unlinked = db.execute("SELECT COUNT(*) FROM users WHERE nyaa_uid IS NULL").fetchone()[0]
    if unlinked:
        print(f"❌ 仍有 {unlinked} 个用户没有 nyaa_uid，拒绝弃存密码", file=sys.stderr)
        return False
    cur = db.execute("UPDATE users SET password = '' WHERE password != ''")
    db.commit()
    print(f"✅ 已弃存本地密码: {cur.rowcount} 行置 ''（登录改经 NyaaAcount 校验）")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="P7-3: add + backfill users.nyaa_uid")
    parser.add_argument("--db-path", default=_default_db_path())
    parser.add_argument("--drop-passwords", action="store_true",
                        help="phase 2: blank local passwords once every row is linked")
    args = parser.parse_args()

    if not os.path.isfile(args.db_path):
        print(f"Error: database not found: {args.db_path}", file=sys.stderr)
        sys.exit(1)

    env = _load_env()
    base_url = env.get("NYAAACOUNT_PUBLIC_URL", "").rstrip("/")
    token = env.get("NYAAACOUNT_API_TOKEN", "")
    if not args.drop_passwords and (not base_url or not token):
        print("Error: NYAAACOUNT_PUBLIC_URL / NYAAACOUNT_API_TOKEN 未配置（.env）", file=sys.stderr)
        sys.exit(1)

    db = sqlite3.connect(args.db_path)
    try:
        if args.drop_passwords:
            ok = drop_passwords(db)
        else:
            ensure_column(db)
            ok = backfill(db, base_url, token)
    finally:
        db.close()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
