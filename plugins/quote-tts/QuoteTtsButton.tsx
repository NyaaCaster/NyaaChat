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
 * 播放语义（v1.1.0）：合成（⏳）与播放（🔊 高亮）是两个可见状态；播放中/合成中
 * 再次点击 = 停止（toggle），且经由 `playbackCoordinator` 与本插件**其它任何**
 * 朗读按钮全局互斥 —— 点击新按钮时旧语音先停（需求 2026-10-03 定稿）。
 * 新请求开始前先停掉并回收上一段音频的 object URL（避免 `URL.createObjectURL` 泄漏）。
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
import { claimPlayback, releasePlayback } from "./playbackCoordinator";
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

type PlaybackState = "idle" | "loading" | "playing" | "error";

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
  // 状态机：idle → loading（合成中）→ playing（播放中）→ idle；error 两秒回落。
  // v1.1.0 起合成与播放拆成两个可见状态（此前全程 ⏳、且播放中 disabled 无法停止），
  // 播放中点击 = 停止（toggle），与气泡「朗读消息」按钮同一套语义。
  const [state, setState] = useState<PlaybackState>("idle");

  // 音色表按需派生（对象很小，不需要 memo）。`config` 是注入进来的 prop，本组件不再
  // 自己订阅运行时 —— 重渲染由 `MessageItem` 的快照订阅驱动（见文件头「依赖注入」）。
  const characterMap = readCharacterMap(config);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 本会话的活性闸门：被协调器/toggle/卸载停止后置 false，异步回调先查它。 */
  const sessionRef = useRef({ active: false });
  /** stopSelf 的稳定引用（stopSelf 定义里要 release 自己的席位）。 */
  const stopSelfRef = useRef<() => void>(() => {});

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

  /** 停止本会话：退席（若占席）→ 关闸门 → 停音频 → 复位 UI。同步、幂等 ——
   *  被其它按钮打断（协调器调用）、自己 toggle、播放自然结束都走这里。 */
  const stopSelf = useCallback(() => {
    releasePlayback(stopSelfRef.current);
    sessionRef.current.active = false;
    releaseAudio();
    setState("idle");
  }, [releaseAudio]);
  stopSelfRef.current = stopSelf;

  // 卸载时清理：正在播放时切走不留仍在响的音频，同时退掉协调器席位。
  useEffect(
    () => () => {
      stopSelfRef.current();
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    },
    [],
  );

  const play = useCallback(async () => {
    // toggle：合成/播放中再次点击 = 停止。
    if (sessionRef.current.active) {
      stopSelf();
      return;
    }
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    releaseAudio();

    const session = { active: true };
    sessionRef.current = session;
    // 先认领全局席位（若别的按钮正在朗读会被立即停止），再开始合成。
    claimPlayback(stopSelfRef.current);
    setState("loading");

    try {
      const voice = resolveVoice(characterMap, charName, defaultVoice);
      const blob = await callBackend<Blob>(QUOTE_TTS_SPEECH_CAPABILITY, {
        input: text.slice(0, MAX_INPUT_LENGTH),
        voice,
        response_format: RESPONSE_FORMAT,
      });

      // 合成到达时先查闸门：被其它按钮/卸载打断的音频直接丢弃（软取消）。
      if (!session.active) return;
      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      audioRef.current = audio;

      const finish = () => {
        releaseAudio();
        stopSelfRef.current();
      };
      audio.onended = finish;
      audio.onerror = () => {
        if (!session.active) return;
        releaseAudio();
        session.active = false;
        releasePlayback(stopSelfRef.current);
        setState("error");
        errorTimerRef.current = setTimeout(() => setState("idle"), 2000);
      };

      setState("playing");
      await audio.play();
      // 播放中保持 playing（🔊 高亮）直到播放结束 —— 按钮即播放状态；
      // 期间再次点击由 onClick 走 stopSelf()。
    } catch (err) {
      // 后端不可用 / 未配置 / 上游失败都会走到这里。不弹 toast（NyaaChat 无 ST 的
      // toastr），控制台留痕 + 按钮短暂显示 ❌。被软取消的请求也会 reject：
      // 会话已关时不改 UI（stopSelf 已复位）。
      if (!session.active) return;
      console.error(`[quote-tts] 播放失败（${charName}）`, err);
      releaseAudio();
      session.active = false;
      releasePlayback(stopSelfRef.current);
      setState("error");
      errorTimerRef.current = setTimeout(() => setState("idle"), 2000);
    }
  }, [callBackend, characterMap, charName, defaultVoice, releaseAudio, stopSelf, text]);

  const icon = state === "loading" ? ICON_LOADING : state === "error" ? ICON_ERROR : ICON_IDLE;
  const voice = resolveVoice(characterMap, charName, defaultVoice);
  const title =
    state === "loading"
      ? "正在合成…点击取消"
      : state === "playing"
        ? `播放中…点击停止（${charName} · ${voice}）`
        : `播放（${charName} · ${voice}）`;

  return (
    <button
      type="button"
      className={`quote-tts-btn inline-flex items-center align-middle ml-0.5 px-1 py-0 rounded text-[0.95em] leading-none cursor-pointer select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 ${
        state === "playing"
          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" // 播放中的可见状态：高亮。
          : "hover:bg-black/5 dark:hover:bg-white/10"
      }`}
      title={title}
      aria-label={`播放 ${charName} 的语音`}
      aria-busy={state === "loading"}
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
