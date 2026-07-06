---
name: commit-push
description: Create a git commit and optionally push to origin/master for the NyaaChat workspace — this covers three independent repos that share this working tree: the main NyaaChat repo, and the two private sub-service repos nyaachat-knowledge/ and shared-server/. Trigger when the user explicitly asks to commit, push, "提交", "推送", or "上传到 GitHub". Always identify which of the three repos the changes belong to first. Follows Conventional Commits style, never auto-commits without an explicit request, and refuses destructive operations (force-push, --no-verify, --amend on pushed commits, git config changes).
---

# commit-push

为 NyaaChat 工作树中的**三个独立 Git 仓库**执行 `git commit` 以及可选的 `git push origin master`。

## 三仓库结构（拆分后，必读）

NyaaChat 目录下现在有**三个各自独立**的 Git 仓库（详见 memory `nyaachat-three-repo-split`）：

| 仓库根 | 类型 | remote |
| --- | --- | --- |
| `NyaaChat/`（主仓） | 公开 | `NyaaChat.git` |
| `NyaaChat/nyaachat-knowledge/` | 私有 | `NyaaChat-knowledge-server.git` |
| `NyaaChat/shared-server/` | 私有 | `NyaaChat-shared-server.git` |

- 主仓的 `.gitignore` **已忽略** `/nyaachat-knowledge/` 和 `/shared-server/`——在主仓根跑 `git status` **看不到**这两个子目录里的任何改动。
- 三仓库**分开提交、分开推送**，各有各的 `origin master`。
- 子服务改动必须**在对应子目录内**执行 git 操作（`cd` 进去，或用 `git -C <子目录>`）。

## 触发条件

**只在用户明确要求时调用**，例如：
- "帮我提交"、"commit 一下"、"提交这些改动"
- "推送到 GitHub"、"push 到远端"、"上传"
- 显式调用 `/commit-push`

**严禁**在用户没有明确要求的情况下自动 commit 或 push——哪怕本轮对话刚改完一堆代码。

## 提交信息风格（必须遵守仓库现有约定）

仓库历史采用 **Conventional Commits**（英文）：

| 类型     | 含义                                |
| -------- | ----------------------------------- |
| `feat:`  | 新功能或现有功能的增强              |
| `fix:`   | bug 修复                            |
| `chore:` | 构建、配置、辅助脚本等非业务改动    |
| `docs:`  | 仅文档变动（README、注释除外）      |
| `refactor:` | 不改变行为的重构                 |
| `init:`  | 仅初始化提交时使用                  |

写作规则：
- 主语全部使用**英文**（CLAUDE.md 明确：提交信息按英文惯例）。
- `type:` 后跟空格和小写起首的简短描述。
- 多项改动可用逗号合并到一行：`feat: file attachments, paste support, favicon`。
- 主语短小（≤ 72 字符）；如需详述，在空行后写正文。
- **不附加 `Co-Authored-By` 行**——仓库历史中所有提交都没有，保持一致。

参考最近的真实提交：
```
feat: support OpenAI and Anthropic API formats
feat: attachment fix, rebuild.sh for Linux, expose rebuild scripts in git
chore: add .gitattributes to enforce LF line endings
```

## 标准流程

### 0. 确定目标仓库（三仓拆分后必做的第一步）

在任何 git 操作之前，先弄清用户要提交的改动**属于哪个仓库**：

1. 判断改动位置：
   - 改动在 `nyaachat-knowledge/` 内 → 目标是 **knowledge 私有仓**，`cd nyaachat-knowledge`。
   - 改动在 `shared-server/` 内 → 目标是 **shared 私有仓**，`cd shared-server`。
   - 其余（前端 `src/`、compose、rebuild 脚本、根级文档等）→ 目标是 **主仓 NyaaChat**。
2. 进入目标仓库根后，跑 `git rev-parse --show-toplevel` 和 `git remote get-url origin` **确认**当前确实在预期的仓库、remote 指向正确。
3. ⚠️ **在主仓根跑 `git status` 看不到子仓改动**（已被 gitignore）。如果用户说"提交 knowledge/shared 的改动"却在主仓看不到，别误判为"无改动"——是走错仓库了，先 `cd` 进对应子目录。
4. 一次提交只针对**一个**仓库。若本轮改动横跨多个仓库，逐个仓库分别走完整流程（各自 commit、各自 push），并在汇报时分别说明。

