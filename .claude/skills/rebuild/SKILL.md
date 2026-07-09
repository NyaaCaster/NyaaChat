---
name: rebuild
description: Rebuild the NyaaChat Docker image and restart containers. Use this whenever the project needs a Docker rebuild + restart (e.g., after Dockerfile, nginx.conf, docker-compose.yml, extension registry, or built frontend asset changes). Runs rebuild.py — a cross-platform Python script that works on Windows, Linux, and macOS.
---

# rebuild

本项目需要重新编译 Docker 镜像并重启容器时调用此 skill。

## 触发场景

- 用户明确要求"重新编译"、"重建镜像"、"重启容器"、"rebuild"。
- 改动了 `Dockerfile`、`docker-compose.yml`、`nginx.conf` 等容器构建相关文件。
- 改动了前端构建产物所依赖的源码或配置，需要让镜像内的静态资源同步更新。
- 安装、更新、删除 `public/extensions/<id>/` 下的第三方扩展，或需要刷新 `public/extensions/registry.json`。
- 通过 `/rebuild` 显式调用。

## 执行方式

**所有平台统一**使用 Python 脚本：

```
python rebuild.py
```

无缓存重建：

```
python rebuild.py --no-cache
```

依赖仅需系统自带 Python 3.8+ 解释器与 `docker` CLI，不引入额外运行时。

## 扩展 registry 自动生成

脚本会在 Docker build 前自动执行 `node scripts/generate-extension-registry.mjs`，按 `public/extensions/*/manifest.json` 重新生成 `public/extensions/registry.json`。

- 0 扩展状态会生成空清单：`{ "version": 1, "extensions": [] }`。
- 安装扩展：`git clone` 到 `public/extensions/<id>/` 后运行 rebuild，registry 自动加入该目录。
- 更新扩展：在扩展目录内 `git pull` 后运行 rebuild，registry 自动保持同步。
- 删除扩展：删除 `public/extensions/<id>/` 后运行 rebuild，registry 自动移除该目录。
- 默认生成项为 `rootEnabled: true`、`defaultUserEnabled: false`。
- 如果生成脚本校验失败（例如 `manifest.json` 非法或缺少 `display_name`），应先修复扩展目录/manifest，再重新 rebuild；不要手写绕过 registry。

## 缓存策略

**默认使用 Docker layer cache**，不再每次都 `--no-cache`：

- `package*.json` 未改动时，`RUN npm ci` 这一层会被命中并复用，不重新下载依赖。
- 只有源码变动会触发重建 `COPY . .` 之后的层（即重跑 `npm run build`）。
- 这是 rebuild 的常规场景，速度比无缓存快很多。

**只有以下场景**才需要追加 `--no-cache` 强制无缓存重建：

- 怀疑某层缓存损坏或与实际源码不一致（极少见）。
- 升级了 base image（`node:20-alpine` / `nginx:1.27-alpine`）想强制刷新。
- 用户明确要求"完全重建"、"clean rebuild"、"不要用缓存"。

## 执行规则

- 执行前确认工作目录是项目根目录（含 `docker-compose.yml`）。
- 脚本本身已包含：生成 `public/extensions/registry.json` → 构建（默认带缓存）→ 清理 dangling 镜像 → `docker compose up -d` 按需重建容器 → 列出运行中容器。`up -d` 只在镜像 hash 或 service 配置变化时重建容器，volume（如 `image-cache`）自动保留。不要再额外手动执行这些步骤。
- 执行后向用户简要汇报：脚本是否成功结束、当前运行中的容器状态。

## macmini 部署

本地 `rebuild.py` 构建推送后，**必须**推送 `.env` 到 macmini 并重启容器：

```bash
scp .env U-MacMini-1:/root/DockerContainer/nyaachat/.env && ssh U-MacMini-1 "export PATH=\$PATH:/snap/bin && cd /root/DockerContainer/NyaaChat && python3 restart.py"
```

`restart.py` 流程：pull → down → up -d → prune → status。

### .env 变更强制推送规则

**只要 `.env` 中发生了影响 macmini 发布侧运行时行为的变更（如 `MCP_HOST`、`NYAAACOUNT_*`、`PRIVATE_DOCKER_REGISTRY_*` 等容器内通过 `env_file` / envsubst / `process.env` 读取的变量），即使本次不需要 rebuild，也必须单独推送 `.env` 并重启 macmini 容器：**

```bash
scp .env U-MacMini-1:/root/DockerContainer/nyaachat/.env && ssh U-MacMini-1 "export PATH=\$PATH:/snap/bin && cd /root/DockerContainer/NyaaChat && python3 restart.py"
```

> 反之，纯 build-time 变量（如 `VITE_*`、Vite `define` 注入等）已随镜像走，`.env` 推送不是必需的，但**默认一律推送**以避免遗漏。

## 不要做的事

- 不要绕过脚本直接调用 `docker compose build`/`up`/`down`——使用脚本能保证流程一致。
- 不要再使用已删除的 `.ps1` / `.sh` 脚本——`rebuild.py` 是唯一入口。
