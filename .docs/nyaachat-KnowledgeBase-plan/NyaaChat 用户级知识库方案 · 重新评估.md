# NyaaChat 用户级知识库方案 · 重新评估

> 本文基于对 NyaaChat 源码、shared-server 子服务范式、NyaaAcount 鉴权链路、以及 NyaaLibrary-MCP 检索栈的实际通读，对「用户级知识库 + 对话角色规则条目关联」方案做的重新评估。用于替代此前与 Gemini 的讨论（Gemini 未读代码，多为推测）。
>
> 参考对话记录：`.ref/与Gemini进行的知识库方案讨论.md`
> 关键代码引用：`src/types.ts`、`src/lib/chatPipeline.ts`、`shared-server/`、`docker-compose.shared.yml`、`nginx.conf`、`NyaaLibrary-MCP/server/src/`

## 一句话结论

方案整体成立，而且比 Gemini 想象的更契合现有架构——因为触发机制、注入通道、账号体系、检索栈、子服务范式这五块，NyaaChat 里已经全部存在，不是从零造，而是「连线」。但 Gemini 因为没看代码，漏掉了这个设计真正的难点（前后端边界上的悬挂引用与缓存破坏），也提了两条与现有架构相冲突的建议。

## 一、Gemini 判断里，哪些对、哪些错

**对的（有代码支撑）：**

- 「规则条目 = Lorebook / World Info」的类比准确。规则条目就是 `WorldInfoRule`（`src/types.ts:116-135`），字段 `triggerType: "permanent" | "keywords"`、`keywords`、`content`、`hard`、`enabled` 齐全，且每条有稳定 `id`。
- 「把知识库触发权交给条目 = 极致 token 节省」方向正确。
- 「拟人化隔离 wrapper」和「限制单条注入 token 上限」两条避坑建议本身是对的。

**错的 / 需要修正的：**

1. **他把「是否要选语义路由 / ToolUse / 关键词」当成一道待决题——其实无须选。** `chatPipeline.ts:349-378` 已经实现了完整的关键词触发 + 递归激活链。知识库检索直接挂在「条目被激活」这个既有事件之后即可，不需要新增任何路由层。

2. **他建议「把检索结果加 wrapper 贴在 System Prompt 后面」——这与现有架构相冲突。** pipeline 有明确的静态前缀缓存纪律（`chatPipeline.ts:395-402`），permanent 世界书进静态前缀且「逐字节不变以命中缓存」。检索结果是每轮都变的动态文本，若塞进 system 前缀会**每轮击穿 prompt cache**。代码里已经给出正确答案：`chatPipeline.ts:427-430` 明写着 “Search context is NOT here — it rides the user turn instead”。**知识库检索内容应当复用 web 搜索那条既有通道，挂在 user turn 上，而不是 Gemini 说的 system 尾部。**

3. **他完全没意识到这个设计真正的难点：这根「关联」线跨越了前后端边界。** 世界书条目是**纯前端数据**（`WorldInfoRule` 挂在 `CharacterSettings.worldInfo`，随角色存 localStorage/IndexedDB）；而知识库是**后端按账号隔离的多用户服务**。三个项目问题的根子全在这条边界上——见第四节。

## 二、可行性：五块拼图都已就位

| 需要的能力 | 现状 | 结论 |
|---|---|---|
| 触发机制 | `chatPipeline.ts` 已有 keywords / permanent + 递归激活 | 复用，不新建 |
| 注入通道 | web 搜索已走「外部文本挂 user turn」（`chatPipeline.ts:427-430`） | 复用同一通道 |
| 子服务范式 | shared-server = 独立 compose project + external network + 主 nginx 反代 `/api/shared/` + 独立 `rebuild-shared.py` | **照抄**成 `library-server` / `/api/library/` |
| 账号 & 额度 | NyaaAcount client 封装好；已有 `catfood` / `slot_max` / `spent_total` 经济模型 + 花积分扩容事务 | 复用鉴权，额度按知识库数 / 文档字节计 |
| 检索栈 | NyaaLibrary-MCP：SQLite + sqlite-vec 稠密 + FTS5 稀疏 + RRF 融合，纯自包含（`retrieval.ts` 全文 102 行） | 移植核心 service |
| Embedding 配置 | NyaaLibrary 用标准 OpenAI 兼容 `/embeddings` 自动探测维度；NyaaChat `ModelEntry` 已有 `embed` / `rerank` capability（`types.ts:254-261`） | 同构，可统一 |