### 1. 提交前侦查（在目标仓库根内并行执行）

```
git status                       # 不要用 -uall
git diff                         # 已暂存 + 未暂存
git diff --cached                # 仅已暂存
git log --pretty=format:"%h %s" -n 5
```

目标：
- 看清将要进入提交的全部改动。
- 确认风格与最近 5 条 commit 一致。
- 发现意外文件（见下方"绝不提交"）。

### 2. 暂存

- **始终按文件名显式 `git add <file> <file>`**，禁止 `git add -A` / `git add .` / `git add -u`。
- 如果用户已经手动 `git add` 过，直接沿用，不要重复加。

### 3. 起草提交信息

- 按上节风格起草，先看 `git log` 确保动词、大小写、用词与近邻提交协调。
- 描述聚焦"为什么"和"带来什么"，而不是逐文件罗列"动了什么"。
- 多行信息**必须**用 HEREDOC 传入，避免 PowerShell/Bash 的引号转义出错：

```bash
git commit -m "$(cat <<'EOF'
feat: short subject line

Optional body explaining the why.
EOF
)"
```

### 4. 推送（仅在用户要求时）

- 默认目标：目标仓库的 `origin master`（三仓都是单活跃分支 master）。推送前先确认当前所在仓库的 `origin`（第 0 步已确认）指向预期的那个 GitHub 仓库，别把私有仓内容推到公开仓、或反之。
- 推送前**必须**与用户二次确认，特别是包含：构建配置、Dockerfile、`docker-compose.yml`、依赖锁文件、大量删除的提交。
- 标准命令：`git push origin master`（在目标仓库根内执行，或 `git -C <目标仓库> push origin master`）。
- 推送完成后跑一次 `git status` 验证本地与远端一致。

## 绝不提交（pre-check 清单）

如 `git status` 显示这些文件出现在暂存区或未跟踪区，**先停下来询问用户**，不要自动加入：

- `.env`、`.env.*`（三仓的 `.gitignore` 均已排除，例外是 `.env.example`）。⚠️ **两个私有子仓各有含密钥的 `.env`**（`nyaachat-knowledge/.env`、`shared-server/.env`），绝不能进任何仓库——提交子仓前务必确认它处于 ignored 状态。
- 任何含 token / API key / 密码字面值的文件
- `node_modules/`、`dist/`、`build/`、`coverage/`、`src/temp/`、`*.log`（均已被 `.gitignore` 排除）
- 子仓的本地数据目录：`shared-server/data/`、`nyaachat-knowledge/data/`、`*.db`（sqlite，已被各自 `.gitignore` 排除）
- 大体积二进制（> 5 MB），除非用户确认
- 含 IDE 配置、临时调试代码、个人路径的文件

**永远用 `git add <file>` 显式指定文件，禁止 `git add -A` / `git add .` / `git add -u`**——这是防止 `.env` 等敏感文件误入仓库的第一道闸。

## 绝不做的操作

未经用户**显式书面同意**前：

- ❌ `git push --force` / `--force-with-lease` 到 `master`
- ❌ `git commit --amend`（尤其是已推送的提交）
- ❌ `git reset --hard` / `git checkout .` / `git clean -fd`
- ❌ `git rebase`（任何形式）
- ❌ `--no-verify`、`--no-gpg-sign`（绕过 hook / 签名）
- ❌ 修改 `git config`（用户名、邮箱、远端、hooks 等）
- ❌ 删除分支 / 标签

遇到 pre-commit hook 失败，**不要**用 `--amend` 修复——先解决 hook 报的问题，重新 `git add` 后**新建**一个 commit。

## 创建 Pull Request（如适用）

本项目当前是单分支直推流；如用户要求改用 PR 流程：

1. 新建特性分支：`git checkout -b feat/<short-name>`
2. 提交、推送：`git push -u origin feat/<short-name>`
3. 用 `gh pr create` 创建 PR，标题用 Conventional Commits 风格，body 使用 HEREDOC。
4. PR body 不附加 "🤖 Generated with Claude Code" 之类的水印——与仓库无水印的提交风格一致。

## 给用户的最终汇报

成功 commit / push 后，简短汇报：
- 提交哈希前 7 位和主语
- 是否已推送、本地与远端状态是否一致
- 任何被跳过的文件以及原因
