# NyaaChat

## 交流语言

默认始终以**简体中文**与用户交流，除非用户在某次对话中明确要求改用其他语言。

- 适用范围：所有面向用户的文字输出（解释、总结、提问、错误说明等）。
- 代码、标识符、命令行参数、文件路径、提交信息等仍按惯例使用英文。
- 即使用户的某条消息使用了英文，默认回复仍使用简体中文。

## 重新编译 Docker 镜像并重启容器

每当本项目需要重建镜像并重启容器（包括但不限于：用户明确要求 rebuild；改动了 `Dockerfile` / `docker-compose.yml` / `nginx.conf`；改动了影响镜像内静态资源的前端代码），必须通过 `rebuild` skill 来执行，不要手动拼 `docker compose` 命令。

- 所有平台统一使用：`python rebuild.py`（默认有缓存）/ `python rebuild.py --no-cache`（无缓存）。
- 共享后端独立重建使用：`python rebuild-shared.py` / `python rebuild-shared.py --no-cache`。
- 详细规则见 `.claude/skills/rebuild/SKILL.md` 和 `.claude/skills/rebuild-shared/SKILL.md`。

## 三仓库结构（拆分后）

NyaaChat 目录下现在是**三个各自独立的 Git 仓库**，共用同一份工作树（详见 memory `nyaachat-three-repo-split`）：

| 仓库根 | 类型 | remote |
| --- | --- | --- |
| `NyaaChat/`（主仓） | 公开 | `github.com/NyaaCaster/NyaaChat.git` |
| `NyaaChat/nyaachat-knowledge/` | 私有（专利） | `github.com/NyaaCaster/NyaaChat-knowledge-server.git` |
| `NyaaChat/shared-server/` | 私有（专利） | `github.com/NyaaCaster/NyaaChat-shared-server.git` |

- 主仓 `.gitignore` **已忽略** `/nyaachat-knowledge/` 和 `/shared-server/`——在主仓根跑 `git status` **看不到**这两个子目录的改动。
- 三仓库**分开提交、分开推送**，各有各的 `origin master`。
- 改子服务代码必须 `cd` 进对应子目录（或用 `git -C <子目录>`）再执行 git 操作。
- Docker 构建 / `rebuild*.py` 照旧从**主仓根**运行，不受拆分影响（`build:` 走磁盘相对路径）。

## Git 提交与推送

每当用户明确要求"提交"、"commit"、"推送"、"push"、"上传到 GitHub"等，使用 `commit-push` skill 完成（该 skill 已统管三仓）。要点：

- **未经用户明确请求，绝不自动 commit / push**。
- **先辨识改动属于哪个仓库**（主仓 / knowledge / shared），进入对应仓库根再操作；一次提交只针对一个仓库，跨仓改动分别走完整流程。
- 提交信息使用 **Conventional Commits**（英文，小写起首），与仓库历史风格一致；**不**附加 `Co-Authored-By` 行。
- 始终用 `git add <file>` 明确指定文件，**禁止** `git add -A` / `git add .`。子仓的 `.env`（含密钥）绝不入库。
- 严禁：force push、`--amend` 已推送的 commit、`--no-verify`、修改 `git config`、`reset --hard` 等高破坏性操作（除非用户显式同意）。
- 详细规则见 `.claude/skills/commit-push/SKILL.md`。

## Vibo Coding 工作规范

> 本项目为 Nyaa 主要长期维护项目，适用"**部分适用**"级别——跳过初始设计和审核阶段，从当前 P 阶段续接。

### 版本与阶段（V + P）

- **V（闭环版本）**：一个对外可用、功能闭环的版本。
- **P（功能模块阶段）**：一个 V 内部按功能模块拆分的最小交付单元，每个 P 必须**可独立验证、可独立提交**。

### Plan 模式开发

所有 P 阶段的增量开发工作在 **plan 模式**下进行：
1. 针对当前 P 阶段用 `EnterPlanMode` 进入 plan 模式
2. 明确本 P 的实现方案、涉及文件、验证步骤
3. 用户批准 plan 后执行实现
4. 完成验证后用 `rebuild` skill 重建容器

### P 阶段收尾（每 P 必做）

每个 P 阶段完成后，**必须**执行：

1. **Git 提交与推送** — 通过 `commit-push` skill，提交前必须做 `git status` 和 secret 检查
2. **更新或创建交接文档** — 落于 `.docs/阶段交接-XXX.md`，包含以下章节：
   - 交接目的 + 必读文档列表
   - 当前进度（本 P 完成了什么）
   - 本轮已修复/已实现（按文件列出）
   - 仍需验证/已知问题
   - **续接提示词**（可直接粘贴给新对话的提示词，约 10-20 行，含必读文档、当前进度、下一步行动、关键约束）
3. **更新 Memory** — 关键节点写入 memory 跟踪进度

### 跨对话接续

新对话继续开发 NyaaChat 时：读取本 CLAUDE.md → 读取最新交接文档 → 根据"续接提示词"确定下一步 → plan 模式进入。
