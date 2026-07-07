# COMFYUI_FIXED T2I Agent — 开发计划 SSOT（V1）

> 本文件是本功能开发阶段的**唯一事实来源（Single Source of Truth）**。
> 关联文档：`V1初始设计.md`（初始设计）、`设计决策.md`（决策记录）。
> 所有文档置于 `NyaaChat/.docs/comfyui-fixed-t2i-agent/`。

## 1. 目标与范围

**目标**：为 NyaaComfyUI（`comfyui-fixed`）实现独立的画图提示词生成 agent，用部署方 LLM API 生成"结构化分析 + 分段英文自然语言"的高质量提示词。

**V1 范围（做）**：
- ext-host 服务端 LLM 代理端点（注入部署方 key/baseURL/model）。
- agent 提示词工程：结构化分析框架 + 分段 + 软字数控制。
- 前端接线：`comfyui-fixed` 路径按开关走新 agent，失败回退。
- 端到端验证。

**V1 范围（不做，留 V2+）**：
- 动漫 / 真人模型方向的差异化设计。
- 故事时代背景 / 画风的深度设计。
- 角色结构化字段固化（NPC 一致性配置 → 留给 AVG-AdventurerTavern）。
- 双阶段 LLM。

## 2. 架构方案（已确认）

```
用户点「基于此消息生成图片」(comfyui-fixed 且 AGENT_ENABLE=true)
  └─ 前端 buildFixedComfyPromptRequest：组装 {system, user}（结构化框架+场景上下文）
       └─ POST /api/ext-host/t2i-agent/chat   ← 无密钥，只带 messages
            └─ nginx 转发 ext-host:3099/t2i-agent/chat（超时 300s）
                 └─ ext-host proxyT2iAgent：
                      · 从 process.env 注入 baseURL + Bearer key + model
                      · fetch deepseek /v1/chat/completions（非流式）
                      · 回传英文分段提示词
  └─ 前端拿到 prompt → generateComfyImage(...) → 出图 → consumeComfyuiPack 扣费

AGENT_ENABLE=false 时：comfyui-fixed 回退到 buildComfyPromptRequest + 用户对话 LLM（同 custom 路径）
```

## 3. 环境变量约定（以 .env 为准）

| 变量 | 用途 | 注入面 |
|------|------|--------|
| `COMFYUI_FIXED_T2I_AGENT_ENABLE` | 开关 true/false | vite define → 前端 `__COMFYUI_FIXED_T2I_AGENT_ENABLE__`；ext-host 也读 |
| `COMFYUI_FIXED_T2I_AGENT_API_BASEURL` | agent LLM baseURL | 仅 ext-host（服务端） |
| `COMFYUI_FIXED_T2I_AGENT_API_APIKEY` | agent LLM key（密钥） | **仅 ext-host，绝不进前端** |
| `COMFYUI_FIXED_T2I_AGENT_API_MODEL` | agent model | 仅 ext-host（服务端强制） |

## 4. 关键约束

- 🔴 **密钥安全**：key/baseURL/model 只在 ext-host `process.env` 读取，前端 bundle、浏览器请求、URL 中都不得出现。
- 🔴 **软字数控制**：字数/分段作为提示词文本注入，**禁止 slice LLM 输出**。目标 ~360 词 / 6 段 / 每段 40-80 词。
- ext-host 新端点忽略 body 中任何密钥字段，baseURL 服务端固定。
- 计费逻辑（`consumeComfyuiPack`）不变。
- 自动化脚本用 Python（rebuild.py 已有）。

## 5. 阶段划分（V1）

状态：⬜ 未开始 / 🟡 进行中 / ✅ 已完成

### ✅ P0 — 三路径脚手架拆分（已完成）
- `handleGenerateImage` 拆为 isComfyPack / isComfyImage / else 三分支。
- `buildFixedComfyPrompt` + `buildFixedComfyPromptRequest` 脚手架就位（当前委托旧逻辑）。

### ✅ P1 — ext-host 服务端代理端点
- `ext-host/src/server.js`：新增 `proxyT2iAgent()`（照抄 proxyTts），路由 `POST /t2i-agent/chat`。
  - 从 `process.env` 取 baseURL/key/model；忽略 body 密钥字段。
  - 组装 deepseek 请求体：`{ model: <env>, messages: <body.messages>, stream: false }`。
  - 注入 `Authorization: Bearer <env key>`，fetch，回传 JSON。
  - 错误处理：env 缺失 → 明确错误；上游非 200 → 透传状态与错误。
