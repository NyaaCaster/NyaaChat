# NyaaChat 技术实现文档

> 面向开发者与部署者的架构与实现细节。使用指南请参阅 [README.md](README.md)。

---

## 1. 技术栈总览

| 层 | 技术 | 版本 |
|---|------|------|
| 前端框架 | React (函数式组件 + Hooks) | 19.x |
| 语言 | TypeScript | ~5.8 |
| 构建工具 | Vite | 6.x |
| CSS 框架 | Tailwind CSS | v4 |
| 动画 | Motion (Framer Motion 继任者) | - |
| Markdown 渲染 | react-markdown + KaTeX | - |
| 拖放 | @dnd-kit | - |
| 加密 | @noble/curves + @noble/hashes (ECDH P-256) | - |
| 图标 | Lucide React | - |
| 后端运行时 | Node.js (ext-host / shared / knowledge) | 20.x |
| Web 服务器 | nginx | 1.27-alpine |
| 数据库 | SQLite (better-sqlite3 + sqlite-vec) | WAL 模式 |
| 容器化 | Docker Compose | 3 个独立 compose 项目 |

---

## 2. 架构概览

NyaaChat 是一个**单页应用 (SPA)** + **微服务后端**的本地部署 AI 对话工具。所有外部流量通过 nginx（端口 3095）统一入口。

```
浏览器 (React SPA)
    │
    ▼
nginx (:3095)  ◄── 唯一公网入口
    │
    ├─ /api/mcp* ────────────►  外部 MCP 服务器
    ├─ /api/ext-host/* ──────►  ext-host (:3099, Node.js)
    ├─ /api/shared/* ────────►  nyaachat-shared (:5107, Express + SQLite)
    ├─ /api/knowledge/* ─────►  nyaachat-knowledge (:5108, Express + SQLite + sqlite-vec)
    ├─ /api/comfyui/fixed/* ─►  外部 ComfyUI 实例
    ├─ /api/image-proxy/* ───►  外部 CDN (带 5GB nginx 缓存)
    └─ /* ───────────────────►  静态文件 (React SPA)
```

### 三仓库结构

| 仓库 | 可见性 | 内容 |
|------|--------|------|
| `NyaaChat/` (主仓) | 公开 | 前端源码 + Docker 基础设施 + nginx 配置 |
| `nyaachat-knowledge/` | 私有 | 知识库 RAG 后端 (Express + SQLite + sqlite-vec) |
| `shared-server/` | 私有 | 共享角色库 + 账号额度后端 (Express + SQLite) |

主仓 `.gitignore` 忽略两个子仓库目录。三仓库分开提交、分开推送，但 Docker 构建仍从主仓根运行。

---

## 3. 前端架构

### 3.1 路由与组件树

无传统路由器。所有导航通过 `App.tsx` 中的条件 Modal 渲染管理——这是一个**单状态持有者**模式，`AppState` 包含全部应用设置的单一接口。每个 Modal 以 `React.lazy()` + `<Suspense>` 按需加载，不阻塞初始包。

```
App.tsx (根组件 — 单一状态持有者)
├─ ChatHeader          顶部栏 (标题、全屏、设置、控制台)
├─ ChatInterface       主聊天视图 (消息流、发送管线、生图)
│   └─ ChatComposer    输入框 + 工具栏 (附件、搜索、MCP、模型选择)
│       └─ MessageItem 单条消息气泡 (Markdown + KaTeX + 图片查看)
├─ [Lazy Modals]
│   ├─ SettingsModal / LlmProvidersModal / ImageProvidersModal
│   ├─ CharacterEditModal / CharacterSelectionModal / CharacterShareModal
│   ├─ WorldInfoRuleModal / KnowledgeBaseModal / KnowledgeBaseSelectModal
│   ├─ UserAccountModal / SharedLibraryModal
│   ├─ ChatHistoryModal / ImageViewerModal / RegexModal
│   └─ ExtensionsModal / ConsoleModal / ManageModelsModal ...
└─ compat/             SillyTavern 兼容桥
```

### 3.2 状态管理

**无外部状态库**。使用 React 原生 `useState` + `useRef` + props 传递：

