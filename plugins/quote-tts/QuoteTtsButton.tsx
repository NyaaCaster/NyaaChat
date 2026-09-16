/**
 * 🔊 消息内播放按钮 ── quote-tts 的消息装饰渲染组件。
 *
 * ⚠️ 本文件由 **captain 自办**（用户 2026-09-15 明确要求：装饰区间相关实现不派发
 * 子代理，由 captain 亲自做以便实时核对）。
 *
 * 对照 ST 原版（`.ref/st-Quote-TTS/index.js` L187-249）的四处**必须替换**的写法：
 *
 * | ST 版 | 本版 | 原因 |
 * |---|---|---|
 * | 拼接 HTML 字符串回写 `$element.html()` | 渲染 React 组件 | 摘除后已无 `.mes_text` DOM 逃逸区；且不引入 `dangerouslySetInnerHTML` |
 * | `window.playQuoteTTS(this, ...)` 全局函数 + `onclick` 内联属性 | 组件内闭包 `play()` | 全局挂载点在 React 下无存在理由，且内联 `onclick` 与 sanitize 冲突 |
 * | `fetch(ST_PROXY_URL, {provider_endpoint, api_key, token})` —— 上游由 **body** 指定 | `callPluginBackend(PLUGIN_ID, CAPABILITY, { input, voice, response_format })` —— 上游由 **ext-host 的 process.env** 决定 | ST 那条路径正是被摘除的开放代理（SSRF 面）；§7.1 红线 |
 * | `getRequestHeaders()`（ST 注入的 CSRF/鉴权头） | 无 —— 同源 fetch，鉴权由 nginx Basic Auth 层处理 | ST 专有 API |
 *
 * 播放互斥沿用 ST 语义：`loading` 期间重复点击直接返回；新请求开始前先停掉并回收
 * 上一段音频的 object URL（避免 `URL.createObjectURL` 泄漏）。
 *
 * ## 依赖注入（t10：本文件不 import 任何宿主模块）
 *
 * `config` / `callBackend` 由**装饰上下文经 props 注入**：`plugin.tsx` 的
 * `decorators.messageText[0]` 把 `ctx.config` / `ctx.callBackend` 传下来。因此本文件
 * 的运行时依赖只剩 `./voices` 与 React。
 *
 * 原先本组件自己订阅并读取宿主模块（`useSyncExternalStore(subscribePluginRuntime, …)`
 * + `getPluginConfig()`），那条路径构成模块环：
 *
 * ```
 * plugins/registry → plugin.tsx → QuoteTtsButton → src/plugins/runtime
 *                  → src/plugins/registry → plugins/registry   （回到起点）
 * ```
 *
 * 环的后果：以**插件模块本身**为图入口（不经 `src/plugins/registry`）时，
 * `plugins/registry` 会在插件模块尚未求值完时读它的 `default`，于是注册表里留下一个
 * `undefined` 槽位 —— 插件静默消失（列表不显示、backend 调用被拒、装饰被跳过），
 * 只在加载期留一条 `[plugins] meta: 插件对象或其 meta 不是对象` 的 console.error。
 * 生产入口是 `src/plugins/registry`，所以线上未暴露；但任何测试 / 工具 / 新入口直接
 * 引插件模块都会踩到（t10）。断环只需要本文件不引宿主模块，注入即等价。
 *
 * ### 删掉自订阅后「改音色即时生效」为什么还在
 *
 * `MessageItem` 已经订阅了运行时快照
 * （`React.useSyncExternalStore(subscribePluginRuntime, getPluginRuntimeSnapshot)`）：
 * 配置一变 ⇒ MessageItem 重渲染 ⇒ 装饰器以最新 `ctx.config` 重算 ⇒ 新 config 作为
 * prop 传下来 ⇒ 按钮用新音色渲染（`title` 也随之更新）。这条链是验收项，别丢。
 */
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
// type-only：编译期擦除，不产生运行时边，因此不会重新引入上面的环。
import type { PluginBackendCaller } from "../../src/plugins/types";
import {
  DEFAULT_VOICE,
  MAX_INPUT_LENGTH,
  QUOTE_TTS_SPEECH_CAPABILITY,
  RESPONSE_FORMAT,
  readCharacterMap,
  resolveVoice,
  type QuoteTtsVoice,
} from "./voices";

