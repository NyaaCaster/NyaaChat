# SSOT 复核报告：知识库改动影响 + 设计完备性

> 复核对象：`开发计划-SSOT.md`（V1）
> 复核目的：① 确认刚完成的知识库修复不影响本设计；② 找出所有会导致"执行期现场决策"的设计空洞
> 复核方式：逐条对照真实源码，不依赖推测

---

## 第一部分：知识库修复对设计的影响

本轮已提交 `nyaachat-knowledge@6a45cb3`，含两项修复。逐项核对对本设计的影响。

### 1.1 向量表按维度分区 — 无影响，且解除一处依赖

SSOT 不变量 10「V1 不写 `vec_chunks`」现在表述已过时：**不存在**名为 `vec_chunks` 的表，
只有 `vec_chunks_<dim>` 分区。

不变量应改写为：**V1 不调用 `ensureVecTable()`、不向任何 `vec_chunks_*` 分区写入。**

正面影响：SSOT §2 原写「`getVecDim` 修复须在 P1 启动前完成」——**该前置已完成**，
且 `ingest.js` 现在的失败点只剩 `getEmbeddingConfig` 缺失一处（原先还有 `getVecDim` 不匹配一处），
P1「支持无嵌入配置写入」的改造面比原计划更小。

### 1.2 FTS5 query 净化 — **对本设计是决定性的正面影响**

修复前，稀疏检索有两个静默失效：特殊字符抛错被空 catch 吞掉；CJK 自然语句召回恒为 0。

SSOT 决策 ② 是**纯稀疏**，记忆检索没有 dense 兜底。若不修，本系统召回率接近 0 且不报错。
修复后 `searchKnowledgeBase()` 的稀疏实现已具备：

- query 全部转 quoted phrase，任何字符不再抛错
- `strict AND → loose OR` 两趟，CJK 长串切重叠窗口

**但这引出一个 SSOT 必须补的决策**：SSOT §6 明确写「`searchMemory()` 单独实现，**不复用**
`searchKnowledgeBase()`」。那么刚修好的 `fts5Terms()` / `fts5Query()` / 两趟策略
**必须被 `searchMemory()` 共享，而不是重新实现一遍**——否则记忆检索会重现刚修掉的两个 bug。

→ 见补充设计 `设计-记忆检索实现.md`（提取共享模块的具体方案）。

### 1.3 结论

知识库修复不与本设计冲突，且移除了一项前置依赖、修掉了一个会让 V1 失效的地基缺陷。
需要 SSOT 修订的是措辞与共享策略，不是架构。

---

## 第二部分：SSOT 中的事实错误（必须更正）

复核中发现 SSOT 引用的代码事实有误，若照原文开发会直接踩空：

| SSOT 位置 | 原文 | 实际 | 影响 |
|---|---|---|---|
| §8 落点摩擦 | `UserAccountModal` 有「5 处调用点」 | **9 处**：`CharacterSelectionModal:723`、`ChatHeader:247`、`ChatHistoryModal:503`、`ChatInterface:1493`、`ImageProvidersModal:305`、`KnowledgeBaseModal:511`、`SettingsModal:604`、`SharedLibraryModal:707`、`WorldInfoRuleModal:670` | 漏改 4 处会导致 TS 编译失败或该入口开关失效 |
| §8 落点摩擦 | 「`ChatHeader`、`ChatHistoryModal` 需补 props 通道」 | 需补的是 **4 处**：`ChatHeader`、`ChatHistoryModal`、`KnowledgeBaseModal`、`SharedLibraryModal`、`WorldInfoRuleModal` 均**不持有** `settings`（grep 计数为 0 或 1） | 同上 |
| §8 / §9 | 组件名 `ConfirmModal` | 实际是 **`ConfirmDialog`**（`src/components/ConfirmDialog.tsx`），props 为 `{isOpen, title?, message: ReactNode, confirmText?, cancelText?, destructive?, onConfirm, onCancel}` | import 报错 |
| §11 不变量 10 | 「V1 不写 `vec_chunks`」 | 该表已不存在 | 验收项无法执行 |
| §5 | `documents` 缺 `char_count` 讨论 | `chunks.char_count` 存在，但 `documents` 无字符计数列；`knowledge_bases.char_total` 由 `touchKb` 从 `chunks` 聚合 | `memory_char_max` 的计量口径未定义（见空洞 H） |

**另外，§8 的 props 方案本身需要重新决策**：让 9 个调用点全部下传 `settings` + `onSettingsChange`
是一次范围不小的改动，且 `KnowledgeBaseModal` / `SharedLibraryModal` / `WorldInfoRuleModal`
完全不关心 settings，为一个开关加两个 prop 属于污染。
→ 见补充设计 `设计-账号界面与设置存档.md`（给出方案对比与定案）。

---

## 第三部分：设计空洞清单

以下每一项，若按现有 SSOT 直接开发都会在执行期被迫现场决策。按严重度排序。

