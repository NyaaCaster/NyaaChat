/**
 * quote-tts 设置面板 —— 「参与者 → 音色」绑定表。
 *
 * ## 移植来源与**刻意不移植**的部分
 *
 * ST 原版是 `settings.html`(1679 B) + `style.css`(2677 B) + `index.js` L115-184 的
 * jQuery 逻辑三件套：面板靠 `setInterval` 轮询 `#extensions_settings` 容器，用
 * `$.get()` 拉 HTML 片段 append 进去，再手写 `.quote-tts-settings-row` 等类名。
 * 用户 2026-09-15 明确：**不迁移** settings.html / style.css，重写为 React 组件以
 * 保持 NyaaChat 整体控件风格（Tailwind + `SettingsFormBits` 的既有控件）。
 * 本文件不含任何 `.quote-tts-*` 样式类，也不写 `<style>`。
 *
 * | ST 版 | 本版 | 原因 |
 * |---|---|---|
 * | 轮询 `#extensions_settings` 后 append HTML | 由 `ExtensionsModal` 以 React 渲染 `SettingsPanel` | ST 宿主 DOM 已随兼容层摘除（审计报告 §2.1） |
 * | `jQuery` + `$row.find('select').on('change')` | 受控 `<select>` + `onChange` | 同上 |
 * | 手写 class 名 + `style.css` | Tailwind + `SettingsFormBits` | 用户要求保持 NyaaChat 控件风格 |
 * | 「刷新角色列表」按钮（手动触发 DOM 重扫） | **无按钮**：订阅宿主上下文，参与者自动更新 | 见下「自动更新」 |
 *
 * ## 参与者枚举（SSOT §4-P5）
 *
 * 三个来源，去重后按字典序排列：
 *  1. **当前用户角色名** —— `identity.user`；
 *  2. **当前角色名** —— `identity.char`；
 *  3. **当前会话消息里「人名:」前缀扫描** —— ST L135-142 的等价物。
 *
 * 数据来自宿主上下文只读快照 `getHostContext()`（**叶子模块** `src/plugins/hostContext.ts`；
 * t12 前它在 `src/plugins/runtime.ts` 里，插件引 runtime 会构成模块环 —— 见 `hostContext.ts`
 * 顶部说明）。用 `useSyncExternalStore(subscribeHostContext, getHostContext)` 订阅 ——
 * 因此**没有刷新按钮**：会话切换 / 新消息 / 角色切换都会换掉快照引用，面板自动重算
 * （一个不改变任何东西的按钮比没有按钮更糟）。
 *
 * ### ⚠️ 键口径必须与装饰侧一致（否则音色永远不生效）
 *
 * 装饰侧（`src/components/MessageItem.tsx` L489-493）传给装饰器的 `senderName` 是
 * **展示口径**：`message.role === "user" ? resolvedUser : resolvedChar`，而
 * `resolvedUser = userName || "user"`、`resolvedChar = charName || "AI助手"`
 * （MessageItem L330-331）。`QuoteTtsButton` 就是拿这个 `charName` 去
 * `characterMap` 查音色。因此**本面板必须做同样的兜底**，否则用户名为空
 * （或角色名为空）时面板列出的名字与播放时查表的键不是同一个字符串 ⇒ 用户怎么
 * 配都不生效，而且不报错。
 *
 * 宿主侧（`App.tsx` L948-960）推的就是**展示口径**（`userRoles…name || "user"` /
 * `characters…name || "AI助手"`），与 `hostContext.ts` 的文档一致。本面板在下游再补
 * 一次同样的兜底，是幂等的第二道保险：宿主推原始值（空串）时得到 `"user"` / `"AI助手"`，
 * 推的已是展示值时原样保留 —— 两种推法都收敛到与装饰侧相同的键，因此**不依赖 App 侧
 * 取哪一种口径**。
 *
 * ### ⚠️ 前缀扫描扫的是 **markdown 原文**，ST 扫的是**渲染后文本**
 *
 * ST 的 `$('#chat .mes_text').text()` 拿到的已经是渲染后的纯文本（`<b>Alice</b>: “
 * …”` 里只剩 `Alice`）。本面板拿到的是 `Message.content` **原文**，所以多两道清理：
 *  · 去掉行首的 markdown 块标记（`- ` / `* ` / `1. ` / `> ` / `#`）；
 *  · 去掉行内的强调字符（`*` `_` `` ` `` `~`），使 `**Alice**: “…”` 归一到 `Alice: “…”`。
 * 名称字符集沿用 ST 装饰正则 L90 的排除类（不含 `<>"'`），因此 `<b>Alice</b>: “…”`
 * 这类残形不会被误列成一个假参与者。
 *
 * **与装饰侧的已知边界（诚实记录，非本面板引入）**：装饰只转换**字符串类型**的
 * children（`src/plugins/decorators.ts` 顶部「覆盖边界」），所以 `**Alice**: “…”`
 * 这种加粗人名在消息里根本不会产出内联人名，播放时 `charName` 会回落成发送者名。
 * 本面板仍会把它列为参与者（它是"此人说过话"的有用信号），用户给它配的音色只在
 * 该名字以**纯文本**形式出现在引用前缀时才生效。这条边界与 ST 原版行为一致。
 *
 * ## 试听
 *
 * 固定文案 `PREVIEW_TEXT`（ST L34 原样移植），音色取**该行下拉框当前值**（不是
 * 落盘值），因此"选一个音色 → 试听"不需要先保存。播放互斥：加载中重复点击直接
 * 返回，开始新试听前先停掉并回收上一段音频的 object URL（与 `QuoteTtsButton`
 * 同一套语义，避免 `URL.createObjectURL` 泄漏）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PluginSettingsPanelProps } from "../../src/plugins/types";
import {
  getHostContext,
  subscribeHostContext,
  type PluginHostContext,
} from "../../src/plugins/hostContext";
import { Field, FieldHint } from "../../src/components/SettingsFormBits";
import {
  AVAILABLE_VOICES,
  CHARACTER_DEFAULT_VOICE,
  defaultVoiceFor,
  MAX_INPUT_LENGTH,
  PREVIEW_TEXT,
  QUOTE_TTS_SPEECH_CAPABILITY,
  RESPONSE_FORMAT,
  readCharacterMap,
  USER_DEFAULT_VOICE,
  type QuoteTtsVoice,
} from "./voices";

/** 用户角色名为空时的键（与 `MessageItem` 的 `resolvedUser = userName || "user"` 同源）。 */
export const USER_NAME_FALLBACK = "user";