- **AppState** (`types.ts`): 包含全部设置的单一接口——角色、用户角色、LLM/图片提供者、主题、MCP 配置、渲染偏好。
- **持久化**: IndexedDB (`nyaachat_settings` key)，带模式版本迁移 (当前 v8)。
- **ChatSession**: 独立存储 (`sessionStorage.ts`)，消息变更时 800ms 去抖自动保存。
- **Compat RuntimeStore** (`compat/runtimeStore.ts`): 模块级无框架状态镜像，单向数据流 React → extensions。

### 3.3 API 层

全部使用原生 `fetch`，无 axios/React Query。每个 API 模块是 `lib/` 下独立文件：

| 文件 | 用途 |
|------|------|
| `api.ts` | LLM 聊天补全 (OpenAI/Anthropic 格式、流式、工具使用循环) |
| `chatPipeline.ts` | 提示词组装核心 (世界信息、搜索上下文、MCP 规则、约束注入) |
| `providers.ts` | 多提供者预设 (QinyAPI/Gemini/Anthropic/OpenAI/DeepSeek/Ollama) |
| `mcpApi.ts` | MCP JSON-RPC 客户端 (工具发现、SSE 解析、健康探测) |
| `imageApi.ts` | QinyAPI 图片生成 (OpenAI 兼容端点) |
| `comfyuiApi.ts` | ComfyUI 工作流图片生成 (WebSocket 进度) |
| `t2iAgentApi.ts` | T2I 智能提示词代理 (密钥零泄漏至前端) |
| `knowledgeApi.ts` | 知识库 CRUD + 混合 RRF 检索 |
| `sharedAccountApi.ts` | NyaaAcount 认证与资料 |
| `sharedLibraryApi.ts` | 共享角色库浏览/获取 (ECDH 密钥交换) |
| `modelHealth.ts` | 模型健康探测 + 能力推断 |

**错误模型**: `{ kind: "ok" | "error" | "network" }` 三元区分——UI 可将业务错误与连接失败分开处理。

### 3.4 数据持久化

前端存储全面迁移到 IndexedDB（数据库名 `nyaachat_storage`，object store `kv`），取代了原来 5-10MB 上限的 localStorage。

| Key | 内容 |
|-----|------|
| `nyaachat_settings` | 完整 AppState (v8 schema) |
| `nyaachat_sessions` | ChatSession[] (所有对话历史) |
| `nyaachat_account` | Bearer token + AccountProfile |
| `nyaachat_cover_<id>` | 角色封面图片 WebP Blob (独立存储，避免 base64 膨胀) |

---

## 4. 后端服务架构

### 4.1 六容器部署

四个 Docker 镜像，部署为六个容器，分属三个独立 compose 项目，通过外部网络 `nyaachat-net` 互联：

| 镜像 | 容器 | 基础镜像 | 端口 |
|------|------|----------|------|
| `nyaachat-app` | app | `nginx:1.27-alpine` | **3095** (公开) |
| `nyaachat-ext-host` | ext-host | `node:20-alpine` | 3099 (内部) |
| `nyaachat-shared` | nyaachat-shared | `node:20-alpine` | 5107 (仅 localhost) |
| `nyaachat-knowledge` | nyaachat-knowledge | `node:20-slim` | 5108 (仅 localhost) |

> knowledge 服务必须使用 `node:20-slim` 而非 alpine——better-sqlite3 和 sqlite-vec 原生扩展需要 glibc。

### 4.2 nginx 路由表

| Location | 上游 | 说明 |
|----------|------|------|
| `~* ^/assets/.+\.(js\|css\|...)` | 静态文件 | 不可变资源，缓存 1 年 |
| `= /index.html` | 静态文件 | SPA 入口，永不缓存 |
| `= /api/mcp` | MCP 服务器 | 流式 HTTP，服务端注入 Bearer |
| `= /api/mcp/health` | MCP 服务器 | 健康检查 |
| `= /api/ext-host/t2i-agent/chat` | ext-host:3099 | T2I Agent，300s 超时 |
| `/api/ext-host/*` | ext-host:3099 | 扩展运行时 (TTS 等) |
| `/api/shared/*` | nyaachat-shared:5107 | 共享角色 + 账号后端，120MB body |
| `/api/knowledge/*` | nyaachat-knowledge:5108 | 知识库后端，120MB body |
| `/api/comfyui/fixed/*` | ComfyUI 实例 | 含 WebSocket 升级 + Token 注入 |
| `/api/image-proxy/*` | 外部 CDN | 5GB 缓存，30 天过期，主机白名单 |
| `/*` | 静态文件 | SPA 回退 |