**关于「fork NyaaLibrary-MCP 还是借核心另起」的建议：借核心、另起子服务。** 理由：

1. NyaaLibrary 是单用户（`config.ts:34-35` 一个 AUTH_USERNAME），改多用户要给 `knowledge_bases / documents / chunks` 全部加 `owner` 维度并重写鉴权——伤筋动骨；
2. 它带 MCP 对外端点，内部用不上；
3. 但它的 `services/{retrieval,embedding,chunk,ingest}.ts` 与 MCP 完全解耦，可以近乎原样搬进新的 `library-server`。

**移植 4 个 service 文件 + 重写 db schema（加 owner）+ 套 shared-server 的鉴权外壳**，比 fork 改造干净得多。

## 三、一个架构决策点需要拍板：检索在前端做还是后端做

这是全案最关键的岔路口，Gemini 没提。世界书激活现在**发生在前端** `chatPipeline.ts`。知识库检索**必须在后端**（向量库在服务端）。所以链路怎么接，有两种：

- **A｜前端编排**：前端算出哪些条目被激活 → 收集它们关联的 kbId → 调 `/api/library/search` 拿 chunks → 拼进 user turn。改动集中在 `chatPipeline.ts`，与现有 web 搜索模式一致，**推荐**。
- **B｜后端编排**：把整个 prompt 组装搬后端。契合「子服务独立」，但要重写成熟的 pipeline，工程量大、回归风险高。

**推荐 A**：后端子服务只做纯粹的「给定 kbId + query，返回 chunks」，前端负责「激活 → 检索 → 注入」的编排，最小化对现有 pipeline 的侵入。

## 四、正式回答三个 NyaaChat 项目问题

### Q1：用户删除已关联的知识库后，条目里的关联关系怎么处理？

这正是前后端边界的悬挂引用问题。关联关系（kbId）存在前端角色数据里，知识库存在后端——后端删库时**无法**回头改用户浏览器里的角色 JSON。所以只能用**软引用 + 懒失效**：

- 前端 `WorldInfoRule` 加 `linkedKbIds?: string[]`，只存 id。
- 后端删库**不**尝试同步前端（也做不到）。
- 检索时后端对不存在的 kbId 返回空 + `stale: true`；前端据此在条目上显示「关联失效」，让用户手动清理或重连。
- **绝不做级联硬删**（去自动抹掉条目里的 id）——那会在用户误删 / 换设备时静默破坏角色数据。悬挂引用是无害的（检索时跳过即可），静默改用户数据才是有害的。

### Q2：编辑角色界面，条目要显示关联状态吗？要显示连接有效性吗？

- **关联状态：要。** 条目上显示一个 KB 徽标（如 `📚 ×2`），这是核心可用性——否则用户看不出哪条挂了库。落点在 `WorldInfoRuleModal.tsx`（现 313 行）。
- **有效性状态：要，但必须懒加载、不可阻塞。** 别在打开编辑器时对每个 kbId 同步探活——会让 UI 卡在网络请求上。做法：默认只显示「已关联 N 个」（纯前端，读 id 即可，零请求）；用户展开某条目时才异步查一次有效性，三态呈现 `有效 / 失效(已删) / 检查中`。有效性是「nice to have 的健康提示」，绝不能变成打开编辑器的前置阻塞。

