/**
 * 🔊 气泡朗读按钮（v1.1.0）── 整条消息的「朗读消息」入口，分段流水线播放。
 *
 * 出现在聊天气泡**底部按钮区**（`MessageItem.tsx` 的 actions 行，`生成图片`
 * 与`复制文本`之间），由**宿主按插件启用与否**条件渲染：插件停用时宿主不挂载
 * 本组件（按钮随插件启用开关出现/消失），因此本文件**不需要**自己感知 enabled。
 *
 * ## 为什么分段（v1.1.0）
 *
 * 整条消息可能几百到几千字，一次性全文请求有三重压力：① ext-host 硬上限
 * `MAX_INPUT_LENGTH = 1000`（旧版只能静默截断丢弃长文尾部）；② 本机 edge-tts
 * 服务非流式模式下同步阻塞合成整段 mp3，长输入 = 单请求长时间占用 + 易撞边车
 * 60s 超时；③ 大请求对微软 Edge 在线 TTS 上游与局域网传输都是峰值负担。
 * 改造为 **`textChunker.chunkText` 标点自适应分段 + 串行流水线播放**。
 *
 * ## 调度：串行流水线，预取深度 1（阅读器/有声书项目的成熟形态）
 *
 * ```
 * 合成第1段 → [播放第1段 ∥ 合成第2段] → [播放第2段 ∥ 合成第3段] → …
 * ```
 *
 *  · **任何时刻最多 1 个合成请求在途**（播放是本地行为不算）—— 对 edge-tts
 *    服务器最友好，不会并发打满触发限流；
 *  · 第 N 段**开始播放时**才发起第 N+1 段合成：300 字目标的单段合成（2~5s）
 *    短于单段播放时长，流水线足够让段间零空隙；
 *  · 预取深度 1 而不是更大：用户随时可停止（toggle），多预取只会浪费上游合成。
 *
 * ## 中断语义
 *
 * 播放/合成中**再次点击 = 停止**（长文朗读必须可中断）：立即结束当前段播放、
 * 丢弃在途请求的结果、清空整条流水线。**且经 `playbackCoordinator` 与本插件
 * 其它任何朗读按钮全局互斥** —— 播放中点击另一个按钮（对白 🔊 或别的气泡按钮）
 * 会先停掉本会话再开始新语音。`PluginBackendCaller` 不接受
 * `AbortSignal`（契约限制），取消是**软取消** —— 在途 fetch 结果被 `session.active`
 * 闸门丢弃，不发起新请求；单段请求体 ≤900 字符，让其自然完成对服务器无实质负担。
 * 卸载时同样先停止，避免播放中切走留下仍在响的音频。
 */
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Volume2, VolumeX } from "lucide-react";
// type-only：编译期擦除，不产生运行时边。
import type { PluginBackendCaller } from "../../src/plugins/types";
import { chunkText } from "./textChunker";
import { claimPlayback, releasePlayback } from "./playbackCoordinator";
import {
  CHARACTER_DEFAULT_VOICE,
  QUOTE_TTS_SPEECH_CAPABILITY,
  RESPONSE_FORMAT,
  readCharacterMap,
  resolveVoice,
  USER_DEFAULT_VOICE,
} from "./voices";

export interface QuoteTtsBubbleButtonProps {
  /** 朗读的正文（宿主给的显示口径文本，占位符已替换）。 */
  text: string;
  /** 该气泡的说话人名（展示口径，与设置面板的键一致）。 */
  speakerName: string;
  /** 说话人类型：user 气泡 → "user"，其余 → "character"（决定默认音色）。 */
  speakerKind: "user" | "character";
  config: Record<string, unknown>;
  callBackend: PluginBackendCaller;
}

type PlaybackState = "idle" | "loading" | "playing" | "error";

interface PlaybackSession {
  active: boolean;
}