> shared 和 knowledge 的上游使用 `resolver 127.0.0.11` 延迟 DNS 解析——即使后端宕机，nginx 也能正常启动，请求只返回 502。

### 4.3 ext-host (端口 3099)

零依赖原生 Node.js HTTP 服务器 (无 Express)，作为 sidecar 运行：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/status` | GET | TTS 预设、运行时元数据、扩展事件计数 |
| `/t2i-agent/chat` | POST | T2I 智能提示词代理——前端只发 `messages`，密钥/模型从服务端 env 注入 |
| `/openai/custom/generate-voice` | POST | TTS 语音生成代理 (SillyTavern 兼容)，端点白名单强制 |
| `/runtime-metadata` | GET/PUT | 扩展运行时元数据 |
| `/extension-field` | POST | 扩展字段事件桥接 |

### 4.4 shared-server (端口 5107)

NyaaChat 共享角色库与账号系统后端。Express + better-sqlite3。数据库 5 张表：`users`、`sessions`、`shared_characters`、`ratings`、`user_settings`。

核心职责：
- **账号管理**: 注册/登录/退出，通过 NyaaAcount 统一平台进行凭证转发（Nyaa-HMAC-XOR-V1 传输加密）
- **额度消费**: 知识库扩容 (+2 / 10 猫粮)、ComfyUI 图包扩容 (+30 / 5 猫粮)、角色/聊天存储扩容
- **共享角色库**: 发布/浏览/获取/评分/退订，P-256 ECDH + HKDF-SHA256 传输加密
- **内部 API**: `POST /internal/validate-token` 为 knowledge 服务提供 Bearer token 验证 (共享密钥认证)

### 4.5 nyaachat-knowledge (端口 5108)

知识库 RAG 后端。Express + better-sqlite3 + sqlite-vec。数据库 6 张表：`knowledge_bases`、`documents`、`chunks`、`chunks_fts` (FTS5)、`vec_chunks` (sqlite-vec 虚拟表)、`embedding_configs`。

搜索流程：
1. **并行检索**: 查询向量化 → sqlite-vec KNN (稠密) ‖ FTS5 BM25 (稀疏)
2. **RRF 融合**: Reciprocal Rank Fusion (k=60) 合并两路排名
3. **结果截断**: 按 token 预算截断，返回 top-N chunks

安全措施：嵌入 API 仅接受 `https://` 或 `http://localhost`；`redirect: "error"` 禁用重定向；超时 60s；每批次最多重试 3 次。

---

## 5. 聊天核心管线

从用户输入到 LLM 响应的完整数据流（`ChatInterface.tsx` → `chatPipeline.ts` → `api.ts`）：

```
用户输入
  │
  ▼
1. 预处理: {{user}}/{{char}} 占位符替换 + 附件组装
  │
  ▼
2. [可选] 网页搜索 (SearXNG) → buildSearchContext()
  │
  ▼
3. [可选] 知识库检索: 激活规则 → collectLinkedKbIds() → searchKb() → buildKbSearchContext()
  │
  ▼
4. [可选] MCP 工具: listTools() → 白名单过滤 → 能力门控 → assembleMcpRules()
  │
  ▼
5. buildRequestMessages() — 提示词组装
   ├─ 静态前缀 (prompt-cache 友好):
   │   ├─ SESSION_PROTOCOL_ANCHOR (会话协议声明)
   │   ├─ 用户身份描述
   │   ├─ 角色描述 + 首次消息
   │   └─ 永久规则 (World Info, triggerType: "permanent")
   ├─ 对话历史 (过滤掉系统消息和生图气泡)
   ├─ 最新用户轮次 (含 <search_context> 易失性部分)
   └─ 动态尾部 <session_rules>:
       ├─ 关键词触发规则 (硬约束 / 软设定 分组)
       ├─ MCP 工具使用指南 (按实际广告的工具注入)
       └─ <output_constraints> (字数限制、语言约束)
  │
  ▼
6. 绕过提示词注入 (可选): bypassTemplates → 身份/场景/角色扮演模板
  │
  ▼
7. fetchChatCompletion() — 格式分发
   ├─ Anthropic 格式: prepareAnthropicPayload() → fetchAnthropic()
   └─ OpenAI 格式: foldTailSystemIntoLatestUser() → fetchOpenAI()
  │
  ▼
8. 工具使用循环 (max 5 rounds)
   ├─ OpenAI: tool_calls → role:tool → 继续
   └─ Anthropic: tool_use → tool_result → 继续
  │
  ▼
9. SSE 流式输出 → setMessages() → React 重渲染
  │
  ▼
10. 自动保存 (800ms 去抖) → IndexedDB
```

