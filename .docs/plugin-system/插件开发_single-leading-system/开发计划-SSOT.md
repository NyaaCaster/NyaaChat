# 系统消息合并：开发计划 SSOT

更新日期：2026-10-18
源码基线：`master @ 124c557`
版本：V1 / 已冻结
状态：**用户已确认 UI 与文档定稿冻结，并授权 P1—P4 自动推进、验证及阶段收尾；重大方案变更再请用户决策。P1/P2 已验证完成，继续 P3。**

## 0. 使用约定与文档位置

前置阅读：[初始设计](./初始设计.md)、[审计报告](./审计报告.md)、[插件框架规范](../插件框架规范.md)。本文件面向实现者、测试者和项目负责人；用户确认冻结后，成为本插件开发的唯一事实来源。

本插件所有初始设计、审计、计划、验证和阶段交接文档均放在 `.docs/plugin-system/插件开发_single-leading-system`。代码放在 `plugins/single-leading-system`；宿主通用能力仍放在 `src/`，不能为了目录集中而把宿主执行器塞进插件。框架规范在上一级原文件增补，不复制出第二份。

初始设计保留历史评估与测试证据。其旧 thinking 开关、手动恢复和“全部参数不变”措辞已由 D10/D13/D14 撤销或修订；不得照旧实施。用户已确认的产品决策与本稿提出的具体接口分开：**本稿及 UI 已由用户冻结；后续变更按 §14 管理。**

## 1. 目标与范围

提供原生插件「系统消息合并」，由用户逐个选择供应商实例下的模型，采用 `single-leading-system` 策略，使主对话出站消息只有一条首 system；保留静态 assistant 的角色、真实聊天历史、动态世界书、RosettaStone、MCP 和附件。对实际启用该策略的主对话识别截断，并提供一次保留工具结果的自动恢复。

首版只处理 OpenAI 兼容 Chat Completions；不限供应商分类，不根据 Qwen/HauhauCS/Ollama 名称强制启用。不接入 Anthropic 原生接口、记忆提取、绘图提示词辅助、健康检查、模型列表或独立绘图代理。

明确不做：thinking 开关/预设/控制参数，token 配额配置与推算，思考正文展示/存储/续传，AF/RuleBreaker 兼容，插件后端与数据库，新的手动恢复入口，跨刷新恢复，生产上线。

## 2. 决策索引

完整理由与确认记录见审计报告；以下均已由用户确认。

| 编号 | 当前有效要求 |
| --- | --- |
| D1 | 现有出站层的通用消息结构策略，不建立 Ollama 专用规范化器 |
| D2 | 独立插件交付；原 thinking 开关部分已由 D10 撤销 |
| D3 | 设置页高亮警告要求关闭 AF；不新增发送前提示、确认或 AF 拦截 |
| D4 | 说明首段声明已核验 Qwen3.6/Qwen3.5 官方模板约束，跨供应商适用 |
| D5 | 截断识别＋保留工具结果的有限恢复，不设置/推算/增加预算 |
| D6 | 中文名「系统消息合并」；内部标识 `single-leading-system` |
| D7 | 合并静态 system；assistant 保角色及彼此顺序，移至首 system 后、历史前 |
| D8 | 总开关默认停用；逐 provider.id＋model.id 手动选择；停用保留配置；不自动名称匹配 |
| D9 | 首版仅 OpenAI 兼容 Chat Completions；Anthropic 原生路径不介入 |
| D10 | 取消 thinking 控件和预设，保持服务端默认思考行为；不提供关闭能力 |
| D11 | 仅主对话、新的重新生成请求及其工具续轮、自动恢复 |
| D12 | 整次发送共用一次恢复机会；是否已有正文按当前模型请求判断 |
| D13 | 已有工具结果后，恢复只汇总，不开放或执行新工具；允许未完成任务无法继续 |
| D14 | 仅同次发送内自动恢复，不提供手动/跨刷新检查点；重新生成是新请求 |
| D15 | 截断/失败不发成功完成事件；恢复成功只发一次；不回滚已发生副作用 |
| D16 | 误开 AF 时本轮插件完全不介入，原流程继续，只记不兼容日志 |
| D17 | 模型消失后保留配置并标为不可用；可手动移除；相同联合身份恢复后沿用 |

思考边界：目标模型已验证默认开启；本插件不发送开启或关闭参数。其他供应商的默认状态由部署端保证，不能把没有关闭参数描述为强制所有模型开启思考。

## 3. 配置与模型身份

### 3.1 唯一存储结构

