/**
 * quote-tts —— NyaaChat 原生插件（首个），移植自 ST 扩展 `st-Quote-TTS`。
 *
 * 本文件是插件的**契约实现**：把音色常量表（`voices.ts`）、设置面板
 * （`QuoteTtsSettings.tsx`）、消息装饰渲染组件（`QuoteTtsButton.tsx`，captain 自办）
 * 与引号扫描（`quoteScan.ts`，captain 自办）组装成 SSOT §2.2 的 `NyaaPlugin`。
 *
 * ## ST 的 8 项实现在 NyaaChat 的落点（审计报告 §2.3 的逐条对照）
 *
 * | # | ST 实现 | 本插件的落点 |
 * |---|---|---|
 * | 1 | 扫 `.mes_text` 插 🔊 | `decorators.messageText` → `quoteScan.scanQuotes` → `QuoteTtsButton`（**逐块**方案，SSOT §2.6） |
 * | 2 | 轮询容器 + `$.get(settings.html)` 挂面板 | `SettingsPanel`（React 组件，由 `ExtensionsModal` 渲染） |
 * | 3 | `extension_settings["quote_tts"].characterMap` | `defaults.characterMap` + `updateConfig`（→ `AppState.plugins["quote-tts"].config`） |
 * | 4 | 参与者枚举（ST context / `.name_text` / 前缀扫描） | `QuoteTtsSettings.collectParticipantNames`（宿主上下文 + 会话消息） |
 * | 5 | `fetch(/api/openai/custom/generate-voice)`（上游由 body 指定） | `backend[]` 声明 + `callPluginBackend`（上游由 ext-host 的 `process.env` 决定，红线 §7.1） |
 * | 6 | 硬编码端点 / `MODEL_ID` / `DUMMY_KEY` | 音色表原样移植；端点与模型移到服务端 env（`voices.ts` 顶部注释） |
 * | 7 | `eventSource.on(MESSAGE_RECEIVED / CHAT_CHANGED)` + `setTimeout(200/1000ms)` | **不需要** —— React 渲染期同步取运行时快照，没有"等 DOM 稳定"这一步 |
 * | 8 | 固定试听文案 | `PREVIEW_TEXT`（原样移植） |
 *
 * ## 第 7 项的"消失"值得单独说明
 *
 * ST 之所以要订阅事件再 `setTimeout` 延迟处理，是因为它只能等 ST 把消息 DOM 渲染
 * 出来、结构稳定之后再往里注入控件（`processChatSafe` 里那两处 200ms / 1000ms 的
 * 等待就是"赌 DOM 已经就绪"）。NyaaChat 版由宿主在渲染期逐块调用装饰器
 * （`src/plugins/decorators.ts`），控件是这次渲染的产物本身 —— 不存在时序竞争，
 * 因此本插件**不注册任何事件、不实现 `setup`**。这不是漏做，而是该依赖被结构性
 * 消除（与审计报告「4 项在 NyaaChat 无对应物」的结论互补：其中"事件订阅"这一项
 * 在新架构下不再需要对应物）。
 *
 * ## 本文件**不**做的事
 *
 *  · 不做区间计算 / 正则扫描 —— 那是 `quoteScan.ts`（captain 自办，最高风险项）；
 *  · 不做播放、loading、object URL 回收 —— 那是 `QuoteTtsButton.tsx`（captain 自办）；
 *  · 不做跨块坐标换算 —— 装饰契约已改为**逐块**，`start` / `end` 就是宿主传入
 *    那段块文本内的偏移，直接透传 `scanQuotes` 的结果即可（SSOT §2.6）。
 */
import type { MessageTextDecorator, NyaaPlugin } from "../../src/plugins/types";
import QuoteTtsButton from "./QuoteTtsButton";
import QuoteTtsSettings from "./QuoteTtsSettings";
import { scanQuotes } from "./quoteScan";
import {
  CHARACTER_DEFAULT_VOICE,
  QUOTE_TTS_DEFAULTS,
  QUOTE_TTS_PLUGIN_ID,
  QUOTE_TTS_SPEECH_CAPABILITY,
  QUOTE_TTS_SPEECH_PATH,
  USER_DEFAULT_VOICE,
} from "./voices";