### Q3：一个条目能否同时关联多个知识库？对 LLM 负担严重吗？

- **能，用数组 `linkedKbIds: string[]`。** 用户资产复用（一个「克苏鲁规则书」库挂给多角色 / 多条目）是这个设计的核心价值，多对多是应该支持的。
- **「严重负担」这个说法要拆开看，真正的风险不是「关联几个库」，而是「注入多少 token」。** 关键数据支撑：pipeline 用 `hard` / `soft` 分区注入（`chatPipeline.ts:439-446`），一次触发多条世界书本就是常态。多库的风险只在于——多个库各返回 Top-K，chunk 叠加可能瞬间顶爆上下文（尤其本地小模型）。
- **控制手段应该按「预算」而非「库数量」设计**：在「关联知识库」这个动作上，让用户设一个**该条目触发时的总注入 token 上限**（如默认 800），无论挂了几个库，多库检索结果统一 rerank / 截断到这个预算内。这样「关联 3 个库」和「关联 1 个库」对 LLM 的负担上限是**一样的**——锁的是输出预算，不是输入数量。这也正好把 Gemini 那条「限制单条注入 token」的建议落到实处，且更彻底。

## 五、额外发现的、讨论里没提的三个坑

1. **Prompt cache 破坏**（见第一节第 2 点）：知识库检索必须走 user turn 动态通道，绝不能进 permanent / 静态前缀。这是硬约束，写进设计。
2. **Embedding 维度锁定**：sqlite-vec 虚拟表建表即锁死维度（`db/index.ts:98-112`），用户中途换嵌入模型（换维度）会使旧向量全部失效需重嵌。UI 上要明确警告「更换嵌入模型将需重建索引」。
3. **多用户共享一个向量库文件的隔离**：NyaaLibrary 的 schema 无 owner 维度，检索靠 `kb_id` 过滤。改多用户后，`knowledge_bases` 必须带 `owner`，且**每次检索都要校验 kbId 属于当前登录用户**——否则用户 A 猜到 B 的 kbId 就能检索到 B 的私有库。这是安全边界，不能只靠前端不显示。

## 附：关键代码引用索引

| 主题 | 位置 |
|---|---|
| 规则条目类型 `WorldInfoRule` | `src/types.ts:116-135` |
| 角色类型 `CharacterSettings.worldInfo` | `src/types.ts:137-185` |
| `ModelEntry` 已有 `embed` / `rerank` capability | `src/types.ts:254-261` |
| 世界书关键词触发 + 递归激活 | `src/lib/chatPipeline.ts:349-378` |
| 静态前缀缓存纪律（permanent 进前缀） | `src/lib/chatPipeline.ts:395-425` |
| 「检索文本挂 user turn 而非 system 尾部」 | `src/lib/chatPipeline.ts:427-430` |
| hard / soft 分区注入 | `src/lib/chatPipeline.ts:439-446` |
| 子服务独立 compose + external network | `docker-compose.shared.yml` |
| 主 nginx 反代 `/api/shared/` 剥前缀 | `nginx.conf:241-245` |
| 独立 rebuild 脚本 | `rebuild-shared.py` |
| NyaaAcount 鉴权客户端（加密转发 + fail-closed） | `shared-server/src/nyaacount-client.js` |
| session token 鉴权中间件 | `shared-server/src/auth.js` |
| 额度经济模型（catfood / slot_max / 花积分扩容） | `shared-server/src/routes/account.js:36-64` |
| 检索栈 schema（kb / documents / chunks / fts5 / vec0） | `NyaaLibrary-MCP/server/src/db/index.ts:22-112` |
| 混合检索 + RRF 融合 | `NyaaLibrary-MCP/server/src/services/retrieval.ts` |
| Embedding 服务（OpenAI 兼容 `/embeddings`） | `NyaaLibrary-MCP/server/src/services/embedding.ts` |
</content>
</invoke>