```ts
// AppState.plugins['single-leading-system']，沿用框架存档机制。
{
  enabled: false,
  config: {
    schemaVersion: 1,
    models: [
      { providerId: "供应商实例ID", modelId: "模型ID", active: true }
    ]
  }
}
```

`defaults = { schemaVersion: 1, models: [] }`。不修改 ModelEntry、不增加 AppState/导出全局版本，不存 API key、baseUrl、模型副本或 thinking 字段。`active` 是逐模型勾选，不能用插件 config 顶层 `enabled`（框架会剥离该键）。

使用规则数组而不是深层映射；所有编辑经 `updateConfig({ schemaVersion: 1, models: nextRules })` 整体替换数组，解决框架深合并不能删除对象键的问题。读取配置的函数必须是纯函数，不通过读取动作自动写存档。

### 3.2 归一化与异常配置

- 缺少 schemaVersion 按 1 解读；显式未知版本不应用任何规则，设置页显示配置版本不支持。用户可点击“重置本插件配置”，使用设置面板内二次确认后写入 defaults；不自动破坏未知版本数据。这是设置操作确认，不是发送前提示。
- models 非数组按空处理；只接受普通对象、非空字符串 providerId/modelId；保留 ID 原始字节，不改大小写或用 trim 后的值替代匹配。
- active 非布尔值按 false；未知规则字段忽略。相同联合键重复时最后一条合法记录生效，输出按最终出现顺序排列。
- 普通非法条目忽略并在插件日志记结构诊断，不记录字段原值，不阻止其他合法规则。
- 选择、取消、删除记录都只改对应联合键；取消选择保留 active=false 记录，移除配置才删除记录。
- 插件总开关和逐模型开关都必须有效才应用；新模型默认未选择，规则表缺记录即不应用。

### 3.3 身份生命周期

- 以 `provider.id`＋`model.id` 严格匹配；供应商/模型展示名改动不影响规则。
- provider.enabled=false、模型缺失或协议不是 openai：配置保留但不可生效。原生 Anthropic 行显示“此接口不适用”，不能新勾选。
- 已删除的供应商/模型显示为“当前不可用”，必要时用保存的 ID 标识，提供“移除配置”。不自动迁移到同名新供应商。
- 供应商删除后重新建立得到新 ID：视为不同实例。原 ID 和模型 ID 同时恢复才沿用旧配置。
- 修改同一供应商实例的地址视为编辑原实例，规则继续绑定该 ID；插件不存地址指纹、不猜测部署变更。
- 本地导入/云端下载按现有框架流程恢复插件配置；旧版本缺该插件记录保持停用。导出仍经过统一插件归一化。

## 4. 通用宿主契约

本节为已冻结的接口设计；P1 已交付通用契约。采用叶子模块模式，遵循框架规范；不值导入注册表/runtime/backend/index。V1 最终交付的本插件计划必须包含 completionPolicy；该字段可选仅为了通用契约支持只做结构处理的策略及 P1/P2 的独立交付。

### 4.1 模型展示快照：src/plugins/modelContext.ts

```ts
export interface PluginModelCatalog {
  providers: readonly {
    id: string;
    name: string;
    enabled: boolean;
    apiFormat: 'openai' | 'anthropic';
    models: readonly { id: string; name: string }[];
  }[];
}
export function getPluginModelCatalog(): PluginModelCatalog;
export function subscribePluginModelCatalog(listener: () => void): () => void;
export function setPluginModelCatalog(next: PluginModelCatalog): void;
export function resetPluginModelCatalogForTests(): void;
```

App 推送白名单字段，无 apiKey/baseUrl。setter 重建只读结构、内容未变保持引用并不通知；空值收敛为空数组。订阅者异常隔离。设置面板以 useSyncExternalStore 订阅，写配置仍使用 props.updateConfig，不通过该快照写宿主。

### 4.2 出站契约：src/plugins/outbound.ts

```ts
import type { ApiMessage } from '../lib/api'; // type-only，不产生运行时回边

export interface ChatPromptLayout {
  staticPrefixLength: number;
  latestUserIndex: number;
  dynamicTailIndex: number | null;
}
export interface OutboundRequestContext {
  purpose: 'chat';
  providerId: string;
  modelId: string;
  apiFormat: 'openai' | 'anthropic';
  modelAvailable: boolean;
  answererFlagalacActive: boolean;
}
export interface OutboundMessageInput {
  messages: readonly ApiMessage[];
  layout: Readonly<ChatPromptLayout>;
}
export interface OutboundPolicyPlan {
  pluginId: string;
  strategyId: string;
  transform(input: OutboundMessageInput): ApiMessage[];
  validate(messages: readonly ApiMessage[]): void;
  handlesDynamicTail: true;
  completionPolicy?: 'bounded-recovery';
}
export interface OutboundPolicyRegistration {
  pluginId: string;
  resolve(context: Readonly<OutboundRequestContext>): OutboundPolicyPlan | null;
}
export function registerOutboundPolicy(registration: OutboundPolicyRegistration): () => void;
export function resolveOutboundPolicy(context: Readonly<OutboundRequestContext>): OutboundPolicyPlan | null;
export function resetOutboundPoliciesForTests(): void;
```

