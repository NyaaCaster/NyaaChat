---
name: rebuild-shared
description: Rebuild the NyaaChat shared-character backend (nyaachat-shared, port 5107) Docker image and restart its container, independently of the frontend. Use whenever shared-server code, its Dockerfile, or docker-compose.shared.yml changes. Picks rebuild-shared.ps1 on Windows and rebuild-shared.sh on Linux/macOS, and always invokes PowerShell with -ExecutionPolicy Bypass.
---

# rebuild-shared

重新编译并重启**共享角色后端**（`nyaachat-shared`，端口 5107）。它与前端
（`rebuild` skill）相互独立，分别重启维护。

## 触发场景

- 改动了 `shared-server/` 下的后端源码、`shared-server/Dockerfile`、`package.json`。
- 改动了 `docker-compose.shared.yml`。
- 用户要求"重启共享后端"、"rebuild shared"、显式 `/rebuild-shared`。

> 注意：仅改动 `nginx.conf` 的 `/api/shared/` 反代或主 `docker-compose.yml` 的网络
> 配置时，要重启的是**前端**容器（用 `rebuild` skill），不是本后端。

## 选择脚本

| 系统环境 | 脚本 | 调用方式 |
| --- | --- | --- |
| Windows (`win32`) | `rebuild-shared.ps1` | `powershell -ExecutionPolicy Bypass -File .\rebuild-shared.ps1` |
| Linux / macOS / WSL | `rebuild-shared.sh` | `bash ./rebuild-shared.sh` |

`-ExecutionPolicy Bypass` 在 Windows 下**必须**带上。

## 外部网络

脚本会在构建前确保 external 网络 `nyaachat-net` 存在（不存在则创建）。该网络由本后端
与主前端 compose 共享，使主 nginx 能反代 `/api/shared/` → `nyaachat-shared:5107`。

## 数据落盘

sqlite 数据库与封面图通过 bind mount 落到宿主大盘
`E:\DockerRes\nyaachat-shared\{db,covers}`（可用 `SHARED_DB_DIR` /
`SHARED_COVERS_DIR` 覆盖）。rebuild 不影响这些持久化数据。

## 缓存策略

默认使用 Docker layer cache。仅在升级 base image、怀疑缓存损坏或用户明确要求
"完全重建"时追加 `-NoCache`（Windows）/ `--no-cache`（Linux/macOS）。

## 验证

构建后访问 `http://<host>:3095/api/shared/health` 或容器直连
`http://<host>:5107/health`，应返回 `{ "ok": true, "db": "ok" }`。