### 5.1 提示词缓存优化

- **静态前缀不变**: 永久规则、角色描述、用户身份存放在消息数组头部，字节级不变——利于 LLM 提供商的 prompt cache 命中。
- **动态尾部独立**: 关键词规则、MCP 工具指南、输出约束放在尾部 system 消息——逐轮变化但不破坏前缀缓存。
- **易失性标记**: `<search_context>` 内容以 `VOLATILE_PART_FLAG` 标记，注入最新用户轮次而非 system prompt，防止外部文本获得 operator 级权限。

### 5.2 工具使用循环

OpenAI 和 Anthropic 路径实现完全同构的工具循环 (max 5 rounds)：

- **OpenAI**: assistant `tool_calls` → 执行工具 → `role: "tool"` 消息追加 → 继续
- **Anthropic**: assistant `tool_use` blocks → 执行工具 → user 消息含 `tool_result` blocks → 继续
- **失败处理**: 所有工具错误返回 `[tool_error]` 文本（从不抛异常），模型按 `FAILURE_DEGRADATION_RULES` 自然降级，不暴露内部错误。

---

## 6. 世界信息 (World Info) 注入系统

### 6.1 规则类型

| 触发方式 | 注入位置 | 缓存行为 |
|----------|----------|----------|
| **🔵 永久触发** | 静态前缀 (system 消息) | 跨轮次不变，命中 prompt cache |
| **🟢 关键词触发** | 动态尾部 `<session_rules>` | 每轮根据用户输入重新计算 |

### 6.2 关键词规则激活算法

`getActivatedKeywordRules()` (`chatPipeline.ts`):

1. **Round 0**: 扫描用户输入，匹配所有关键词规则的逗号分隔关键词列表
2. **Round 1+**: 对 `allowRecursion: true` 的规则，将其内容作为下一轮扫描文本，递归触发下游规则，最多 10 步
3. 输出按角色配置中的原始数组顺序排序（非激活顺序）

### 6.3 约束强度调解

- **硬约束** (`hard: true`): 动态尾部中以「硬约束」前缀注入，冲突时优先生效。
- **软设定** (默认): 以「场景设定」前缀注入，与用户最新发言冲突时主动让位。

调解条款 `RULES_MEDIATION_CLAUSE` 明确声明：叙事走向以用户最新发言为准；仅当用户请求与硬约束直接冲突时硬约束优先。

---

## 7. 知识库 (RAG) 系统

### 7.1 文档入库流程

```
用户上传文件 (.txt/.md/.pdf)
  │
  ▼
parsers/ — 提取纯文本
  │
  ▼
chunk.js — 滑动窗口切片 (默认 512 tokens, overlap 50)
  │
  ▼
embedding.js — 调用用户配置的嵌入 API (OpenAI 兼容 /v1/embeddings)
    32 个 batch 并行，最多重试 3 次
  │
  ▼
单个事务写入 SQLite:
  ├─ chunks 表 (seq, content, char_count, vector_id)
  ├─ vec_chunks (sqlite-vec 虚拟表, 稠密向量 KNN)
  └─ chunks_fts (FTS5 三元组索引, CJK 友好)
```

### 7.2 混合检索

```
查询
  ├─ 稠密路径: 查询向量化 → sqlite-vec KNN
  └─ 稀疏路径: 查询分词 → FTS5 BM25
        │
        ▼
    RRF 融合 (k=60)
        │
        ▼
  Token 预算截断 → top-N chunks → <search_context>
```

### 7.3 注入时机与权限边界

知识库检索由**角色规则条目**触发——规则上配置 `linkedKbIds`，只有规则被激活时才调用知识库检索。这保证了：

- 知识库内容不会无条件填入所有对话
- 每次注入都与角色设定中的具体情景绑定
- `<search_context>` 以易失性部分注入用户轮次，而非 system prompt——外部文本永远无法冒充系统指令

### 7.4 共享角色跨账号只读检索