- 插件 setup 注册一个 resolver，闭包保存 `ctx.getConfig`，每次解析读取最新配置；不能在 setup 时固定旧配置。返回 disposer 移除自身注册。
- 相同 pluginId 重复注册为错误，不静默覆盖；多个策略同时匹配同一请求为明确冲突错误，不按 UI 排序决定执行顺序。首版仅一个策略，但把冲突行为固定。
- 不匹配时返回 null；匹配时返回只包含已复制配置与纯函数的固定计划，不在续轮再读全局状态。resolver 抛错记录归属并通过既有错误通道结束，不静默发送错误结构。
- 计划只处理消息和受限完成策略，**没有任意请求参数、URL、headers、凭据、预算或 thinking 修改口**。
- 只读约定覆盖嵌套 parts，转换器不能修改传入数组或对象；该契约不宣称是防恶意插件的沙箱。
- 宿主对转换结果做基础结构检查，再调用计划 validate；发送对象显式序列化，计划/layout/context 均不能进入 JSON。
- 通用宿主不知道插件名称、Qwen 或 Ollama。插件负责匹配模型，宿主只识别通用 completionPolicy。

### 4.3 生效判断与请求快照

主对话在原组装完成后、网络请求前用已有 activeProvider/activeApi 构造 context。不在 ApiSettings 中新增 providerId：主对话调用方直接提供已有供应商实例 ID，避免影响其他调用者。

`modelAvailable` 表示该供应商存在、enabled=true 且 modelId 仍在其模型列表。`answererFlagalacActive` 使用宿主现有 resolveFlagalacTarget 后 target!=none 的状态；即使某子选项全关，选择了有效 AF 目标仍按前提不满足处理，不扫描任意用户文本中的标签。

插件 resolver 首先确认配置命中，随后若 AF 状态为 active，记一条插件日志并返回 null；不返回合并或恢复计划。宿主于是继续原流程，不在气泡显示发送前警告，不修改 Bypass。未知/退休 target 仍按既有 none 收敛。

一次发送使用这一份策略快照直到结束。过程中停用插件、取消模型选择或改配置只影响下一次发送；需要终止当前请求仍使用现有“停止”按钮。退出/注销/切会话沿用宿主现有取消语义，本插件不增加后台恢复任务。

## 5. 组装边界与结构算法

### 5.1 带布局的业务出口

在 `chatPipeline.ts` 新增 `buildRequestEnvelope(args): { messages: ApiMessage[]; layout: ChatPromptLayout }`。原 `buildRequestMessages(args)` 保留为包装入口，仅返回 envelope.messages。把现有组装实现移动到新函数，不能为了取边界再跑一次原函数。

布局定义：

- staticPrefixLength = 原 systemMessages.length，前缀范围 `[0, n)`。
- latestUserIndex = `n + history.length - 1`，由组装器显式产出，不能按内容标签推断。
- dynamicTailIndex = 有尾部时 `messages.length - 1`，否则 null。
- `[n, latestUserIndex)` 是原真实历史，latestUserIndex 是当前 user；若有尾部必须紧随其后。
- 标记描述最终待发送数组（包括已有输入编码后的数组），而不是编码前临时变量。结构标记与消息分开保存，不写入持久化聊天。

### 5.2 转换与校验

