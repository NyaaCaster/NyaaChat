---
name: rebuild
description: Rebuild the NyaaChat Docker image and restart containers. Use this whenever the project needs a Docker rebuild + restart (e.g., after Dockerfile, nginx.conf, docker-compose.yml, or built frontend asset changes). Picks rebuild.ps1 on Windows and rebuild.sh on Linux/macOS, and always invokes PowerShell with `-ExecutionPolicy Bypass`.
---

# rebuild

本项目需要重新编译 Docker 镜像并重启容器时调用此 skill。

## 触发场景

- 用户明确要求"重新编译"、"重建镜像"、"重启容器"、"rebuild"。
- 改动了 `Dockerfile`、`docker-compose.yml`、`nginx.conf` 等容器构建相关文件。
- 改动了前端构建产物所依赖的源码或配置，需要让镜像内的静态资源同步更新。
- 通过 `/rebuild` 显式调用。

## 选择脚本

根据当前会话所在系统选择脚本，**不要混用**：

| 系统环境                       | 使用的脚本     | 调用方式                                                       |
| ------------------------------ | -------------- | -------------------------------------------------------------- |
| Windows (`win32`)              | `rebuild.ps1`  | `powershell -ExecutionPolicy Bypass -File .\rebuild.ps1`       |
| Linux / macOS / WSL            | `rebuild.sh`   | `bash ./rebuild.sh`                                            |

判断依据优先级：
1. 环境信息中的 `Platform`（如 `win32` → PowerShell）。
2. 当前可用的 shell（PowerShell 工具可用 → Windows；仅 Bash → Linux/macOS）。

## 关于 `-ExecutionPolicy Bypass`

该参数传给 **PowerShell 进程本身**（不是 `rebuild.ps1` 脚本的参数），作用是临时绕过本机的脚本执行策略（Execution Policy）。

- **作用范围**：只对当前这次 `powershell` / `pwsh` 进程生效，进程结束即失效；不修改注册表，也不影响系统其他脚本。
- **为什么必须带**：`rebuild.ps1` 是本仓库里**未签名**的本地脚本。在默认策略为 `Restricted`（Windows 客户端默认）或 `AllSigned` 的机器上直接 `.\rebuild.ps1` 会报 *"running scripts is disabled on this system"* 而无法启动。带上 `-ExecutionPolicy Bypass` 后，无论目标机器当前策略是什么，脚本都能正常运行。
- **不需要管理员权限**，普通用户即可使用。
- **优先级**：高于本机已配置的策略；唯一无法覆盖的是通过组策略（`MachinePolicy` / `UserPolicy`）强制下发的策略。
- **安全边界**：执行策略本身不是安全边界（微软官方说法），只能挡住误操作。对**本仓库自己维护**的脚本使用 `Bypass` 是合理且常见的；但**不要**把这个习惯应用到来源不明的第三方 `.ps1` 上——执行前应先审阅其内容。

## 执行规则

- **必须**带 `-ExecutionPolicy Bypass` 参数运行 `rebuild.ps1`，避免被本机执行策略拦截。
- 用 `PowerShell` 工具（Windows）或 `Bash` 工具（Linux/macOS）直接执行；不要把两者混在一条命令里。
- 完整命令示例：
  - Windows: `powershell -ExecutionPolicy Bypass -File .\rebuild.ps1`
  - Linux/macOS: `bash ./rebuild.sh`
- 脚本本身已包含：停止容器 → 无缓存构建 → 清理 dangling 镜像 → 启动容器 → 列出运行中容器。不要再额外手动执行这些步骤。
- 执行前请确认工作目录是项目根目录（含 `docker-compose.yml`）。
- 执行后向用户简要汇报：脚本是否成功结束、当前运行中的容器状态。

## 不要做的事

- 不要绕过脚本直接调用 `docker compose build`/`up`/`down`——使用脚本能保证流程一致。
- 不要在 Windows 上用 `bash` 跑 `rebuild.sh`（除非用户明确指定 WSL/Git Bash 环境），反之亦然。
- 不要省略 `-ExecutionPolicy Bypass`。