共享角色作者的原始知识库不对外导出。其他用户获取共享角色后，角色规则中保留作者的 `linkedKbIds` 引用。运行时后端通过 `character_kb_bindings` 表校验权限，允许**只读 RRF 检索**——被授权方能搜到内容，但无法获取原始文档或修改知识库。

---

## 8. MCP 工具集成

### 8.1 架构

前端通过 nginx 代理与 MCP 服务器通信 (`/api/mcp` → MCP 服务器)，nginx 在转发时注入 `Authorization: Bearer` (服务端 `.env` 中的 `MCP_API_KEY`)，前端完全不接触 MCP 密钥。

### 8.2 工具白名单

当前仅广播 5 个工具（`ADVERTISED_TOOLS` 白名单）：`get_current_time`、`get_weather`、`roll_coc`、`roll_dnd`、`web_search`。只有具备明确提示词工程支持的工具才会被广播。

### 8.3 用户城市注入

用户在 MCP 卡片中设置的角色扮演城市 (`mcpUserCity`) 通过 `mergeUserCity()` 自动注入到时间/天气工具的参数默认值中——当 LLM 未指定 `timezone`/`location` 时使用。

### 8.4 工具故障降级

工具调用失败返回 `[tool_error]` 文本而非异常。`FAILURE_DEGRADATION_RULES` 指示模型以角色化方式自然降级（困惑/不确定/信息故障），不暴露技术错误内容。

---

## 9. 图片生成系统

### 9.1 双渠道架构

| 渠道 | 前端 API | 后端路径 | 计费 |
|------|----------|----------|------|
| **QinyAPI** | `lib/imageApi.ts` | OpenAI 兼容 `/v1/chat/completions` | 无本地计费 |
| **ComfyUI Fixed** | `lib/comfyuiApi.ts` | `/api/comfyui/fixed/*` → ComfyUI 实例 | ComfyUI 图包次数 -1 |
| **ComfyUI Custom** | `lib/comfyuiApi.ts` | `/api/comfyui/custom/*` → 用户实例 | 无本地计费 |

### 9.2 ComfyUI 生成流程

1. 从 `public/comfyui/` 加载 API 格式工作流 JSON（3 个工作流：Anima2D / RM真人·柔美 / DB真人·节操）
2. 替换工作流节点输入：尺寸、提示词、画风正/负面提示词、随机种子
3. POST `/api/comfyui/fixed/prompt` → 获取 prompt_id
4. WebSocket `/ws` 监听进度 (queue_remaining → 步骤百分比)
5. 从 `/history` 获取完成图片 → `/view` URL

### 9.3 T2I 智能提示词代理

服务端 LLM 代理 (`ext-host` 的 `/t2i-agent/chat`):
- 前端只发送 `messages` 数组——API 密钥、base URL、模型均在服务端 env 中。
- System prompt 内置 7 维度分析框架（主体身份、主体肖像切片、场景构图、氛围与情绪、视点、视觉词汇、约束）。
- 输出 5-7 段流畅英文自然语言描述 (~300-400 words)。
- 服务端通过 `COMFYUI_FIXED_T2I_AGENT_API_MODEL` 强制指定模型，前端无法切换。
- 失败回退：T2I Agent 不可用时 → 用户聊天 LLM 兜底 → 模板化提示词构建器兜底。

### 9.4 图片代理缓存

nginx `proxy_cache` 对外部图片 URL 提供 5GB / 30 天缓存。白名单域名（OAIDALLEAPI、xai-images 等），缓存键为完整 URL，忽略源站 Cache-Control 以激进缓存。

---

## 10. 账号与额度系统

### 10.1 认证流程

1. 前端 `sharedAccountApi.ts` 收集账号 + 密码
2. POST `/api/shared/account/login` → shared-server
3. shared-server 通过 Nyaa-HMAC-XOR-V1 加密通道转发至 NyaaAcount 统一平台
4. 返回 `{ token, profile }` → IndexedDB 持久化
5. 后续认证请求自动带 `Bearer <token>`

### 10.2 额度模型

所有额度状态以**服务端为准**，前端展示仅体验优化。

| 额度项 | 默认值 | 上限 | 扩容消耗 | 原子扣减 |
|--------|--------|------|----------|----------|
| 共享角色槽位 | 200 | 200 | +5 / 15 猫粮 | - |
| 知识库数量 (kb_max) | 3 | 50 | +2 / 10 猫粮 | - |
| ComfyUI 图包次数 | 10 | 无上限 | +30 / 5 猫粮 | `WHERE remaining>0` |
| 角色存储 | - | - | +12MB / 5 猫粮 | - |
| 聊天存储 | - | - | +12MB / 5 猫粮 | - |