1. 校验布局为合法整数、覆盖顺序正确；静态前缀只允许 system/assistant，静态内容必须是字符串；真实历史只允许现有 user/assistant，最新项必须是真实 user；动态尾若存在必须是单条 system。未知结构报可读布局错误，不能猜测或丢弃。
2. 静态 system 内容按原顺序以固定两个换行符拼接为一个首 system，原内容不 trim、不改标签；没有 system 时允许不造新 system。NyaaChat 主对话自带锚点，因此正常情况有首 system。
3. 静态 assistant 原角色/内容/彼此顺序保留，接在首 system 后；随后逐条保留真实历史和最新 user，不合并 assistant，不合并相邻 user。
4. 有动态尾时，将原完整文本作为新 text part 追加到最新 user，前置两个换行符，保留 `_volatile=true`；原 user 为 string 时先变成 text part，原为 parts 时复制数组并保留图片/文档/其他字段。空字符串尾移除、不追加空 part；尾内容不是字符串即报布局错误，不能静默丢弃非文本数据。
5. 动态尾随转换移除，不进入首 system。关键词/宏/EJS、MCP 规则、RosettaStone 两项顺序保持，检索与记忆不提升权限。
6. 输出不变量：索引0之后没有 system；有 user；顺序符合上述规则。转换只运行一次，工具续轮/恢复只调用 validate，不重复折叠。
7. 幂等验收使用转换后重建的规范布局（首 system＋静态 assistant 长度、最新 user 索引、tail=null）再次转换，结果相同；不把旧索引错误套在新数组上宣称幂等。

### 5.3 API 接入

为 fetchChatCompletion 增加可选第六参数，旧五参数调用完全兼容：

```ts
export interface PreparedOutboundRequest {
  plan: OutboundPolicyPlan;
  messages: ApiMessage[];
}
// fetchChatCompletion(..., outbound?: PreparedOutboundRequest)
```

该类型定义在 outbound.ts；主调用方 resolve 后执行 transform，生成 prepared；第一个 messages 参数传同一份转换后的数组，宿主检查其与 prepared.messages 是同一引用，防止传入不一致结果。无策略时传原 messages 且不传第六参数。

OpenAI 路径若有 prepared，跳过旧 foldTailSystemIntoLatestUser，仅使用 prepared.messages；否则原行为保留。每次 callOpenAIOnce 前执行 validate；主请求、工具续轮及次数耗尽后的最终调用都必须通过同一入口。Anthropic 不接收 prepared，误传为明确编程错误，不能悄悄转换。

保护路径序列化仅发 role/content 和存在的 tool_call_id/tool_calls；剥除既有 `_volatile`。不发 layout/context/pluginId/strategyId/完成策略。非目标路径保留现有序列化行为。无新增 reasoning_effort、think、enable_thinking、chat_template_kwargs、max_tokens 或 max_completion_tokens。

## 6. 完成状态与工具安全

### 6.1 保护模式结果

宿主使用通用 completionPolicy='bounded-recovery' 进入保护模式；非目标路径保持现有行为。可以抽取公共解析函数，但行为变化必须受模式控制，不能无意更改原供应商容错。

单次结果保留现有 usage/assistantText/toolCalls/finishReason，并补充：completed:boolean、protocolError?:string、hadVisibleText:boolean。只有实际调用 onChunk 才计 hadVisibleText；即使空白字符也算展示，不能重试后拼接。

非流式要求存在 choices[0]/message/明确 finish_reason。流式正确处理 chunk 边界、CRLF、末尾无换行、decoder flush、usage-only chunk 与 [DONE]；SSE 注释/控制行按协议忽略，损坏的 data JSON/上游 error 帧标为协议错误，不打印原帧内容。reader 结束但没有明确 finish_reason 不算完整。合法终止原因已收到后允许缺省 [DONE] 的服务正常结束；reader 抛错、取消仍分别处理。正文后继续接收合法 usage，结束之后再出现正文或新工具增量视为协议异常。

### 6.2 状态表

| 单次结果 | 行为 |
| --- | --- |
| stop＋非空白正文＋无 tool_calls | 本轮正常完成 |
| tool_calls＋完整合法工具调用 | 先校验整批，再执行；可无正文 |
| length＋当前请求无已展示正文＋尚有恢复机会 | 不执行本次 tool_calls，进入一次恢复 |
| length＋已有正文或已恢复过 | 保留正文，报截断，结束 |
| stop＋空白/无正文＋无 tool_calls | 报空回复，结束，不自动恢复 |
| tool_calls＋空列表、stop＋tool_calls、未知结束原因或缺原因 | 报协议不完整，结束，不执行工具 |
| 参数 JSON/工具身份/调用绑定不合法 | 报工具参数或协议错误，整批不执行 |
| HTTP 错误/网络中断/解析错误 | 沿现有错误入口结束，不自动恢复 |
| 用户取消 | 立即停止，保留已有正文，不恢复、不再执行下一工具 |
| 汇总专用请求返回 tool_calls | 不执行，明确报告无法在恢复汇总阶段调用工具 |

length 的识别优先于工具参数 JSON 验证：其工具调用无论看起来是否完整都不执行。content_filter 等明确非正常结束按可读终止错误结束，不冒充 length。协议损坏或用户取消优先于恢复，不能拿帧中残留的 length 掩盖断流。