/** 角色名为空时的键（与 `MessageItem` 的 `resolvedChar = charName || "AI助手"` 同源）。 */
export const CHARACTER_NAME_FALLBACK = "AI助手";

/** 行首 markdown 块标记：`- ` / `* ` / `+ ` / `1. ` / `>` / `#`。 */
const LEADING_BLOCK_MARKER_RE = /^\s*(?:(?:[-*+]|\d+\.)\s+|#{1,6}\s+|>\s*)+/;

/** 行内强调字符（markdown 折叠后本不该出现在人名里）。 */
const EMPHASIS_CHARS_RE = /[*_`~]/g;

/**
 * 「人名: “引用”」——只认行首、只认半角冒号、开引号只认 `“‘「『`。
 *
 * 半角冒号与开引号集合都与宿主侧 `plugins/quote-tts/quoteScan.ts` 的
 * `PREFIXED_QUOTE_RE` 保持一致：装饰侧不认全角 `：`，本面板也就不该把
 * `她说：…` 里的「她说」列成一个装饰永远查不到的名字。
 */
const INLINE_NAME_LINE_RE = /^\s*([^:<>"'\n]{1,30}?):\s*[“‘「『]/;

/**
 * 扫描一段（markdown 原文）文本里的「人名: “引用”」前缀，按出现顺序返回人名。
 * 纯函数，导出以便独立验证（无 React、无宿主依赖）。
 */
export function scanInlineNames(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(LEADING_BLOCK_MARKER_RE, "").replace(EMPHASIS_CHARS_RE, "");
    const name = INLINE_NAME_LINE_RE.exec(line)?.[1]?.trim();
    if (name) found.push(name);
  }
  return found;
}

/**
 * 枚举参与者：用户角色名 + 当前角色名 + 会话消息的前缀扫描，去重后字典序排列。
 * 纯函数，导出以便独立验证。
 */
export function collectParticipantNames(host: PluginHostContext): string[] {
  const names = new Set<string>();

  names.add(host.identity.user.trim() || USER_NAME_FALLBACK);
  names.add(host.identity.char.trim() || CHARACTER_NAME_FALLBACK);

  for (const message of host.sessionMessages) {
    if (typeof message?.content !== "string") continue;
    for (const name of scanInlineNames(message.content)) names.add(name);
  }

  names.delete("");
  return Array.from(names).sort();
}

type PreviewPhase = "loading" | "playing" | "error";

interface PreviewState {
  charName: string;
  phase: PreviewPhase;
}

const ICON_IDLE = "🔊";
const ICON_LOADING = "⏳";
const ICON_ERROR = "❌";

export function QuoteTtsSettings({
  config,
  updateConfig,
  callBackend,
}: PluginSettingsPanelProps) {
  // 订阅**宿主上下文叶子模块**的通知通道（t12 断环后不再复用 runtime 的通道）。
  // 返回值刻意不接收 —— 它只负责在参与者数据变化时触发本面板重渲染；真实来源是
  // 下面的 `getHostContext()`（引用稳定，内容没变不会引发重渲染）。
  // 插件配置（config）不走这里：它由 `ExtensionsModal` 经 props 传入，该 modal 自己
  // 订阅了 runtime 快照，因此改音色后本面板的受控 select 仍会即时更新。
  useSyncExternalStore(subscribeHostContext, getHostContext);
  const host = getHostContext();

  const characterMap = readCharacterMap(config);
  const participants = useMemo(() => collectParticipantNames(host), [host]);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 停掉当前试听音频并回收 object URL（幂等）。 */
  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch {
        /* 未开始播放时 pause 可能抛错；忽略 */
      }
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  // 卸载时清理：正在试听时关掉扩展面板，不留仍在播放的音频与泄漏的 URL。
  useEffect(
    () => () => {
      releaseAudio();
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    },
    [releaseAudio],
  );

  const handleVoiceChange = useCallback(
    (charName: string, voice: QuoteTtsVoice) => {
      // 整表写回：`updatePluginConfig` 会对 config 做深合并，因此传全量 map 与传
      // 单键增量等价，且不会丢其它角色的绑定。写入经 App 注册的 writer ⇒ 必然落盘
      // 到 `nyaachat_settings`（SSOT §2.4 的「配置写入单一路径」）。
      updateConfig({ characterMap: { ...characterMap, [charName]: voice } });
    },
    [characterMap, updateConfig],
  );

  const handlePreview = useCallback(
    async (charName: string, voice: QuoteTtsVoice) => {
      // 互斥：加载/播放中重复点击不叠加（ST 原版语义）。
      if (preview?.phase === "loading") return;
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
      releaseAudio();
      setPreview({ charName, phase: "loading" });

      try {
        const blob = await callBackend<Blob>(QUOTE_TTS_SPEECH_CAPABILITY, {
          input: PREVIEW_TEXT.slice(0, MAX_INPUT_LENGTH),
          voice,
          response_format: RESPONSE_FORMAT,
        });

        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        const audio = new Audio(objectUrl);
        audioRef.current = audio;

        audio.onended = () => {
          releaseAudio();
          setPreview(null);
        };
        audio.onerror = () => {
          releaseAudio();
          setPreview({ charName, phase: "error" });
          errorTimerRef.current = setTimeout(() => setPreview(null), 2000);
        };

        await audio.play();
        setPreview({ charName, phase: "playing" });
      } catch (err) {
        // 后端不可用 / 未配置（P4 的 503）/ 上游失败都会走到这里。面板不弹 toast
        // （NyaaChat 无 ST 的 toastr），控制台留痕 + 按钮短暂显示 ❌。
        console.error(`[quote-tts] 试听失败（${charName} · ${voice}）`, err);
        releaseAudio();
        setPreview({ charName, phase: "error" });
        errorTimerRef.current = setTimeout(() => setPreview(null), 2000);
      }
    },
    [callBackend, preview?.phase, releaseAudio],
  );

  const previewingChar = preview?.phase === "playing" ? preview.charName : null;

  return (
    <div className="space-y-5">
      <Field
        label="角色音色绑定"
        actionSlot={
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            共 {participants.length} 个参与者
          </span>
        }
      >
        <div className="rounded-xl border border-gray-200 dark:border-white/10 p-3 sm:p-4">
          {participants.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              当前会话未检测到角色。
            </p>
          ) : (
            <ul className="space-y-2 list-none">
              {participants.map((charName) => {
                // 未绑定音色时的回落值**按行区分**（与装饰侧同一口径，见 voices.ts）：
                // 用户角色行 → 云健；其余（对话角色）→ 晓晓。
                const isUserRow = charName === host.identity.user;
                const fallback = defaultVoiceFor(isUserRow ? "user" : "character");
                const voice = characterMap[charName] ?? fallback;
                const isPreviewingThis = preview?.charName === charName;
                const phase = isPreviewingThis ? preview?.phase : undefined;
                const icon =
                  phase === "loading" ? ICON_LOADING : phase === "error" ? ICON_ERROR : ICON_IDLE;
                return (
                  <li key={charName} className="flex flex-wrap items-center gap-2">
                    <span
                      className={`flex-1 min-w-[6rem] truncate text-sm ${
                        previewingChar === charName
                          ? "text-blue-600 dark:text-blue-400 font-medium"
                          : "text-gray-800 dark:text-gray-200"
                      }`}
                      title={charName}
                    >
                      {charName}
                    </span>
                    <div className="flex items-center gap-2 ml-auto flex-shrink-0">
                      <select
                        value={voice}
                        onChange={(event) => {
                          const next =
                            AVAILABLE_VOICES.find((candidate) => candidate === event.target.value) ??
                            fallback;
                          handleVoiceChange(charName, next);
                        }}
                        aria-label={`${charName} 的音色`}
                        className="w-40 sm:w-52 px-2 py-1.5 border border-gray-200 dark:border-white/10 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all text-xs"
                      >
                        {AVAILABLE_VOICES.map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {candidate}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        title={`试听（${charName} · ${voice}）`}
                        aria-label={`试听 ${charName} 的音色`}
                        aria-busy={phase === "loading"}
                        disabled={preview?.phase === "loading"}
                        onClick={() => void handlePreview(charName, voice)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm leading-none cursor-pointer select-none hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 disabled:cursor-default disabled:opacity-60"
                      >
                        <span aria-hidden="true">{icon}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Field>

      <FieldHint>
        参与者按当前会话自动扫描：当前用户角色名、当前角色名，以及消息里「人名:
        “引用”」的行首前缀。音色改动即时保存；试听使用固定文案「{PREVIEW_TEXT}」（上限{" "}
        {MAX_INPUT_LENGTH} 字符）。未绑定音色的角色按类型回落：用户角色 →{" "}
        {USER_DEFAULT_VOICE}，对话角色 → {CHARACTER_DEFAULT_VOICE}。
      </FieldHint>
    </div>
  );
}

export default QuoteTtsSettings;
