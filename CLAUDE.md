# NyaaChat

## 交流语言

默认始终以**简体中文**与用户交流，除非用户在某次对话中明确要求改用其他语言。

- 适用范围：所有面向用户的文字输出（解释、总结、提问、错误说明等）。
- 代码、标识符、命令行参数、文件路径、提交信息等仍按惯例使用英文。
- 即使用户的某条消息使用了英文，默认回复仍使用简体中文。

## 重新编译 Docker 镜像并重启容器

每当本项目需要重建镜像并重启容器（包括但不限于：用户明确要求 rebuild；改动了 `Dockerfile` / `docker-compose.yml` / `nginx.conf`；改动了影响镜像内静态资源的前端代码），必须通过 `rebuild` skill 来执行，不要手动拼 `docker compose` 命令。

- Windows 环境：执行 `powershell -ExecutionPolicy Bypass -File .\rebuild.ps1`。
- Linux / macOS 环境：执行 `bash ./rebuild.sh`。
- `-ExecutionPolicy Bypass` 参数在 Windows 下**必须**带上，避免本机执行策略拦截。
- 详细规则见 `.claude/skills/rebuild/SKILL.md`。

## Git 提交与推送

每当用户明确要求"提交"、"commit"、"推送"、"push"、"上传到 GitHub"等，使用 `commit-push` skill 完成。要点：

- **未经用户明确请求，绝不自动 commit / push**。
- 提交信息使用 **Conventional Commits**（英文，小写起首），与仓库历史风格一致；**不**附加 `Co-Authored-By` 行。
- 始终用 `git add <file>` 明确指定文件，**禁止** `git add -A` / `git add .`。
- 严禁：force push、`--amend` 已推送的 commit、`--no-verify`、修改 `git config`、`reset --hard` 等高破坏性操作（除非用户显式同意）。
- 详细规则见 `.claude/skills/commit-push/SKILL.md`。