### 6.3 工具批次验证

保护模式执行前校验整批：唯一且非空 id、type=function、function.name 为本轮允许声明的工具、arguments 为可 JSON.parse 的普通对象（合法 {} 可执行，缺失/空串/数组/null 不自动变 {}）。同一生成链里已出现的 tool_call_id 不得再次执行；不按工具名/参数全局去重。

禁止半批验证后立刻执行：一批三工具中第三个参数损坏时，三个都不执行。成功/失败 ToolExecutionResult 都按原 tool_call_id 原样回传，按顺序追加后进入下一模型调用。

工具执行器实际抛错：检查取消信号，非取消则明确结束，不能为了填一个假工具失败而自动重调。已执行副作用不回滚，状态不确定的执行不得自动重跑。每次工具执行前与 await 后检查 signal，用户取消后不执行后续工具。

既有 maxRounds 是工具轮次上限，保持原默认值，不是 token 配额。上限处生成的 synthetic tool error 结果仍绑定对应 id，最终去 tools 的汇总请求纳入同一完成校验和总恢复计数。没有执行器时收到 tool_calls 也是明确错误，不能默认为成功回复。

## 7. 有限恢复状态机

每次 fetchChatCompletion 的保护链维护：recoveryUsed=false、hasToolResults=false、已使用调用 ID 集合、当前规范化 messages。状态只存本次内存，不落盘。

```text
模型请求
 ├─ 正常正文结束 → 成功（只一次）
 ├─ 完整工具调用 → 验证整批 → 执行并追加结果 → 下一模型请求
 ├─ length，无当前正文，recoveryUsed=false
 │    → recoveryUsed=true
 │    → 丢弃失败尝试的 reasoning/残缺tool_calls（不加入messages）
 │    → 保留请求前messages与已完成工具结果
 │    → hasToolResults ? 汇总专用请求 : 原工具声明下重试
 │    → 再次失败则结束；成功后不重新获得恢复次数
 └─ 其他失败/取消 → 保留正文，明确结束
```

- 尚无工具结果：使用原 tools 重新生成一次，参数和 messages 不变；该恢复成功产出合法工具调用后可正常继续多步流程，但后面不再有恢复额度。
- 已有任何工具结果（包括失败结果、工具上限 synthetic 结果）：恢复请求不发送 tools 或 tool_choice，不允许执行恢复响应中的任何新工具调用；只利用已有上下文产出正文，不追加新的提示词来改变任务。
- 已进入既有工具上限的最终无工具阶段时，即便状态异常显示 hasToolResults=false，也保持无工具，不重新开放。
- 不添加失败尝试中的原生思考字段，不用文本续写冒充服务端思考续传。恢复是新请求，相同部署限额下可能仍失败。
- 保留前面工具轮次已展示的说明；当前请求若展示过任何文本，不重试也不拼接第二份回答。
- 只复用已组装请求；不重跑搜索/记忆检索、EJS、宏、激活算法或成功工具。不得调用 sendChat 作为重试实现。
- 按各次服务实际返回的 usage 汇总（包括截断的第一次），缺失保持未知，不推算余量。错误携带已知 usage 供结构诊断，不强行持久化为完整回复 tokenCount。
- 通知沿用 onNotice：恢复前“输出达到服务端限制，正在尝试恢复（1/1）”；已有结果时补“将保留工具结果，仅恢复回复文字”。再次失败在错误气泡明确结束。不会触发发送前确认。

## 8. 错误、完成事件与反馈

新增通用 ChatCompletionError（宿主模块）携带枚举 code、finishReason、round、recoveryUsed、已知 usage、是否有正文，不携带提示词/思考原文或原始损坏数据。code 至少包含 truncated、empty_response、incomplete_response、invalid_tool_call、tool_call_not_allowed、invalid_prompt_layout、policy_conflict。

ChatInterface 继续走现有 catch/finally：保留当前气泡文本，追加可读错误，清理加载和恢复提示；不要发送 success response 日志。用户取消沿现有“已停止生成”。

完成事件的最小增量设计：LogEntry.meta 增加使用约定 assistantCompletion?:boolean。仅本插件生效的主对话工具事件日志写 false，最终主回复成功日志写 true；App.handleAddLog 对 response 且 assistantCompletion!==false 才继续发既有 message:received。旧日志不含标记时保留旧行为。工具成功日志仍是 response 类型，避免改变工具记录展示，只抑制它误充助手完成。

完成标记只在整个保护链正常结束后产生；失败和截断不发完成事件，不用 finally 补发成功。恢复不重复 generation:started 或 message:sent，也不重复 pre-pass。D15 保证正常完成事件路径不处理截断 MVU 块，不声称能阻止任意第三方脚本自行监听 DOM。