/**
 * 逐块引号装饰：宿主对本块纯文本调用一次，返回与该文本同空间的区间。
 *
 * `ctx.senderName` 已是宿主解析好的**展示口径**发送者名（user → 当前用户角色名，
 * assistant → 当前角色名；无值时回落 `"user"` / `"AI助手"`），`scanQuotes` 用它作为
 * 「无内联人名前缀」时的 `charName` 兜底 —— 与设置面板枚举参与者的键口径一致
 * （`QuoteTtsSettings.collectParticipantNames`），这是音色能命中的前提。
 *
 * `render` 收到的是宿主按 `[start, end)` 切出的**含引号原文**片段（与 `match.text`
 * 相同）。刻意使用宿主给的 `slice` 而不是闭包里的 `match.text`：切分以宿主为准，
 * 两边一旦不一致（理论上不会），按钮读出的文本仍与页面上显示的字符一致。
 *
 * ## 注入 `ctx.config` / `ctx.callBackend`（t10：断开模块环）
 *
 * 按钮需要"当前配置"与"后端调用器"。这两者由**本装饰器这一层注入**给它，而不是让
 * 按钮自己 `import src/plugins/runtime`。原因见 `QuoteTtsButton.tsx` 头部「依赖注入」：
 * 按钮自取配置会构成
 * `plugins/registry → plugin → QuoteTtsButton → src/plugins/runtime →
 * src/plugins/registry → plugins/registry` 的**模块环**，使"直接 import 插件模块"时
 * 注册表拿到 `undefined` 槽位、插件静默消失。
 *
 * 注入语义与按钮原先自取完全一致：`ctx.config` 就是 `getPluginConfig(pluginId)` 的结果
 * （`decorators.ts` 对每个插件取一次），`ctx.callBackend` 已由宿主绑定好本插件 id
 * 且带"能力是否声明"的校验。
 */
const decorateQuotedText: MessageTextDecorator = (text, ctx) =>
  scanQuotes(text, ctx.senderName).map((match) => ({
    start: match.start,
    end: match.end,
    // `scanQuotes` 的 key 是块内的 `${start}-${end}`；宿主侧再拼 `${pluginId}::`，
    // 因此跨块重号不会撞 React key（decorators.ts L191）。
    key: match.key,
    render: ({ text: slice }) => (
      <QuoteTtsButton
        text={slice}
        charName={match.charName}
        config={ctx.config}
        callBackend={ctx.callBackend}
        // 未绑定音色时的回落值按**说话人类型**取：用户消息 → 云健，助手/角色 → 晓晓。
        // 必须与设置面板同一口径，否则面板里显示的音色与实际播放的不一致。
        defaultVoice={
          ctx.role === "user" ? USER_DEFAULT_VOICE : CHARACTER_DEFAULT_VOICE
        }
      />
    ),
  }));

const quoteTtsPlugin: NyaaPlugin = {
  meta: {
    id: QUOTE_TTS_PLUGIN_ID,
    name: "引用朗读",
    description:
      "为消息中引号包裹的台词（“”‘’「」『』）生成 🔊 按钮，按角色绑定的 Edge-TTS 音色朗读。",
    version: "1.0.0",
    author: "Nyaa",
    // lucide-react 图标名；ExtensionsModal 按名解析，解析不到会回退到 Puzzle。
    icon: "Volume2",
    order: 0,
  },
  // 用户配置的形状见 voices.ts 的 QuoteTtsConfig：{ characterMap: { 角色名: 音色 } }。
  // 展开一份新对象表达"这是本插件的缺省值"，取值本身仍以常量表为唯一来源
  // （深合并只读不写，`normalize.ts` 不会改动 defaults）。
  defaults: { ...QUOTE_TTS_DEFAULTS },
  backend: [
    {
      capability: QUOTE_TTS_SPEECH_CAPABILITY,
      path: QUOTE_TTS_SPEECH_PATH,
      method: "POST",
      description: "受控 Edge-TTS 代理：{ input, voice, response_format } → 音频字节流",
    },
  ],
  SettingsPanel: QuoteTtsSettings,
  decorators: { messageText: [decorateQuotedText] },
};

export default quoteTtsPlugin;