- `docker-compose.yml`：给 ext-host 加 `env_file: - .env`（或显式传三项）。
- `nginx.conf`：新增 `location = /api/ext-host/t2i-agent/chat`（或复用 `/api/ext-host/` 前缀），`proxy_read_timeout 300s`、`proxy_buffering off`。
- **验证**：curl 本地端点，确认 (a) 正常返回、(b) 缺 key 时报错、(c) 前端 bundle 与响应中无 key/baseURL、(d) model 由服务端决定。清理测试产物。

### ✅ P2 — Agent 提示词工程
- 重写 `buildFixedComfyPromptRequest`（`src/lib/chatPipeline.ts`），产出 `{system, user}`：
  - **system**：内置结构化分析框架，至少覆盖初始设计 7 维度——
    ① 角色塑造（年龄/人种/身份/衣着/性格/状态）
    ② 角色形象切片（动作/神态/行为阶段）
    ③ 场景情景（场景元素/主题元素/氛围元素/布局/相关物件/显隐元素）
    ④ 氛围表达（情绪/故事/真实性/美学/主题色调）
    ⑤ 着眼点（视角判定/单人 vs 同框 vs 群像/主次）
    ⑥ 视觉术语（摄影风格/镜头/角度/取景/质感/光照/光圈/景深）
    ⑦ 约束条件（must-keep / must-avoid，替代负面提示词）
  - **分段要求**：输出分段自然语言（对应 TestPrompt 的 `\n` 分段），非单句堆砌。
  - **软字数**：注入 ~360 词、6 段、每段 40-80 词的目标（提示词文本，非截断）。
  - **语言**：纯英文输出。
  - **user**：角色 description + 用户 profile + 最近 N 轮场景 + 焦点消息（输入侧 truncate 控 token）。
- 参考 `TestPrompt.md`、`.ref/TestPrompt的结构化拆分.json`、`.ref/一个结构化的画图提示词样例.md`（理解结构，不照抄）。
- **验证**：用样例场景跑 agent，人工评审输出是否分段、维度齐全、字数达标、纯英文。

### ✅ P3 — 前端接线
- vite define 注入 `__COMFYUI_FIXED_T2I_AGENT_ENABLE__`（`vite.config.ts`）+ 类型声明（`vite-env.d.ts`）。
- `buildFixedComfyPrompt`（`ChatInterface.tsx`）改造：
  - AGENT_ENABLE=true：组装结构化 `{system, user}` → POST `/api/ext-host/t2i-agent/chat`（无密钥，非流式）→ 取回英文提示词。
  - AGENT_ENABLE=false：回退 `buildComfyPromptRequest` + 用户对话 LLM。
  - LLM 失败：回退 `buildImagePrompt`（保持现有 fallback）。
- 新增前端 API 封装（如 `src/lib/t2iAgentApi.ts`）调用 ext-host 端点。
- **验证**：开关两态各跑一次，确认路由正确、fallback 生效。

### ✅ P4 — 端到端验证与调优
- 真实出图对比：新 agent vs 旧 custom 路径，评估画质提升。
- 边界：agent 端点宕机 / 超时 / 空返回的回退链路。
- 成本观察：单次 agent 调用 token 量。
- 调优 system prompt。
- **验证**：完整链路 E2E，清理测试数据。

## 6. 阶段收尾要求（每 P）

按用户级 CLAUDE.md + 工作空间 CLAUDE.md：
1. 验证通过且无需用户测试 → 更新本 SSOT 状态标记 + 交接文档（`阶段交接-XXX.md`）。
2. `git status` / secret 检查（三仓分离：主仓、knowledge、shared 各自提交）。
3. commit-push skill 提交推送。
4. 需用户测试的阶段（如 P2 提示词评审、P4 画质评估）→ 停在交接点，列出待验证项。
5. rebuild.py 重建验证，清理测试产物。

## 7. 涉及文件清单

| 文件 | 仓库 | P 阶段 | 改动 |
|------|------|--------|------|
| `ext-host/src/server.js` | 主仓 | P1 | 新增 proxyT2iAgent + 路由 |
| `docker-compose.yml` | 主仓 | P1 | ext-host 加 env_file |
| `nginx.conf` | 主仓 | P1 | 新增/调整 location + 超时 |
| `src/lib/chatPipeline.ts` | 主仓 | P2 | 重写 buildFixedComfyPromptRequest |
| `vite.config.ts` | 主仓 | P3 | define AGENT_ENABLE |
| `src/vite-env.d.ts` | 主仓 | P3 | 类型声明 |
| `src/lib/t2iAgentApi.ts`（新） | 主仓 | P3 | ext-host 端点封装 |
| `src/components/ChatInterface.tsx` | 主仓 | P3 | buildFixedComfyPrompt 接线 |
| `.env.example` | 主仓 | P1 | 补充四项变量模板 |

全部落在**主仓**，不涉及 knowledge / shared 私有子仓。