可记录策略 ID、角色计数、结束原因、轮次、是否恢复、usage、结构错误代码；不新增请求全文、工具参数/结果副本或思考正文日志。现有 MCP 业务日志沿用，不扩散进插件诊断。

模板错误显示：只在保护路径中安全解析 ApiHttpError.body 的有限嵌套 JSON（最多三层）并识别已知 System message must be at the beginning 原因，显示固定中文提示；不回显完整嵌套提示词。其他 HTTP 错误保持 describeError 行为。该优化不增加自动重试或全局异常处理范围。

## 9. 插件 UI 与文案

元信息：id=single-leading-system，name=系统消息合并，version=1.0.0，icon=MessageSquare，order=30。只在 plugins/registry.ts 静态注册，沿用框架列表总开关、PC 左右栏/移动二级页和日志区域。

说明首段：

> 本插件适用于目前已核验的 Qwen3.6 / Qwen3.5 官方模型聊天模板中“仅允许首条系统消息”的约束，不限于 Ollama 或 HauhauCS 模型。通过其他供应商的 OpenAI 兼容接口接入时，也可使用本插件。

随后标注具体核验型号为 Qwen3.6-35B-A3B、Qwen3.5-35B-A3B，不把家族全部规模写为已验收。简述功能为“合并静态系统设定，保留当前对话中的动态规则”。

常驻高亮块沿用现有插件 AlertTriangle、琥珀色圆角边框/背景及深浅色 class：

> 使用本插件前，请在 Bypass（绕过机制）中关闭 AnswererFlagalac，并不要使用 RuleBreaker。RosettaStone 的字数控制和语言约束可继续使用。AnswererFlagalac 开启时，本轮插件不会生效。

设置内容：按供应商分组展示模型，提供逐模型应用开关；无模型时提示先在对话模型供应商中添加。停用供应商显示状态且控件不可新启用；已选模型不可用时保留记录并可移除。插件总开关关闭时允许提前编辑配置，说明“启用插件后生效”。不重复实现供应商/模型管理。

底部说明：

> 思考模式由模型服务端保持默认设置，本插件不提供关闭开关。若输出被截断，本次发送最多自动恢复一次；已有工具结果时只恢复文字回复。重新生成属于新的请求，可能重新调用工具。

运行时修改配置下一次发送生效。界面不显示正常可用项内部 providerId、状态机、参数 JSON 或 token 配额；不可用项没有名称时才以 ID 定位。

## 10. 文件清单与依赖

| 文件 | 变更职责 |
| --- | --- |
| plugins/single-leading-system/plugin.tsx | 元信息、defaults、setup/disposer、SettingsPanel |
| plugins/single-leading-system/config.ts | schema 类型、解码、联合键匹配、数组编辑 |
| plugins/single-leading-system/normalizeMessages.ts | §5 纯结构转换与校验 |
| plugins/single-leading-system/SingleLeadingSystemSettings.tsx | §9 UI、模型叶子快照、updateConfig 保存 |
| plugins/single-leading-system/singleLeadingSystem.test.ts | 配置/转换/注册/边界集成测试 |
| src/plugins/outbound.ts | §4 出站类型、注册/解析、冲突/清理 |
| src/plugins/modelContext.ts | 模型只读快照与订阅 |
| src/plugins/outbound.test.ts | 注册/快照/冲突/非匹配测试 |
| src/lib/chatPipeline.ts | 新 envelope 出口与兼容数组包装 |
| src/lib/chatPipeline.test.ts | 实际组装静动态、RosettaStone与旧路径回归 |
| src/lib/chatCompletionPolicy.ts | 完成状态、批次验证、错误类型、恢复状态 |
| src/lib/chatCompletionPolicy.test.ts | 执行计数与状态机确定性测试 |
| src/lib/api.ts / src/lib/api.test.ts | 可选第六参数、保护解析、序列化、工具/恢复整合及mock fetch测试 |
| src/components/ChatInterface.tsx | 主对话快照、envelope/plan、日志标记、错误展示 |
| src/App.tsx | 发布模型快照、排除assistantCompletion=false事件 |
| plugins/registry.ts | 唯一新增注册 |
| src/lib/settingsBackup.test.ts | 配置导入导出往返；生产settingsBackup.ts无需改 |
| 本目录验证报告.md、阶段交接-XXX.md | 分阶段证据和续接提示词 |
| 上一级插件框架规范.md、.docs/llm-chat-prompt-architecture-standard.md | 实现后登记通用契约与出站结构 |

