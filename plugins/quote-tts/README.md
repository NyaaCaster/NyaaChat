# quote-tts —— NyaaChat 原生插件

> 为消息中引号包裹的台词生成 🔊 按钮，按角色绑定的 Edge-TTS 音色朗读。
> 移植自 ST 扩展 [`st-Quote-TTS`](https://github.com/NyaaCaster/st-Quote-TTS)（AGPL-3.0）。
>
> 这是 NyaaChat 插件系统 V1 的**首个原生插件**，也是"框架随插件编写而成熟"的验证对象
> （审计报告 §2.3 结论：该扩展 8 项实现里 4 项在 NyaaChat 无对应物，必须由框架先给契约）。

## 1. 文件职责

| 文件 | 职责 | 归属 |
|---|---|---|
| `plugin.tsx` | 契约实现：`meta` / `defaults` / `backend` / `SettingsPanel` / `decorators.messageText` | 本任务（t6） |
| `QuoteTtsSettings.tsx` | 设置面板（参与者 → 音色 + 🔊 试听），参与者枚举 | 本任务（t6） |
| `README.md` | 本文件：移植说明 | 本任务（t6） |
| `voices.ts` | 14 个 Edge-TTS 音色、试听文案、默认常量、配置读写助手 | captain 自办 |
| `QuoteTtsButton.tsx` | 消息内播放按钮（render 目标） | captain 自办 |
| `quoteScan.ts` | 引号扫描与区间计算 | captain 自办 |

> 后三者由 captain 亲自实现，理由见 SSOT §10.2：装饰区间（rehype/切分/正则）是全案
> 最敏感的部分，需要与用户实时核对。本任务**不修改**这三个文件。

## 2. 与 ST 原版的逐项对照

来源：`.ref/st-Quote-TTS/`（`index.js` 249 行 + `settings.html` + `style.css` + `manifest.json`；
`.ref/` 被 `.gitignore` 忽略，只读参考）。

| # | ST 侧实现 | NyaaChat 对应物 | 处理 |
|---|---|---|---|
| 1 | `$('.mes_text').each()` + 正则 + 字符串拼 HTML 回写 `$element.html()`（L75-113） | `decorators.messageText`（宿主**逐块**调用） + `scanQuotes` + `QuoteTtsButton` | **重写**：不再注入 DOM，改为返回结构化区间、由宿主渲染 React 节点 |
| 2 | 轮询 `#extensions_settings` + `$.get(settings.html)` append（L43-56） | `SettingsPanel`（React 组件，`ExtensionsModal` 渲染） | **重写**：`settings.html` / `style.css` **不迁移**（用户 2026-09-15 明确要求） |
| 3 | `extension_settings["quote_tts"].characterMap` + `saveSettingsDebounced()`（L150, L180-184） | `defaults.characterMap` + `updateConfig` → `AppState.plugins["quote-tts"].config` | **重写**：走设置存档（导出/导入/云端一并生效） |
| 4 | ST context + `#chat .name_text` + 消息 `人名:` 前缀扫描（L120-142） | `collectParticipantNames`（宿主上下文 + `sessionMessages`） | **重写**：数据源改为运行时只读快照 |
| 5 | `fetch("/api/openai/custom/generate-voice", { provider_endpoint, model, api_key, token })`（L187-238） | `backend[]` 声明 + `callPluginBackend(capability, { input, voice, response_format })` | **重写**：上游由 ext-host 的 `process.env` 决定，body 无法改写（红线 §7.1） |
| 6 | 硬编码 `TARGET_ENDPOINT` / `MODEL_ID = "tts-1-hd"` / `DUMMY_KEY = "none"`（L9-12） | 音色表原样移植；端点/模型/鉴权移到服务端 env | **原样移植常量，前端去端点** |
| 7 | `eventSource.on(MESSAGE_RECEIVED, +200ms)` / `on(CHAT_CHANGED, +1000ms)`（L62-72） | **无对应物** | **结构性消除**：渲染期同步取值，不存在"等 DOM 稳定"的时序竞争 |
| 8 | 固定试听文案（L34） | `PREVIEW_TEXT` 原样 | **原样移植** |

## 3. 必须替换的 ST 依赖清单（本插件已全部消除）

| ST 依赖 | 出现处 | 替换为 |
|---|---|---|
| `../../../extensions.js`（`extension_settings` / `getContext`） | L1 | `src/plugins/runtime.ts`（`getPluginHostContext`）+ 插件 `config` prop |
| `../../../../script.js`（`saveSettingsDebounced` / `getRequestHeaders` / `eventSource` / `event_types`） | L2 | `updateConfig`（宿主 writer）+ 同源路径 fetch（鉴权由 nginx 层负责）+ 无需事件 |
| `#extensions_settings` / `.quote-tts-extension-settings` DOM 容器 | L44-49 | React `SettingsPanel`（`ExtensionsModal` 详情面板） |
| `.mes_text` / `.mes_block` / `.name_text` DOM 逃逸区 | L76-83, L131-134 | `decorators.messageText` 的逐块 `text` + `ctx.senderName` |
| `$element.html()` 字符串回写 + 内联 `onclick="window.playQuoteTTS(...)"` | L107-111 | `TextDecoration.render` 返回 React 节点（不使用 `dangerouslySetInnerHTML`，红线 §7.6） |
| `window.playQuoteTTS` 全局函数 | L240 | 组件内闭包 `play()`（`QuoteTtsButton.tsx`） |
| `toastr` 全局 | L234 | 控制台留痕 + 按钮短暂显示 ❌（NyaaChat 无 toastr） |
| `/api/openai/custom/generate-voice` 开放代理 | L15, L195 | `ext-host` 受控路由 `/plugins/quote-tts/speech`（nginx 精确 location 放行） |
| `settings.html` / `style.css` / `manifest.json` | 全部 | 不迁移；改为 Tailwind + `SettingsFormBits` 的既有控件风格 |

## 4. 配置与持久化

```ts
// AppState.plugins["quote-tts"]
{
  enabled: boolean,
  config: { characterMap: { [角色名]: "zh-CN-XiaoxiaoNeural" | ... } }
}
```

- 缺省值：`defaults.characterMap = {}`（`README` 未绑定音色的角色回落到
  `DEFAULT_VOICE = zh-CN-XiaoxiaoNeural`，等价 ST 的 `AVAILABLE_VOICES[0]`）。
- 写入路径：面板 `updateConfig` → `src/plugins/runtime.ts` 的
  `updatePluginConfig`（深合并）→ `App.tsx` 注册的 writer → `handleSaveSettings()`
  ⇒ 必然落盘 `nyaachat_settings`，刷新后保持。
- 归一化：`src/plugins/normalize.ts` 的 `normalizePluginStates()` 在
  **加载 / 本地导入 / 云端下载 / 导出**四处收敛；不在 `AVAILABLE_VOICES`
  白名单内的音色值会被 `readCharacterMap()` 丢弃（防止手改存档注入任意值）。

### 音色键的口径（**改音色不生效时先查这里**）

`characterMap` 的键必须与装饰侧传给 `QuoteTtsButton` 的 `charName` 是**同一个字符串**：

- user 消息 → `currentUserRole?.name || "user"`；
- assistant 消息 → `currentCharacter?.name || "AI助手"`（`MessageItem.tsx` L330-331, L492）；
- 消息里带「人名: “引用”」行首前缀时 → 该前缀（`quoteScan.ts` 的 `PREFIXED_QUOTE_RE`）。

设置面板据此枚举并**做同样的兜底**（`USER_NAME_FALLBACK` / `CHARACTER_NAME_FALLBACK`），
因此两种取值口径（原始值 / 展示值）下键都一致。

## 5. 后端通道（受控代理）

| 项 | 值 |
|---|---|
| 能力名 | `quote-tts.speech`（`QUOTE_TTS_SPEECH_CAPABILITY`，全仓唯一） |
| 前端路径 | `/api/ext-host/plugins/quote-tts/speech`（`QUOTE_TTS_SPEECH_PATH`） |
| 请求体 | `{ input: string(≤1000), voice: <14 音色之一>, response_format: "mp3" }` |
| 响应 | 音频字节流（`callPluginBackend<Blob>`） |
| 上游 | **只能**由 ext-host 的 `PLUGIN_QUOTE_TTS_UPSTREAM_URL` / `_MODEL` / `_API_KEY` / `_TIMEOUT_MS` 决定 |

前端**不发送**也不认 `provider_endpoint` / `baseUrl` / `model` / `api_key` —— ST 版正是
把这些塞进请求体的形态（即被摘除的 SSRF 面），不得重建（SSOT §2.7 / §7.1）。
未配置 env 时路由返回 `503 quote_tts_not_configured`，此时试听按钮显示 ❌ 并在控制台留痕。

## 6. 已知边界（诚实记录）

1. **加粗人名不产内联绑定**：装饰只转换**字符串类型**的 children，所以
   `**Alice**: “…”` 里的 `Alice` 不会成为内联人名，播放时 `charName` 回落成发送者名。
   这是既有 `renderTextWithQuotes` 的行为（`src/plugins/decorators.ts` 顶部已声明），
   非本插件引入。设置面板仍会通过 markdown 归一化把 `Alice` 列为参与者。
2. **只认半角冒号 `:`**：与 `quoteScan.ts` 一致。`她说：“…”` 不会被当作内联人名。
3. **全角/半角引号对不混用**：逐对匹配（`“…”` / `‘…’` / `「…」` / `『…』`），
   `“…」` 这类错配不匹配（ST 原版会匹配，属有意收紧）。
4. **参与者列表依赖宿主上下文**：`getPluginHostContext()` 由 `App.tsx` 推送
   （`setPluginHostContext`）。若宿主未接线，`sessionMessages` 为空数组，面板只显示
   两个兜底键 `user` / `AI助手` —— 面板本身不报错、不阻塞，属"依赖未接"而非本插件缺陷。
5. **单块装饰上限 200 个**、单次合成上限 1000 字符（与 ext-host 侧限制一致）。

## 7. 自测

```bash
npm run lint     # tsc --noEmit && eslint .（plugins/** 已纳入 react-hooks 规则）
npm run build    # vite build
```

dev 测试服（`NyaaChat/dev-server`）：`python tools/rebuild-dev.py --up` →
`http://localhost:4095/` → 聊天头部「扩展」→ 选中「引用朗读」→
启用 → 面板列出参与者 → 切换音色 → 刷新页面后仍生效 → 含引号的消息出现 🔊。
（⚠️ 要**听到声音**还需在 `dev-server/.env` 配 `PLUGIN_QUOTE_TTS_UPSTREAM_URL` —— 必须是**基地址**，
ext-host 会自行追加 `/v1/audio/speech`；未配置时点 🔊 得 503。见 `ext-host/src/server.js` L119。）
