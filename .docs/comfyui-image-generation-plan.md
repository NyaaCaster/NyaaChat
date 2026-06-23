# ComfyUI 图片生成接入改造计划

> SSOT。状态：**P1–P5 已实施，P6 基建/连通已真机验证（浏览器出图待用户确认）**。本文档随仓库版本管理跟踪。
> 决策已拍板（2026-06-23）：① 连接架构 = 统一 nginx 反代；② 进度/队列 = 接 WebSocket 全做；③ ComfyUI 英文提示词 = 调用对话 LLM 生成。
>
> 验收记录（2026-06-23 rebuild 后）：nginx envsubst 正确注入 `proxy_pass http://h.nyaa.host:8188;`，前端产物中**无**该密钥地址；同源代理 `/api/comfyui/fixed/system_stats` 返回 ComfyUI 0.12.3、`/queue` 正常；`$connection_upgrade` 等 nginx 变量未被 envsubst 破坏。`npm run build` / `tsc --noEmit` / `eslint` 均通过。

## 0. 背景与目标

本项目当前仅有一种生图管线：`openai 标准格式 api 请求`（详见 `.ref/comfyui-res/【基于此消息生成图片】功能原理简报.md`）。

本次新增第二种管线 **ComfyUI 接入**：调用已部署的 ComfyUI 服务器 API + 工作流 API 文件，将「UI 可配置参数」和「基于此消息生成图片」产出的提示词替换进工作流后出图，并以与现有管线**相同的展示方式**在对话气泡中显示。

两种管线通过「生图模型供应商」的 `kind` 区分：
- `自定义 OpenAI 兼容 API` 类（含内置 `QinyAPI`）——走现有 `generateImage`，提示词逻辑不变。
- `自定义 ComfyUI 服务` 类（含内置 `固定 comfyui 服务器` = NyaaComfyUI）——走新增 ComfyUI 管线，提示词改为英文。

## 1. 关键约束（已查明）

- **CSP / 混合内容**：`nginx.conf` 的 CSP `connect-src 'self' https: http://localhost:* http://127.0.0.1:*`。固定服务器为 `http://h.nyaa.host:8188`（明文 http、远程、非 localhost），浏览器在 https 页面下**无法直连**。→ 必须经 nginx 同源反代。
- **密钥不入仓**：固定服务器地址写入 `.env`（git-ignore），通过 nginx envsubst 在容器启动时注入，**绝不进前端 bundle**，与现有 MCP 反代同模式。
- **ComfyUI API 流程**：`POST /prompt`（提交，返回 `prompt_id`）→ `ws /ws?clientId=` 监控（`progress`/`executing`/`status` 消息）→ `GET /history/{prompt_id}`（取输出文件名）→ `GET /view?filename=&subfolder=&type=`（取图片字节）。
- **构建/部署**：Vite 构建 + nginx 静态托管；`Dockerfile` 多阶段；`docker-compose.yml` `env_file: .env` + `NGINX_ENVSUBST_FILTER=^MCP_`（需扩展放行 COMFYUI_ 前缀）。

## 2. 资源文件落地（从 .ref 迁入受版本管理目录）

新建受跟踪资源目录 **`public/comfyui/`**（静态托管 + 可被用户下载 + app 运行时 fetch 同源）：

| 源（.ref，未跟踪） | 目标（public/comfyui/，跟踪） | 用途 |
|---|---|---|
| `Anima-Nyaa.json` | `public/comfyui/Anima-Nyaa.json` | 供用户在自己 ComfyUI 运行的完整工作流（可下载） |
| `Anima-Nyaa[API].json` | `public/comfyui/Anima-Nyaa.api.json` | 本项目用的工作流 API 文件（app 运行时 fetch；文件名去掉方括号避免 URL 编码问题） |
| `artlist.json` | `public/comfyui/artlist.json` | 画风列表 |
| `TestPrompt.md` | `public/comfyui/TestPrompt.md` | 测试生成专用提示词 |
| `ComfyUI-workflow-info.md` | `public/comfyui/ComfyUI-workflow-info.md` | 工作流使用说明（弹窗展示）；需把下载占位改为相对地址 `/comfyui/Anima-Nyaa.json` |