export const QuoteTtsBubbleButton: React.FC<QuoteTtsBubbleButtonProps> = ({
  text,
  speakerName,
  speakerKind,
  config,
  callBackend,
}) => {
  const [state, setState] = useState<PlaybackState>("idle");
  // 播放进度（loading/playing 期间非空）：title 显示「第 i/N 段」。
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);

  const characterMap = readCharacterMap(config);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 当前朗读会话的活性闸门：停止/卸载置 false，所有异步回调先查它。 */
  const sessionRef = useRef<PlaybackSession>({ active: false });
  /** stopSelf 的稳定引用（stopSelf 定义里要 release 自己的席位）。 */
  const stopSelfRef = useRef<() => void>(() => {});

  /** 停掉当前音频并回收 object URL（幂等）——与 QuoteTtsButton 同一套语义。 */
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
   *  被其它按钮打断（协调器调用）、自己 toggle、流水线自然播完都走这里。 */
  const stopSelf = useCallback(() => {
    releasePlayback(stopSelfRef.current);
    sessionRef.current.active = false;
    releaseAudio();
    setProgress(null);
    setState("idle");
  }, [releaseAudio]);
  stopSelfRef.current = stopSelf;

  const stopPlayback = stopSelf;

  useEffect(
    () => () => {
      stopSelfRef.current();
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    },
    [],
  );

  const play = useCallback(async () => {
    // toggle：合成/播放中再次点击 = 停止（长文朗读必须可中断）。
    if (sessionRef.current.active) {
      stopPlayback();
      return;
    }
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
    releaseAudio();

    const chunks = chunkText(text);
    if (chunks.length === 0) return;

    const session: PlaybackSession = { active: true };
    sessionRef.current = session;
    // 先认领全局席位（若对白按钮或其它气泡按钮正在朗读会被立即停止），再开始合成。
    claimPlayback(stopSelfRef.current);
    setState("loading");
    setProgress({ index: 0, total: chunks.length });

    const defaultVoice =
      speakerKind === "user" ? USER_DEFAULT_VOICE : CHARACTER_DEFAULT_VOICE;
    const voice = resolveVoice(characterMap, speakerName, defaultVoice);

    /** 播放一段并等它播完（resolve on ended）；会话被停时立即返回。 */
    const playChunk = (blob: Blob): Promise<void> =>
      new Promise<void>((resolve) => {
        if (!session.active) return resolve();
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        const audio = new Audio(objectUrl);
        audioRef.current = audio;
        const settle = () => {
          releaseAudio();
          resolve();
        };
        // onended（自然播完）与 onpause（停止路径的 audio.pause()）都驱动 settle
        // —— 否则 stopSelf 先解绑 onended 再 pause，await playChunk 会永久挂起
        // （每次停止泄漏一个永不结束的 async 帧）。settle 幂等：resolve 多次无害。
        audio.onended = settle;
        audio.onpause = () => settle();
        audio.onerror = () => {
          if (!session.active) return resolve();
          releaseAudio();
          session.active = false;
          releasePlayback(stopSelfRef.current);
          setState("error");
          errorTimerRef.current = setTimeout(() => setState("idle"), 2000);
          resolve();
        };
        void audio.play().catch((err) => {
          if (!session.active) return resolve();
          console.error("[quote-tts] 气泡朗读播放失败", err);
          releaseAudio();
          session.active = false;
          releasePlayback(stopSelfRef.current);
          setState("error");
          errorTimerRef.current = setTimeout(() => setState("idle"), 2000);
          resolve();
        });
      });

    try {
      // 流水线：synth = 当前段的合成 promise；拿到后立刻发起下一段合成，
      // 再播放当前段 —— 预取与播放重叠，任何时刻最多 1 个请求在途。
      let synth = callBackend<Blob>(QUOTE_TTS_SPEECH_CAPABILITY, {
        input: chunks[0].text,
        voice,
        response_format: RESPONSE_FORMAT,
      });

      for (let i = 0; i < chunks.length; i++) {
        const blob = await synth;
        // 播放前查闸门：停止/卸载后到达的音频直接丢弃（软取消）。
        if (!session.active) return;
        synth =
          i + 1 < chunks.length
            ? callBackend<Blob>(QUOTE_TTS_SPEECH_CAPABILITY, {
                input: chunks[i + 1].text,
                voice,
                response_format: RESPONSE_FORMAT,
              })
            : Promise.resolve(null as unknown as Blob);
        setProgress({ index: i, total: chunks.length });
        setState("playing");
        await playChunk(blob);
        if (!session.active) return;
        setProgress(i + 1 < chunks.length ? { index: i + 1, total: chunks.length } : null);
      }

      // 自然播完（会话仍活）→ 复位。最后一段的 synth 是 null 占位，无需 await。
      if (session.active) stopPlayback();
    } catch (err) {
      // 后端不可用 / 未配置（503）/ 上游失败。被软取消的请求也会 reject ——
      // 会话已关时不改 UI（stopSelf 已复位）。
      if (!session.active) return;
      console.error(`[quote-tts] 气泡朗读失败（${speakerName}）`, err);
      releaseAudio();
      session.active = false;
      releasePlayback(stopSelfRef.current);
      setProgress(null);
      setState("error");
      errorTimerRef.current = setTimeout(() => setState("idle"), 2000);
    }
  }, [
    callBackend,
    characterMap,
    releaseAudio,
    speakerKind,
    speakerName,
    stopPlayback,
    text,
  ]);

  // 空气泡没有任何可朗读内容，宿主侧也无从触发本按钮 —— 双保险。
  if (!text?.trim()) return null;

  const title =
    state === "loading"
      ? `正在合成（第 ${(progress?.index ?? 0) + 1}/${progress?.total ?? 1} 段）…点击停止`
      : state === "playing"
        ? `播放中（第 ${(progress?.index ?? 0) + 1}/${progress?.total ?? 1} 段）…点击停止`
        : state === "error"
          ? "朗读失败（上游不可用？）"
          : `朗读消息（${speakerName} · ${resolveVoice(
              characterMap,
              speakerName,
              speakerKind === "user" ? USER_DEFAULT_VOICE : CHARACTER_DEFAULT_VOICE,
            )}）`;

  return (
    <button
      type="button"
      onClick={(event) => {
        // 气泡按钮区有自己的点击行为语义（编辑/删除/复制），朗读不连带触发。
        event.stopPropagation();
        void play();
      }}
      aria-label={`朗读 ${speakerName} 的消息`}
      aria-busy={state === "loading"}
      title={title}
      className={`p-1 transition-colors rounded ${
        state === "playing"
          ? "text-blue-500" // 播放中的可见状态：按钮高亮。
          : "text-gray-400 hover:text-blue-500"
      }`}
      // toggle 语义：播放/合成中点击 = 停止，因此任何状态下都不 disable
      // （长文合成可能持续数秒，必须给用户"反悔"入口）。
    >
      {state === "loading" ? (
        <Loader2 size={13} className="animate-spin" />
      ) : state === "playing" ? (
        <Volume2 size={13} />
      ) : state === "error" ? (
        <VolumeX size={13} />
      ) : (
        <Volume2 size={13} />
      )}
    </button>
  );
};

export default QuoteTtsBubbleButton;
