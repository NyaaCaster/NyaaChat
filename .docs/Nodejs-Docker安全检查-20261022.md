# NyaaChat Node.js Docker 安全升级记录（2026-10-22）

## 完成状态

用户明确要求升级并发布 NyaaChat、NyaaChat-MCP、NyaaQiny-MCP、NyaaAcount；本项目已完成修改、隔离构建、镜像推送、macmini 部署及复核。其余项目未处理。本记录替代之前的只读初检状态。

Node.js 运行阶段从实测 v20.20.2 升级至 **v22.23.4**；所有 Node 构建阶段使用同一补丁版本。保留 Alpine 路线，NyaaChat 知识库保留 glibc 并明确为 `node:22.23.4-bookworm-slim`。前端最终镜像仍为 nginx，不含 Node.js。

选择 22 是为兼容现有原生依赖；官方生命周期显示 Node 20 于 2026-04-30 结束支持，Node 22 支持至 2027-04-30。Node 24 支持期更长，可在后续兼容性评估中采用。本次未声称 Node 20 已证实受特定 CVE 影响。

## 发布来源及方法

- 基线 Git SHA：`7fbcbe3`；独立维护标签：`7fbcbe3-node22-20261022`，以及 `latest`。
- 使用 HEAD 跟踪文件建立隔离构建目录，仅叠加本轮 Dockerfile 和发布脚本修改；NyaaChat 两个私有子仓分别从各自 HEAD 导出。主仓 FlagalacTemplates.ts 和两份 nyaacount-client.js 的既有业务改动未发布、未覆盖。
- 通过项目现有 `rebuild.py` 构建推送，增加 `--pull` 刷新基础镜像；使用 `--tag` 防止将未提交维护镜像伪装成原 SHA 的产物，`--skip-cleanup` 保留旧镜像。Qiny 使用 `--skip-env`。
- 注册表配置只在构建进程内读取原 `.env`；原始密钥未复制进隔离构建目录。NyaaChat 前端只从线上提取四个构建所需的公开显示/开关变量，未复制完整线上环境。
- 发布通过 macmini 既有 `restart.py --skip-cleanup`；已修正拉取失败后仍停服的问题，补齐 subprocess 的 check 参数。四套脚本的“拉取失败不执行停服/启动”模拟检查通过。
- 线上 `.env` 与 compose 文件和发布前副本逐字节一致；本次只同步 restart.py，未传输本机数据库。
- 部署时未执行 Git commit/push；后续用户已明确授权提交推送本轮源码维护改动，既有业务改动继续排除。镜像仍以本文记录的维护标签标识。

## macmini 复核证据

注册表维护标签与 latest 的 manifest digest 均已通过 HEAD 请求确认与实际容器镜像一致。所有下列容器 running，最终检查 RestartCount 均为 0。

| 容器 | 实际运行时 | manifest digest（已省略私有仓库地址） |
| --- | --- | --- |
| nyaachat-shared | v22.23.4 | `sha256:97e323b1b7fcb6f4531723ef49adca78c771c1bab24a14e3d7489de13afb1a07` |
| nyaachat-knowledge | v22.23.4 | `sha256:3bc0675ab6d9247a5102bf7b9755b23795d66db89f7a2feb779b078ae048572c` |
| nyaachat-ext-host-1 | v22.23.4 | `sha256:e53f6e25e9eddd5dedb8b7bc38c8e5eade3e09d79da3cb8f4ae38b25d6ef21de` |
| nyaachat-app-1 | nginx | `sha256:f5ee72e38949339eb0498ff8f373b8472379ad3827c3ccb42b3ac81073c3d40a` |

前端构建通过；本地类型检查、lint 通过（5 条已有 warning）；ext-host 6 项测试通过。macmini 的 shared/knowledge/ext-host 健康检查、前端 HTTP 200、两条 nginx 后端健康代理、知识库匿名访问 401 均通过。better-sqlite3 11.10.0 内存 SQL 与三个生产数据库只读 quick_check 均通过；sqlite-vec v0.1.9 加载、内存向量表插入与近邻查询通过。

此次验证未注册测试账号、未修改生产业务记录、未调用收费生成服务；不代表付费模型、登录注册、支付、完整对话等业务流程均已重测。临时预检容器均用 --rm、无网络、无生产数据挂载；向量写入只发生在内存库。

## 备份、回滚与清理

macmini `/root/DockerContainer/.node22-maint-20261022/NyaaChat/` 保留原 restart.py、compose、.env、baseline.json 和 deployed.json。目录权限 0700，含敏感信息的备份文件权限 0600，不进入 Git。本轮共对账号和 NyaaChat 的四份 .db 执行 SQLite online backup（包含 WAL 中已提交数据），没有仅复制活跃主数据库文件来冒充一致性备份。

旧镜像保留为 `node22-rollback/<容器名>:20261022`，baseline.json 记录原镜像 ID；本次未运行注册表清理或全局 image prune。若需回滚，在保留现有持久化卷与环境的情况下，以原镜像本地标签覆盖 compose 的 image，并设置 pull_policy: never 后重新创建；不可直接使用仍指向新镜像的 latest。数据库备份仅在确有需要时按停服恢复流程使用，不用旧备份覆盖正常新增数据。

最终 diff、Python 语法与敏感信息检查通过。删除临时目录的命令被自动审批策略阻断，隔离构建目录、一次性验证脚本和构建日志仍保留在 `E:\DockerRes\node22-maint-20261022`，清理尚未完成；正式发布镜像以及上述回滚/备份材料继续保留。其余项目和 Windows 本地服务容器未操作。

## 官方核对来源

2026-10-22 读取 Node.js 官方安全公告、发行索引、生命周期表，并确认 Docker 官方对应标签存在；Node 22 原生扩展 ABI 127 与 Node 20 的 ABI 115 不同，原生模块已在新版本重新安装/编译。

- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- https://nodejs.org/dist/index.json
- https://raw.githubusercontent.com/nodejs/Release/main/schedule.json
- Context7 `/nodejs/node` 的原生模块 ABI 文档。