| # | 空洞 | 现有 SSOT 状态 | 落点 |
|---|---|---|---|
| A | 提炼触发的**完整状态机**：何时判定、判定后 UI 形态、用户三种选择的后续、失败/中断/重试、并发保护 | 只有「≥70% 就提示」一句 | `设计-提炼触发与状态机.md` |
| B | **提炼提示词全文**与输出解析规则、非法输出如何处置 | 只有 6 个字段名和一句防注入要求 | `设计-提炼提示词与输出规约.md` |
| C | **"最老 N 轮"的 N 如何确定**、边界怎么切（不能切开 user/assistant 配对）、图片气泡与 system 消息如何处理 | 未提 | `设计-提炼触发与状态机.md` |
| D | `searchMemory()` 的**检索实现**：复用哪些代码、query 从哪来、topK、结果如何拼块 | 只说「单独实现、单路 BM25、按 session 过滤」 | `设计-记忆检索实现.md` |
| E | **记忆分界 UI** 的数据来源与渲染：分界位置存在哪、多批次多条分界怎么显示、导出/导入是否保留 | 只有「加可见标记」 | `设计-记忆分界UI与消息模型.md` |
| F | **`contextWindow` 手动覆盖入口**放在哪个界面、什么形态、与 `inferLimits()` 的优先级 | 只说「提供入口」 | `设计-上下文预算与覆盖入口.md` |
| G | **TTL / 心跳的具体参数**：心跳频率、TTL 时长、清扫触发时机与执行者（无 cron 的服务里谁扫） | 只说「TTL 兜底 + 禁止全量对账」 | `设计-记忆生命周期与配额.md` |
| H | **`memory_char_max` 计量口径**（按 chunk 字符和？按 document？含 overlap 重复计算？）与超限二次压缩算法 | 只说「2MB + 超限合并重提炼」 | `设计-记忆生命周期与配额.md` |
| I | **`<memory_context>` 块的确切文本格式**、字符上限、与 `<search_context>` 同时存在时的顺序 | 只说「同 buildKbSearchContext」 | `设计-记忆检索实现.md` |
| J | **锚点扩展的确切文本**（会全量击穿缓存，改一次的措辞必须一次定稿） | 只说「需扩展声明」 | `设计-记忆检索实现.md` |
| K | **提炼调用走哪条链路**：复用 `fetchChatCompletion` 还是新函数、是否流式、是否带 tools、是否进日志面板 | 未提 | `设计-提炼触发与状态机.md` |
| L | **token 预估怎么算**（要显示给用户的数字） | 只说「给出预估」 | `设计-提炼触发与状态机.md` |
| M | 记忆库**懒创建的并发与幂等**：两个 tab 同时触发怎么办 | 只说「懒创建」 | `设计-服务端API与数据模型.md` |
| N | 五个记忆端点的**完整请求/响应/错误码契约** | 只有一句作用描述 | `设计-服务端API与数据模型.md` |
| O | `kind='memory'` 过滤点是否完整（SSOT 列 3 处） | 实际还有 `getKb`/`GET /kb/:kbId`、`character_kb_bindings`、`POST /search` 三条可绕过路径 | `设计-服务端API与数据模型.md` |
| P | 前端 API client 的**函数签名**（`knowledgeApi.ts` 风格） | 只说「沿用同一风格」 | `设计-服务端API与数据模型.md` |
| Q | 关闭开关后**已有记忆如何处置**（保留？删除？停止新增但保留旧的？） | 未提 | `设计-账号界面与设置存档.md` |
| R | **未登录用户**触发到阈值时的行为（记忆系统要求登录） | 未提 | `设计-提炼触发与状态机.md` |

### 特别说明：空洞 O 的安全性质

这一项不是"细节缺失"，而是**越权风险**。SSOT §5 只列了 3 个过滤点，但实际代码里
`kind='memory'` 库还能通过以下路径被触达：

1. `GET /kb/:kbId`（`routes/kb.js:134`）—— 只校验 `owner`，不校验 `kind`。
   用户拿到记忆库 id（会在 ingest 响应里出现）即可读取其元数据
2. `PATCH /kb/:kbId`（`:147`）—— 同样只校验 owner，**用户可改记忆库的 chunk_size / 名称**
3. `DELETE /kb/:kbId`（`:185`）—— 用户可整库删除自己的记忆库（可接受，但需明确是否允许）
4. `POST /search`（`routes/search.js:37`）—— `checkKbAccess` 只看 owner 与 bindings，
   **用户可直接对记忆库发起跨 session 全库检索，绕过决策 ④ 的 session 隔离**
5. `POST /kb/:kbId/documents`（documents 路由）—— 用户可往记忆库塞任意文档
6. `character_kb_bindings` —— 若记忆库 id 被写入 bindings，将获得**跨账号只读**权限

第 4 条直接击穿决策 ④（严格 session 隔离）。必须在设计阶段定死，不能留到执行期。
→ 详见 `设计-服务端API与数据模型.md` 的"kind 守卫矩阵"。