不修改 ModelEntry/ApiSettings 存档结构，不修改 ext-host、nginx、数据库或生产部署。测试用现有 tsx 与 Node test/assert，不引入新依赖。插件只 import type 契约、叶子模块、React/lucide 与自身模块，不 import 宿主 UI/store/api 的运行时函数。

## 11. V1 分期与交付

| 阶段 | 可独立交付内容 | 前置 | 状态 |
| --- | --- | --- | --- |
| P0 准备 | 初始设计迁移、审计D1—D17、完整计划及用户冻结 | 当前 | ✅ |
| P1 宿主契约 | outbound/modelContext、envelope、API可选参数、App快照；无策略保持原行为 | P0冻结、开工指令 | ✅ |
| P2 可用插件 | 注册、配置/UI、结构转换、存档往返和AF回退；正常生成完整可用 | P1 | ✅ |
| P3 截断恢复 | 保护解析、状态机、工具安全、完成事件、错误/恢复反馈 | P2 | ⬜ |
| P4 集成验收 | 本地浏览器dev、目标模型、复杂世界书/多轮/MCP/附件、验证报告与交接 | P3 | ⬜ |

P1 不注册占位插件，使用测试注册验证契约。P2 先返回不带 completionPolicy 的结构计划，完整交付正常路径；P3 实现保护处理后，本插件开始返回 bounded-recovery，不以“声明支持但宿主忽略”充当已交付能力。P2 不把 D5 提前标为完成。各阶段可编译、可验证；P4 完成才将 V1 标为完整验收。

### 11.1 阶段检查命令

在主项目根执行，使用本地依赖：

```text
P1:
node --import tsx --test src/plugins/outbound.test.ts src/lib/chatPipeline.test.ts src/lib/api.test.ts
npm run lint
npm run build

P2（含P1回归）:
node --import tsx --test src/plugins/outbound.test.ts src/lib/chatPipeline.test.ts src/lib/api.test.ts plugins/single-leading-system/singleLeadingSystem.test.ts src/lib/settingsBackup.test.ts
npm run lint
npm run build

P3（完整确定性套件）:
node --import tsx --test src/plugins/outbound.test.ts src/lib/chatPipeline.test.ts src/lib/api.test.ts plugins/single-leading-system/singleLeadingSystem.test.ts src/lib/settingsBackup.test.ts src/lib/chatCompletionPolicy.test.ts
npm run lint
npm run build
```

上述测试文件是计划交付，当前尚不存在；这些命令不是本准备阶段已执行的验证。

P4 先跑 P3 套件，再在 dev-server 中按既有工具执行 `python tools/rebuild-dev.py --up`。容器重建必须按对应流程且在开发服重启已获授权时进行；本准备阶段不执行。主仓 rebuild.py 属生产镜像流程，不能替代 dev 构建。以实际 assets/构建版本核对源码一致性，不只看容器运行。

### 11.2 每 P 收尾

验证通过 → diff/status → secret 检查 → 项目 commit-push skill 按 PAT 提交推送 → 更新本SSOT → 本目录阶段交接 → memory。不得force push、混入无关更改或密钥。当前准备文档不自动提交；实际 P 阶段按用户批准的开发流程执行。

交接文档含交接目的、必读文档、当前进度、本轮实现、已知问题、10—20行可复制续接提示词；明确以plan模式推进、必读本目录SSOT、当前边界与第一步。后续交接不放回.docs根目录。

## 12. 验收矩阵