- `ComfyUI-workflow-info.md` 第 7 行 `[Anima2D](待补充…)` → `[Anima2D](/comfyui/Anima-Nyaa.json)`。
- `.ref/` 仍保留原件（git-ignore，不动）。

## 3. 环境变量与构建注入

- 新建 **`.env.example`**（跟踪），含全部现有键（占位值）+ 新增：
  ```
  # === ComfyUI 固定服务器（NyaaComfyUI）===
  COMFYUI_FIXED_URL=http://your-comfyui-host:8188
  COMFYUI_FIXED_NAME=NyaaComfyUI
  ```
- `.env`（不跟踪）写入真实 `COMFYUI_FIXED_URL=http://h.nyaa.host:8188` 与 `COMFYUI_FIXED_NAME=NyaaComfyUI`。
- **服务器名称**（非密钥）经 Vite `define` 注入：`vite.config.ts` 增 `__COMFYUI_FIXED_NAME__: JSON.stringify(env.COMFYUI_FIXED_NAME || 'NyaaComfyUI')`。前端用它显示固定供应商名。
- **服务器地址**（密钥）**不进前端**：前端固定服务器一律请求同源 `/api/comfyui/fixed/...`，由 nginx envsubst 注入真实 host。
- `docker-compose.yml`：`NGINX_ENVSUBST_FILTER` 由 `^MCP_` 改为 `^(MCP|COMFYUI)_`，放行 `${COMFYUI_FIXED_URL}` 进 nginx 模板。

## 4. nginx 同源反代（统一架构）

`nginx.conf` 新增两段，并加 ws 升级支持：

### 4.1 固定服务器（密钥经 envsubst）
```
# WebSocket 升级映射（http 块顶部，或复用）
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

location /api/comfyui/fixed/ {
    rewrite ^/api/comfyui/fixed/(.*)$ /$1 break;
    proxy_pass ${COMFYUI_FIXED_URL};
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;   # 支持 /ws
    proxy_set_header Host $proxy_host;
    proxy_buffering off;                                # SSE/ws/逐帧
    proxy_read_timeout 300s;
    client_max_body_size 16m;
}
```

### 4.2 自定义服务器（动态 host，路径编码，无密钥）
仿 image-proxy 的路径编码形式，承载任意用户填写的 ComfyUI host（含端口）：
```
location ~ "^/api/comfyui/custom/(https?)/([A-Za-z0-9.\-]+(?::[0-9]+)?)(/.*)?$" {
    set $cu_scheme $1; set $cu_host $2; set $cu_path $3;
    resolver 127.0.0.11 1.1.1.1 8.8.8.8 ipv6=off valid=30s;
    proxy_pass $cu_scheme://$cu_host$cu_path$is_args$args;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $cu_host;
    proxy_buffering off;
    proxy_read_timeout 300s;
    client_max_body_size 16m;
}
```
- 注意 host 正则扩展为允许 `:port`（image-proxy 原正则不含端口）。
- 自定义代理无白名单（用户自填自负），但仅限本应用前端发起、同源；可在后续按需加可选 allowlist。
- `vite.config.ts` dev server 也加 `/api/comfyui/fixed` → `env.COMFYUI_FIXED_URL` 的 proxy（ws: true），保证 `npm run dev` 下可用。

> /view 取图、/ws 进度、/prompt 提交、/history 查询全部经此同源路径，浏览器侧无 CORS / 混合内容 / CSP 问题，CSP 无需放宽。

## 5. 数据模型（types.ts / providers.ts）