---

## 第四部分：补充设计文档索引

| 文档 | 覆盖空洞 |
|---|---|
| `设计-服务端API与数据模型.md` | M, N, O, P + schema 迁移细节 |
| `设计-记忆检索实现.md` | D, I, J + 共享 FTS 模块提取 |
| `设计-提炼触发与状态机.md` | A, C, K, L, R |
| `设计-提炼提示词与输出规约.md` | B |
| `设计-记忆分界UI与消息模型.md` | E |
| `设计-上下文预算与覆盖入口.md` | F |
| `设计-记忆生命周期与配额.md` | G, H |
| `设计-账号界面与设置存档.md` | Q + §8 props 方案定案 + ConfirmDialog 更正 |

8 份文档均已写入本目录，并在 `开发计划-SSOT.md` §15 建立索引。

### 复核期间新增的定案（不在原 18 项空洞内，但同属"避免执行期决策"）

| 定案 | 出处 |
|---|---|
| 端点从 5 个增至 **8 个**：补 `GET /memory/batches`、`POST /memory/recompress`、`DELETE /memory/all` —— 原 5 个端点无法完成二次压缩，也没有清空出口 | `设计-记忆生命周期与配额.md` §3.2、`设计-账号界面与设置存档.md` §5.3 |
| `AppState` 增至 **4 个**新字段：补 `memoryDisclosureAcceptedAt` —— 用 `isMemoryEnabled` 判断"是否首次开启"在关掉再开时会跳过披露 | `设计-账号界面与设置存档.md` §6.1 |
| `App.tsx` 的 `SCHEMA_VERSION` **8 → 9** —— SSOT 只提了 `settingsBackup.ts` 的导出版本，漏了 IDB 侧迁移 | `设计-账号界面与设置存档.md` §6.3 |
| 新增环境变量 `MEMORY_TTL_DAYS`（默认 90）—— SSOT §12 原写"无新增" | `设计-记忆生命周期与配额.md` §2.3 |
| 不变量从 11 条增至 **13 条**：补"共用同一份 FTS5 净化实现"、"记忆库切片参数服务端固定" | `开发计划-SSOT.md` §11 |
| 记忆配额付费扩容移出 V1 范围 —— 需跨项目改 NyaaAcount 计费登记 | `设计-记忆生命周期与配额.md` §1.4 |
| `ExtractionPhase` 增 `recompressPrompting` / `recompressing` 两态，`failed.stage` 增 `"recompress"` —— 原状态机没有二次压缩的位置，ingest 的 409 会被当普通失败处理 | `设计-提炼触发与状态机.md` §3 |
| `skipped` 不是 phase 而是与 phase 正交的 `skippedAtMessageCount` —— 作为 phase 会在回到 idle 后立刻重新弹窗 | `设计-提炼触发与状态机.md` §3 |
| `failed` 的「重试」按 `stage` 三分派（仅 `ingest` 不重新调模型）—— 原文只说"不自动重试"，未说重试什么 | `设计-提炼触发与状态机.md` §3.1 |
| `heartbeatMemory()` 返回 `{touched, swept}`，`MemoryBatch` 类型与 3 个新端点的 client 函数统一落在 `设计-服务端API与数据模型.md` §5 | 同处 |
| 建立"契约唯一归属"表：同一契约只在一处定义，其余引用 —— 避免 8 个端点的契约在三份文档里各写一遍后互相漂移 | `开发计划-SSOT.md` §15 |

### 仍待用户决策（不阻塞 P1）

| 事项 | 说明 |
|---|---|
| `knowledge_bases.sparse_top_k` / `dense_top_k` 形同虚设 | 两列存在且可由 `PATCH /kb/:kbId` 修改，但 `retrieval.js` 两条路径均硬编码 `50`、从不读取。属 FTS5 修复时发现的既有缺陷，与本 V1 无直接关系 |
| `nyaachat-knowledge/package-lock.json` 是否入库 | 新生成、当前未跟踪 |
| ~~真实库迁移与部署~~ | **已于 2026-07-27 完成**：两端各自备份（`*-backup-vecpartition-migrate-20260727.db` 含 WAL/SHM）→ dry-run 审计 → `--commit`。两库均 431 向量 / 431 chunk / 旧表已删 / 无缺向量 chunk；owner `nyaa` 与 `nyaa4128` 同为 4096 维，**无维度错配，历史 bug 未造成向量丢失**。镜像 `ab46f3a` 推送，macmini 已重启上线 |
| ~~`sparse_top_k` / `dense_top_k`~~ | 用户定案：**维持不改**。两列恒为默认 50，与硬编码值相同，当前无行为差异 |
| ~~`package-lock.json`~~ | 用户定案：**不入库**，已加入 `nyaachat-knowledge/.gitignore`。Dockerfile 走 `npm install` 而非 `npm ci`，入库只会得到一个不生效的锁 |
