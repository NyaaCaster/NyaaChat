# nyaachat-shared

NyaaChat 共享角色后端（账号、猫粮、共享角色库）。独立于前端容器部署、独立 rebuild。

- 技术栈：Node 20 + Express + better-sqlite3
- 端口：`5107`
- SSOT：`../.docs/shared-character-system.md`

## 部署与网络

两个 compose 项目（主前端 + 本后端）挂同一 external docker 网络 `nyaachat-net`，
主 nginx 反代 `/api/shared/` → `nyaachat-shared:5107`，前端全程同源访问，无跨端口/跨域问题。

先创建一次外部网络（仅首次）：

```bash
docker network create nyaachat-net
```

构建 / 重启本后端（**不要**手动拼 docker 命令，用 rebuild-shared）：

- Windows：`powershell -ExecutionPolicy Bypass -File .\rebuild-shared.ps1`
- Linux/macOS：`bash ./rebuild-shared.sh`

## 数据落盘（bind mount 到宿主大盘）

| 容器内路径 | 宿主路径 | 用途 |
| --- | --- | --- |
| `/data/db` | `E:\DockerRes\nyaachat-shared\db` | sqlite 数据库文件 |
| `/data/covers` | `E:\DockerRes\nyaachat-shared\covers` | 共享角色封面（纯 WebP，不内嵌角色 json） |

## Navicat 远程管理

sqlite 是文件而非网络服务。数据库文件位于宿主
`E:\DockerRes\nyaachat-shared\db\nyaachat-shared.db`，用 **Navicat for SQLite**
直接打开该文件即可查询 / 维护。密码按设计**明文**存储以便人工维护。

WAL 模式下读不阻塞写；用外部工具读取是安全的。维护脚本见 `sql/`。

## 健康检查

- 容器内：`GET /health`
- 经主站：`GET /api/shared/health`