### 10.3 ComfyUI 图包计费守卫

- **登录 gate**: 未登录用户触发生图 → 弹出 `UserAccountModal`
- **余额 gate**: `comfyuiPackRemaining ≤ 0` → 提示扩容
- **原子扣减**: `consumeComfyuiPack()` 使用 `UPDATE ... WHERE remaining > 0` 防止并发超扣
- **仅 comfyui-fixed 计费**: QinyAPI 和 comfyui-custom 不计入图包

---

## 11. LLM 提供者抽象

### 11.1 多提供者架构

`providers.ts` 定义预设 + `LlmProvider` 接口。每个提供者有独立的 `baseUrl`、`apiKey`、`apiFormat`（`"openai"` 或 `"anthropic"`）和模型列表。

内置预设：QinyAPI、Google Gemini、Anthropic Claude、OpenAI GPT、DeepSeek、Ollama。

### 11.2 格式分发

`api.ts` 中的 `fetchChatCompletion()` 根据 `apiFormat` 路由：
- `"anthropic"` → `prepareAnthropicPayload()`: 分离 system 字符串、交替 roles 数组、缓存控制断点、内容格式转换
- `"openai"` (默认) → `foldTailSystemIntoLatestUser()`: 尾部 system 消息折叠到最新用户轮次（因为 OpenAI 兼容格式无可靠的中途 system 消息位置）

### 11.3 模型健康测试

`modelHealth.ts` 提供三层探测：

1. **健康 ping**: 1 字符提示 → 验证端点可达 (30s 超时)
2. **结构化输出探测**: 测试 `response_format: json_object` 支持
3. **能力推断**: 启发式模式匹配推理 vision / web / reasoning / tools / embed 能力

健康测试结果缓存，转换为能力图标（橙色扳手 🔧 = 工具调用）。未测试过的模型默认信任，照常广播工具。

---

## 12. SillyTavern 兼容层

### 12.1 角色卡导入/导出

**导入** (`sillyTavernImport.ts`):
- 从 PNG `tEXt` chunk 解析 `chara_card_v3` JSON (ST 标准格式)
- 自动识别 NyaaChat 原生格式 vs ST 格式
- 世界书条目 → WorldInfoRule 映射：位置归并 (ST 的 @D + depth → NyaaChat 的 system/assistant)、recursion 双限制器归一化
- 所有导入规则默认**软设定**（ST 无约束强度概念）

**导出** (`sillyTavernExport.ts`):
- NyaaChat 规则 → ST chara_card_v3 entries
- `allowRecursion: false` → `exclude_recursion: true`；`prevent_recursion` 强制为 `true`
- `hard` 约束标记**故意丢弃**（ST 无等价概念）
- PNG 容器 (`pngCard.ts`): 512×768 canvas 绘制封面 + `tEXt` chunk 嵌入 JSON

### 12.2 扩展系统

`compat/` 目录实现了 ST API 的兼容垫片：
- **事件总线** (`events.ts`): `eventSource` + `event_types` 完整映射
- **运行时存储** (`runtimeStore.ts`): React → extensions 单向数据流，支持注册 MessageWriter 写回
- **宏引擎** (`macros.ts`): `{{user}}`/`{{char}}` 替换 + `substituteParams()`
- **斜杠命令** (`slash/`): ST 兼容的命令解析与执行
- **正则引擎** (`regex/`): 显示管道 + 提示词管道 (placement 1-5)
- **前端卡牌** (`render/`): FrontendCard 渲染器 + HTML 检测

### 12.3 设计原则

NyaaChat 兼容层追求**逻辑等价**而非**行为逐位复刻**。关键差异：
- 世界书位置的「深度」概念被放弃——所有位置归并到 system/assistant 维度，避免破坏前缀缓存
- 前端 UI 渲染元素（状态栏、动态数值面板等）导入时自动过滤

---

## 13. 安全设计要点