`ImageProviderKind` 由 `"qiny" | "comfyui"` 扩展为区分两大族：
```ts
export type ImageProviderKind =
  | "qiny"            // 内置 OpenAI 兼容（固定）
  | "openai-custom"   // 自定义 OpenAI 兼容 API
  | "comfyui-fixed"   // 固定 ComfyUI 服务器（NyaaComfyUI）
  | "comfyui-custom"; // 自定义 ComfyUI 服务
```
`ImageProvider` 增 ComfyUI 专用字段（均可选，OpenAI 族忽略）：
```ts
comfyKind?: "fixed" | "custom";   // 便于分支；或直接用 kind 判断
comfySize?: "1024x1024" | "1024x1536" | "1536x1024"; // 默认 1024x1024
comfyWorkflowId?: "anima2d";       // 工作流选择（真人=占位禁用）
comfyArtStyle?: string;            // 画风 name，默认 "风格4.5.2"
baseUrl?: string;                  // 自定义服务器地址（fixed 不存真实地址，固定用同源前缀）
```
- 迁移：现有 `kind: "comfyui"` 占位项 → 重建为 `kind: "comfyui-fixed"`，name 取 `__COMFYUI_FIXED_NAME__`，默认 `enabled:false`、`comfySize:"1024x1024"`、`comfyWorkflowId:"anima2d"`、`comfyArtStyle:"风格4.5.2"`。`createDefaultImageProviders()` 与 `AppState` 迁移函数同步更新（兼容旧 localStorage）。
- 模型选择器（ChatComposer）中 ComfyUI 供应商的「模型名」= 工作流按钮名（`Anima2D`），与 OpenAI 族的模型名平级显示在对话框上方画图模型列表。

## 6. ComfyUI 调用层（新增 `src/lib/comfyuiApi.ts`）

职责：把「工作流 API 模板 + UI 参数 + 英文提示词」组装并执行一次出图，返回可展示 URL/数据。

1. **加载模板**：运行时 `fetch('/comfyui/Anima-Nyaa.api.json')`（按 `comfyWorkflowId` 选择），`fetch('/comfyui/artlist.json')`。
2. **参数替换**（占位符精确替换对应节点 inputs）：
   - 节点 `28`：`%width%`/`%height%` ← `comfySize` 拆分。
   - 节点 `92`：`%prompt%` ← 英文提示词。
   - 节点 `100`：`%artlist_p%` ← 选中画风 `p`。
   - 节点 `106`：`%artlist_n%` ← 选中画风 `n`。
   - 节点 `19`：`seed` ← **随机化**（每次生成随机整数，范围 `[1, 2^53)` 内安全整数；模拟 ComfyUI 的 randomize）。
3. **base 前缀**：fixed → `/api/comfyui/fixed`；custom → `/api/comfyui/custom/<scheme>/<host>`（由 `baseUrl` 拆分，兼容末尾 `/`、`/#/`、无 `/`）。
4. **提交**：生成 `clientId`（randomUUID），先开 `ws ${wsBase}/ws?clientId=`，再 `POST {base}/prompt` body `{prompt: graph, client_id, prompt_id}`。
5. **监控（WS）**：
   - `status` → `data.status.exec_info.queue_remaining`：**排队数**。
   - `progress` → `{value, max}`：**进度百分比** = value/max。
   - `executing` 且 `data.node===null && data.prompt_id===本次` → 完成。
   - `execution_error` / ws 异常 → 报错。
   - WS 不可用时回退轮询 `GET {base}/history/{prompt_id}`。
6. **取图**：`GET {base}/history/{prompt_id}` → 找 SaveImage 输出节点 `images[0]` 的 `{filename, subfolder, type}` → `GET {base}/view?...`。
7. **持久化展示**：把 `/view` 字节读为 **data URL（base64）存入消息 `imageUrl`**，保证历史不因服务器清理 output 而失效（与现有 b64 路径一致）。展示沿用 `ImageBubbleBody`/下载/查看，无需改 `MessageItem`。
8. **超时/中止**：复用 `AbortController`（与对话/现有生图同锁）；总超时 ~300s。

> 进度/队列状态通过回调上报给 ChatInterface，写入「生成中消息」的瞬态状态，出图后清除（见 §8）。

## 7. 英文提示词生成（chatPipeline 扩展）

