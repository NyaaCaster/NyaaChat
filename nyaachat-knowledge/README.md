# nyaachat-knowledge

NyaaChat 用户级知识库（RAG）后端。独立于前端和 shared-server 部署、独立 rebuild。

- 技术栈：Node 20 + Express + better-sqlite3 + sqlite-vec
- 端口：`5108`
- SSOT：`../.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md`

## 部署与网络

三个 compose 项目（主前端 + shared-server + 本后端）挂同一 external docker 网络 `nyaachat-net`，
主 nginx 反代 `/api/knowledge/` → `nyaachat-knowledge:5108`，前端全程同源访问。

先创建一次外部网络（仅首次）：

```bash
docker network create nyaachat-net
```

构建 / 重启本后端（不要手动拼 docker 命令，用 rebuild-knowledge）：

```
python rebuild-knowledge.py
```

## 数据落盘（bind mount 到宿主大盘）

| 容器内路径 | 宿主路径 | 用途 |
| --- | --- | --- |
| `/data/db` | `E:\DockerRes\nyaachat-knowledge\db` | SQLite 数据库 + 向量库 |

## 鉴权

Session token 鉴权，从 shared-server 的 SQLite DB（只读挂载）读取 sessions 表验证。
用户身份（account）经 shared-server 登录流程签发，knowledge 服务不需要独立的注册/登录。

## Navicat 远程管理

数据库文件位于宿主 `E:\DockerRes\nyaachat-knowledge\db\nyaachat-knowledge.db`，
用 **Navicat for SQLite** 直接打开该文件即可查询 / 维护。

## 健康检查

- 容器内：`GET /health`
- 经主站：`GET /api/knowledge/health`