| 维度 | 措施 |
|------|------|
| **密钥隔离** | LLM/ComfyUI/MCP/嵌入 API 密钥仅存于服务端 env 和 IndexedDB，永不打包进前端 bundle 或镜像层 |
| **T2I Agent** | API 密钥和模型在服务端 env 强制指定，前端无法读取或切换 |
| **SSRF 防护** | 知识库嵌入仅接受 `https://` 或 `http://localhost`，禁用重定向 |
| **原子扣减** | ComfyUI 图包消耗使用 `WHERE remaining > 0` SQL 守卫 |
| **传输加密** | NyaaAcount 通信使用 Nyaa-HMAC-XOR-V1 (HMAC-SHA256 流密码)；共享角色获取使用 ECDH P-256 + HKDF-SHA256 |
| **Prompt 注入防御** | 规则/知识库内容始终在 `<search_context>` / `<session_rules>` 边界内；SESSION_PROTOCOL_ANCHOR 声明外部文本仅参考、不具约束力 |
| **WebSocket 安全** | ComfyUI WebSocket 隧道经过 nginx，Token 由 nginx `geo` 块以字面量注入（避免 `$` 字符插值破坏 bcrypt hash） |
| **CSP 头部** | nginx 注入 Content-Security-Policy、X-Frame-Options 等安全头部 |

---

## 14. 部署架构

### 14.1 本地开发

```bash
git clone https://github.com/NyaaCaster/NyaaChat.git
cd NyaaChat

# 创建外部网络
docker network create nyaachat-net

# 构建并启动全部服务
docker compose up -d                          # 主服务 (:3095)
docker compose -f docker-compose.shared.yml up -d     # 共享角色后端 (:5107)
docker compose -f docker-compose.knowledge.yml up -d  # 知识库后端 (:5108)
```

### 14.2 重建脚本

| 脚本 | 目标 | 说明 |
|------|------|------|
| `rebuild.py` | 全部 4 个镜像 | `--no-cache` / `--skip-push` / `--only=<name>` |
| `rebuild-shared.py` | shared-server | 独立重建，不影响前端 |
| `rebuild-knowledge.py` | knowledge-server | 独立重建，不影响前端 |

所有重建基于 `docker compose build` + `docker compose up -d`，支持增量构建缓存。

### 14.3 必需环境变量 (.env)

| 变量 | 用途 |
|------|------|
| `MCP_API_KEY` | MCP 服务器认证 Bearer token |
| `MCP_HOST` / `MCP_PORT` | MCP 服务器地址 |
| `COMFYUI_FIXED_URL` | ComfyUI 实例地址 |
| `COMFYUI_FIXED_TOKEN` | ComfyUI 实例认证 token |
| `COMFYUI_FIXED_T2I_AGENT_ENABLE` | T2I Agent 功能开关 |
| `COMFYUI_FIXED_T2I_AGENT_API_*` | T2I Agent 的 LLM 配置 |
| `TTS_*` | TTS 端点白名单和预设 |
| `NYAAACOUNT_API_TOKEN` | NyaaAcount 通信共享密钥 |
| `PRIVATE_DOCKER_REGISTRY_HOST` | Docker 镜像仓库地址 |

> `.env` 文件不入 Git。

### 14.4 数据持久化

- **image-cache** (Docker volume): nginx 图片代理缓存 (5GB)
- **db/** (bind mount): shared-server 和 knowledge-server 的 SQLite 数据库文件
- **covers/** (bind mount): 角色封面图片
- **user-storage/** (bind mount): 用户文件存储

---

## 15. 关键类型定义参考

核心 TypeScript 类型位于 `src/types.ts`。以下是几个关键接口：

```typescript
// 角色规则
interface WorldInfoRule {
  id: string;
  name: string;
  content: string;
  triggerType: "permanent" | "keywords";
  keywords: string[];
  position: "system" | "assistant";
  allowRecursion: boolean;
  hard: boolean;               // 硬约束 vs 软设定
  linkedKbIds: string[];       // 关联的知识库 ID
}

// LLM 提供者 (v2)
interface LlmProvider {
  id: string;
  kind: "qiny" | "gemini" | "anthropic" | "openai" | "deepseek" | "ollama" | "custom";
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  apiFormat: "openai" | "anthropic";
  models: ModelEntry[];
}

// 账户资料
interface AccountProfile {
  account: string;
  username: string;
  catfood: number;
  slotMax: number;
  kbMax: number;
  comfyuiPackRemaining: number;
  charStorageMax: number;
  chatStorageMax: number;
}
```

> 完整类型定义请直接查阅 `src/types.ts`。

---

*最后更新: 2026-07-11*