新增 `buildComfyImagePrompt(...)`：调用**当前对话所选 LLM**（`getActiveLlmProvider` → `fetchChatCompletion`，非流式）生成英文图片提示词：
- 输入：角色 description、用户 persona、最近 N 轮场景、目标消息内容（均应用占位符）。
- 系统指令（英文）：要求仅输出**英文、自然语言、Danbooru 风可选、聚焦画面视觉要素**的提示词，不限字数，不含解释/markdown。
- 失败回退：LLM 不可用时退化为「现有拼接去中文截断」直送（并 log 警告）。
- `handleGenerateImage`（ChatInterface）按 active image provider 的 kind 分流：OpenAI 族 → `buildImagePrompt`（不变）；ComfyUI 族 → `await buildComfyImagePrompt`。
- 由于含异步 LLM 调用，生成期间在占位气泡显示「正在构思画面…」过渡态。

## 8. UI 改造（设置 → 生图模型设置）

### 8.1 `生图模型供应商` 列表
- 底部新增 `添加供应商` 按钮（仿 LlmProvidersModal）。点击弹出 **`供应商类型` 弹窗**，二选一：
  - `自定义 OpenAI 兼容 API`（kind `openai-custom`）
  - `自定义 ComfyUI 服务`（kind `comfyui-custom`）
- 内置项 `QinyAPI`（不动）、`固定 ComfyUI`（=NyaaComfyUI）不可删除；自定义项可删（仿 LLM 侧 ConfirmDialog）。

### 8.2 `固定 ComfyUI 服务器`（comfyui-fixed）详情
去掉所有「尽请期待」。模块：
- **尺寸选择**（三按钮单选，互斥）：`1024×1024`（默认）/`1024×1536`/`1536×1024` → `comfySize`。
- **工作流选择**（按钮单选）：`Anima2D`（→ `anima2d`）、`真人`（禁用占位）。
- **画风选择**（下拉）：选项 = `artlist.json` 各 `options[].name`，默认 `风格4.5.2` → `comfyArtStyle`。
- **测试生成**（按钮）：以当前 尺寸/工作流/画风 + `TestPrompt.md` 文本为 `%prompt%`，发起一次生成（走 §6，显示进度，结果可在弹窗内预览或落入对话——测试不写入对话，仅弹窗预览图）。

### 8.3 `自定义 ComfyUI 服务`（comfyui-custom）详情
以 8.2 为基础，增：
- **自定义端点名称**（可编辑，仿 LLM 侧）。
- **删除该自定义供应商**（图标按钮，仿 LLM 侧）。
- **ComfyUI 服务器地址**（在尺寸选择上方）：兼容末尾无 `/`、`/`、`/#/` → 归一化存 `baseUrl`。
- **ComfyUI 工作流配置文档**（文本链接式按钮）：点击弹窗渲染 `public/comfyui/ComfyUI-workflow-info.md`（仿 `VersionModal` 的 `react-markdown`，运行时 fetch 或 `?raw` 引入）。

### 8.4 `自定义 OpenAI 兼容 API`（openai-custom）详情
以现有 `QinyAPI` 详情为基础，调整：
- 图标：fontawesome `palette`，本项目默认蓝填色（在 `providerIcons.tsx` 增 kind 分支）。
- **自定义端点名称**（可编辑）、**删除该自定义供应商**（仿 LLM 侧）。
- `QingAPI 接入点` → **`API 地址`**（仿 LLM 侧 `API 地址` 文本框 + onBlur 归一化），写 `baseUrl`。
- **彻底去掉 `图片尺寸` 模块**。
- 其余（API Key、模型列表/管理模型）保留。

### 8.5 测试/进度 UI
- 进度/队列展示：生成中的消息气泡内显示 `排队 N · 进度 P%`（瞬态，不持久化），出图清除。`MessageItem` 增可选 props 接收瞬态状态；`ChatInterface` 维护 `comfyProgressById`。

## 9. 文件清单（预计改动）

新增：
- `.docs/comfyui-image-generation-plan.md`（本文件）
- `.env.example`
- `public/comfyui/{Anima-Nyaa.json, Anima-Nyaa.api.json, artlist.json, TestPrompt.md, ComfyUI-workflow-info.md}`
- `src/lib/comfyuiApi.ts`
- `src/components/ImageProviderTypeModal.tsx`（供应商类型二选一）
- `src/components/ComfyWorkflowInfoModal.tsx`（说明文档弹窗，或并入复用）