| 编号 | 场景 | 必须判据 | 阶段 |
| --- | --- | --- | --- |
| V01 | 无策略/停用/非目标 | 请求字段内容与旧路径一致，Anthropic不介入 | P1/P2 |
| V02 | 叶子契约/加载 | 两种入口无环，重复注册/多匹配报错，disposer正确清理 | P1 |
| V03 | envelope | 包装与新出口消息一致；边界准确；不二次组装 | P1 |
| V04 | 连续/交错system | D7角色、内容、分隔符及顺序精确断言 | P2 |
| V05 | 动态/RosettaStone | 四组合、无WI、空/自定义模板、变量/EJS仍在动态区 | P2 |
| V06 | 幂等/parts/纯函数 | 规范布局二次转换相同；冻结输入不变；图片/记忆/检索保留 | P2 |
| V07 | 配置 | 同名异供应商独立，false保留，非法/重复/未来schema按§3 | P2 |
| V08 | 生命周期/存档 | 删除不可用、同ID恢复、新ID不继承；往返不丢配置 | P2 |
| V09 | thinking/预算 | UI无控件，请求无任何新增思考控制或预算字段 | P2 |
| V10 | AF前提 | 有效target时请求/恢复回旧路径，只记原因、无拦截 | P2 |
| V11 | 工具闭环/上限 | ID绑定正确，出站只有首system，最终无tools也检查状态 | P3 |
| V12 | 流完整性 | 分片/CRLF/末尾无换行/usage/DONE、缺finish、坏JSON/error帧按§6 | P3 |
| V13 | length/空回复 | 流/非流：无正文恢复一次、部分正文不重试、stop空不重试 | P3 |
| V14 | 批次安全 | 第三条参数坏则整批0执行；未知工具/重复ID/缺参/数组拒绝 | P3 |
| V15 | 骰子恢复 | roll_coc成功执行=1，结果字节复用；恢复无tools，额外tool_calls不执行 | P3 |
| V16 | 合法重复 | 正常独立新ID同名同参调用仍执行，不全局去重 | P3 |
| V17 | 总恢复额度 | 前轮用过恢复后后轮不重试，最终请求共用计数 | P3 |
| V18 | 取消/执行异常 | 无新请求/下一工具，不重调不确定执行，不重跑EJS/检索 | P3 |
| V19 | 完成事件 | 生效路径工具成功0完成事件，最终成功1，截断/失败0 | P3/P4 |
| V20 | 运行时配置 | 当前快照稳定、下一发送读新配置；停用清理注册 | P2/P3 |
| V21 | UI | 名称、首段、警告、模型/不可用状态，PC/手机/深浅色 | P4 |
| V22 | 目标服务 | 合成九条转换HTTP200，流/非流、两轮历史、动态规则保持 | P4 |
| V23 | MCP/附件 | 已有功能在启用插件后回归；真实骰子结果不重掷 | P4 |
| V24 | 已有插件 | EJS/JS生命周期、正常完成MVU、quote-tts等不回归 | P4 |
| V25 | 工程清理 | lint/build，无密钥/模块环/一次性产物残留 | 每P |

真实服务至少测试静态事实、动态变更、RosettaStone四组合（包含默认长回复目标的人工检查）、图片与文档混合、两次连续工具、用户指定复杂角色两轮。精确字数不作随机模型的必然断言。真实截断不为复现而给产品注入 max_tokens；边界用mock测试，真实自然发生时单独记录。

用 ollama 和 custom/OpenAI 格式两类供应商身份指向获授权的同一服务验证无身份绑定；这只证明分类无绑定，不冒充另一厂商端到端验收。不额外上传私人角色到未授权第三方。

前期22次原型请求和用户已有工具/附件验收只作设计证据，不替代插件改造后的V22—V24。

## 13. 环境、数据与清理

- 用用户本机浏览器访问现有dev4095；不恢复已放弃的Codex内置浏览器测试。
- dev MCP曾通过宿主本地端口转发接通，验收前核对health/tools/list与调用；失效须恢复后验收，不伪造通过。
- 确定性测试用mock fetch/执行器/事件sink；长期测试源码保留，临时脚本、dump、测试账户/角色/容器清理。
- 数据库写入先备份；能用内存夹具就不接触真实数据。对用户数据的测试改动须可恢复，不清理原有数据。
- 不保存私人对话、原生思考正文、密钥、完整dev bundle；验证报告只保留用例、参数形状、状态和必要摘要。
- 无新环境变量或迁移；不改Ollama/systemd/SSH隧道/生产nginx。

## 14. 冻结检查与变更控制

- [x] 初始设计迁移且迁移时哈希一致。
- [x] 框架/出站/工具/事件/存档源码已核验，限制登记于审计报告。
- [x] 十一项产品问题逐项确认，形成D7—D17。
- [x] 旧thinking、手动恢复、D5工具参数不变的冲突已显式修订。
- [x] 配置、接口、数据流、状态机、UI、文件、阶段与验收已具体化。
- [x] 用户阅读技术稿和 UI 并确认冻结。
- [x] 用户授权 P1—P4 全程自动开发及阶段收尾。

冻结后，内部代码组织可在不改变契约/用户行为/验收标准的前提下合理实现；发现需要更改边界的新事实，先登记影响并修订SSOT，经确认后实施。不能承诺消除所有未知故障，但已知决策不得拖到开发中再猜。

### 实现记录：P2

- 设置面板契约增补可选只读 enabled，由宿主传入，以准确显示停用预配置提示；不读取 runtime，避免模块环。旧插件不受影响。
- policy.ts 独立承载 resolver，方便不加载 React 的契约测试。