export interface QuoteTtsButtonProps {
  /** 引号片段的纯文本（含引号本身，与 ST 一致）。 */
  text: string;
  /** 说话人：带「人名:」前缀时是前缀，否则是消息发送者。 */
  charName: string;
  /** 当前插件配置快照（装饰上下文注入；语义同 `getPluginConfig(pluginId)`）。 */
  config: Record<string, unknown>;
  /** 后端调用器（装饰上下文注入；上游由 ext-host 的 env 决定）。 */
  callBackend: PluginBackendCaller;
  /** 该角色**尚未绑定音色**时的回落值。由装饰上下文按说话人类型给出
   *  （用户消息 → 云健 / 助手与角色 → 晓晓，见 `voices.ts` 的 `defaultVoiceFor`）。
   *  必须与设置面板同一口径，否则面板显示的音色与实际播放的不一致。 */
  defaultVoice?: QuoteTtsVoice;
}

type PlaybackState = "idle" | "loading" | "error";

const ICON_IDLE = "🔊";
const ICON_LOADING = "⏳";
const ICON_ERROR = "❌";

export const QuoteTtsButton: React.FC<QuoteTtsButtonProps> = ({
  text,
  charName,
  config,
  callBackend,
  defaultVoice = DEFAULT_VOICE,
}) => {
  const [state, setState] = useState<PlaybackState>("idle");

  // 音色表按需派生（对象很小，不需要 memo）。`config` 是注入进来的 prop，本组件不再
  // 自己订阅运行时 —— 重渲染由 `MessageItem` 的快照订阅驱动（见文件头「依赖注入」）。
  const characterMap = readCharacterMap(config);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 停掉当前音频并回收 object URL（幂等）。 */
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

  // 卸载时清理，避免播放中切走留下仍在播放的音频与泄漏的 URL。
  useEffect(
    () => () => {
      releaseAudio();
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    },
    [releaseAudio],
  );

  const play = useCallback(async () => {
    // 互斥：正在加载/播放时重复点击不叠加（ST 原版语义一致）。
    if (state === "loading") return;
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    releaseAudio();
    setState("loading");

    try {
      const voice = resolveVoice(characterMap, charName, defaultVoice);
      const blob = await callBackend<Blob>(QUOTE_TTS_SPEECH_CAPABILITY, {
        input: text.slice(0, MAX_INPUT_LENGTH),
        voice,
        response_format: RESPONSE_FORMAT,
      });

      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      audioRef.current = audio;

      audio.onended = () => {
        releaseAudio();
        setState("idle");
      };
      audio.onerror = () => {
        releaseAudio();
        setState("error");
        errorTimerRef.current = setTimeout(() => setState("idle"), 2000);
      };

      await audio.play();
      // 刻意保持在 loading（⏳）直到播放结束 —— 与 ST 原版表现一致：按钮即播放状态。
    } catch (err) {
      // 后端不可用 / 未配置 / 上游失败都会走到这里。不弹 toast（NyaaChat 无 ST 的
      // toastr），控制台留痕 + 按钮短暂显示 ❌。
      console.error(`[quote-tts] 播放失败（${charName}）`, err);
      releaseAudio();
      setState("error");
      errorTimerRef.current = setTimeout(() => setState("idle"), 2000);
    }
  }, [callBackend, characterMap, charName, defaultVoice, releaseAudio, state, text]);

  const icon = state === "loading" ? ICON_LOADING : state === "error" ? ICON_ERROR : ICON_IDLE;
  const voice = resolveVoice(characterMap, charName, defaultVoice);

  return (
    <button
      type="button"
      className="quote-tts-btn inline-flex items-center align-middle ml-0.5 px-1 py-0 rounded text-[0.95em] leading-none cursor-pointer select-none hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 disabled:cursor-default"
      title={`播放（${charName} · ${voice}）`}
      aria-label={`播放 ${charName} 的语音`}
      aria-busy={state === "loading"}
      disabled={state === "loading"}
      onClick={(event) => {
        // 消息体可能有自己的点击行为（选中/折叠），播放不应连带触发。
        event.stopPropagation();
        void play();
      }}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
};

export default QuoteTtsButton;