修改：
- `vite.config.ts`（define 名称 + dev proxy）
- `docker-compose.yml`（ENVSUBST_FILTER）
- `nginx.conf`（两段 comfyui 反代 + ws map）
- `src/types.ts`、`src/lib/providers.ts`（kind/字段/默认/迁移）
- `src/lib/chatPipeline.ts`（`buildComfyImagePrompt`）
- `src/components/ChatInterface.tsx`（分流 + 进度状态 + 调用 comfyuiApi）
- `src/components/ImageProvidersModal.tsx`（三类详情 + 添加供应商）
- `src/components/ChatComposer.tsx`（ComfyUI 工作流名进画图模型列表 — 多数已通用，校验即可）
- `src/components/MessageItem.tsx`（瞬态进度 props）
- `src/components/icons/providerIcons.tsx`（palette 图标 + 新 kind）

## 10. 实施阶段（建议提交粒度）

- **P1 资源与配置基建**：迁移 public/comfyui 资源、改 info.md 链接、.env.example、vite define、docker-compose filter、nginx 两段反代 + ws map。（可 rebuild 验证同源代理通）
- **P2 数据模型与迁移**：types/providers 扩 kind 与字段、默认与 localStorage 迁移、providerIcons。
- **P3 ComfyUI 调用层**：`comfyuiApi.ts`（模板替换 + 提交 + WS 进度/队列 + 取图 + base64 持久化 + 中止）。
- **P4 设置 UI**：固定/自定义 ComfyUI 详情、添加供应商类型弹窗、自定义 OpenAI 详情、工作流文档弹窗、测试生成。
- **P5 提示词与分流**：`buildComfyImagePrompt`（LLM 英文）、ChatInterface 分流、进度气泡。
- **P6 真机联调**：固定服务器 `h.nyaa.host:8188` 出图、进度/队列、下载/查看、历史持久化；rebuild 验证。

## 11. 风险与备注

- ComfyUI output 文件清理 → 采用 base64 持久化规避（P3 §6.7）。
- 自定义远程 http ComfyUI 经 nginx 代理可达，但用户填写错误地址只会 502，前端需给出可读错误。
- WS 经 nginx 需 `proxy_buffering off` + upgrade 头；dev 模式 vite proxy 需 `ws:true`。
- `NGINX_ENVSUBST_FILTER` 改动后务必确认 nginx 自有变量（`$1`、`$cu_host` 等）不被 envsubst 误替换（仅放行 `MCP_`/`COMFYUI_` 前缀，nginx 变量无此前缀，安全）。
- 重建镜像统一走 `rebuild` skill（Windows：`powershell -ExecutionPolicy Bypass -File .\rebuild.ps1`）。

## 12. 计划外补充修改（实施期间按用户追加需求实现，均已 rebuild 真机验证）

以下为原计划（§0–§11）之外、实施过程中应用户要求追加的改动，记录在此以保持本 SSOT 与代码一致。

### 12.1 固定服务器描述字段 `COMFYUI_FIXED_DESC`
- 详情页名称下方小字描述改为**可配置**：`.env` 新增 `COMFYUI_FIXED_DESC`（非密钥），经 Vite define `__COMFYUI_FIXED_DESC__` 注入；`providers.ts` 导出 `COMFYUI_FIXED_DESC`；`ImageProvidersModal` 固定服务器 `DetailHeader` 的 `subtitle` 改用它（为空时回退 `固定 ComfyUI 服务器（<名称>）`）。
- `.env.example` 模板值：`NyaaChat本地部署Comfyui服务器`。
- 改动：`vite.config.ts`、`src/vite-env.d.ts`、`src/lib/providers.ts`、`src/components/ImageProvidersModal.tsx`、`.env.example`。

### 12.2 ComfyUI 健康检查
- ComfyUI 族（固定 + 自定义）详情页加「连通性检查」区块：`健康检查` 按钮 → `checkComfyHealth(provider)` 请求 `GET /system_stats`（**仅探连通、不生图**，15s 超时），成功显示绿色 `已连通 · ComfyUI <版本>`，失败显示红色错误原因；自定义未填地址时禁用；切换/卸载自动 abort。
- 改动：`src/lib/comfyuiApi.ts`（新增 `checkComfyHealth` / `ComfyHealth`）、`src/components/ImageProvidersModal.tsx`。

### 12.3 生成图片下方斜体注释
- 所有生成图片气泡的图片正下方加入斜体弱化注释：「如果生成图片与情景不符，是提示词未通过LLM的违禁内容审查。」
- `ImageBubbleBody` 结构微调：把「重新生成中…」遮罩层收窄到只覆盖图片，注释作为图片下方独立段落。
- 改动：`src/components/MessageItem.tsx`。

### 12.4 固定服务器鉴权 `COMFYUI_FIXED_TOKEN`（含 `$` 字面量坑）
- 固定 ComfyUI 服务器启用鉴权：`.env` 新增 `COMFYUI_FIXED_TOKEN`（密钥），经 nginx 以 `Authorization: Bearer <token>` 头**服务端注入**（不进前端 bundle / URL），固定服 location 覆盖 `/prompt`、`/history`、`/view`、`/system_stats`、`/ws`，HTTP 与 WebSocket 共用此鉴权。
- 选型理由：与现有 MCP 反代同模式；浏览器无法给 WS 设头，但服务端注入时上游 `/ws` 握手也带头，全程统一鉴权。
- **关键坑**：ComfyUI 自动生成的 token 为 bcrypt 形态 `$2b$12$…`（60 字符、含 `$`、不可更改）。直接写 `proxy_set_header Authorization "Bearer ${COMFYUI_FIXED_TOKEN}"` 时，envsubst 注入后 nginx 会把 `$2b`/`$1` 当作变量解析，导致 token 被改写 → 上游返回 **401**。
- **解法**：用 `geo` 字面量持有 token（`geo` 的值不做变量插值，与社区 `geo $dollar { default "$"; }` 取字面 `$` 同理）：
  ```nginx
  geo $comfy_fixed_token { default "${COMFYUI_FIXED_TOKEN}"; }
  # fixed location:
  proxy_set_header Authorization "Bearer $comfy_fixed_token";
  ```
  变量的运行时值不会被二次解析，故 `$` 原样透传。真机验证：`/system_stats`、`/queue` 均 HTTP 200。
- dev 端 `vite.config.ts` 的 `/api/comfyui/fixed` 代理同步加 `headers: { Authorization: 'Bearer <token>' }`（token 留在 node 进程，不进浏览器）。
- 自定义 ComfyUI 服务**未**接入 token（各服务器各异，超出本次范围）。
- 改动：`nginx.conf`（geo + 头）、`vite.config.ts`、`.env.example`。

> 备注：`.env` 本身 git-ignore，真实 `COMFYUI_FIXED_URL` / `COMFYUI_FIXED_TOKEN` 不入库；模板与说明在 `.env.example`。

### 12.5 DarkBeast 真人工作流（v2）
- 新增真人工作流 `DarkBeast真人`：UI 中原「真人」占位按钮改为可选工作流，读取 `public/comfyui/DarkBeast-Nyaa.api.json`。
- DarkBeast API 工作流只使用节点 `28`（`width` / `height`）、节点 `92`（`prompt`）与节点 `19`（随机 seed）。不加载 `artlist.json`，也不写入 Anima2D 专属的节点 `100` / `106`。
- `artlist.json` 的正/负向画风串仅用于 `Anima2D`；设置页「画风选择」也仅在当前工作流为 `Anima2D` 时显示。
- 测试生成与对话内「基于此消息生成图片」继续复用同一 ComfyUI 调用层，因此会按当前工作流自动切换参数注入策略。
- 改动：`src/lib/providers.ts`（工作流元数据 `usesArtStyle`）、`src/lib/comfyuiApi.ts`（条件加载/注入 artlist）、`src/components/ImageProvidersModal.tsx`（画风选择显隐）。
