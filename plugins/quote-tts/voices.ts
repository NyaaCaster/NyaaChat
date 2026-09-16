/**
 * quote-tts 的领域常量与取值口径。
 *
 * ⚠️ 本文件由 **captain 自办**（2026-09-15 从 t6 收回）。收回理由：`voices.ts` 是
 * `QuoteTtsButton.tsx`（captain 自办）的硬依赖，而 `plugin.tsx`（t6）又要 import
 * `QuoteTtsButton` / `quoteScan` —— 若由 t6 写本文件，两个方向互相等待，必然出现
 * "谁先落地"的构建断链。常量表本身零逻辑，收回到依赖发起方最省事。
 *
 * 移植来源：`.ref/st-Quote-TTS/index.js` L17-32（14 个 Edge-TTS 音色）。
 *
 * ⚠️ **上游端点不在这里**。ST 版把 `TARGET_ENDPOINT` 硬编码在前端，并被
 * body 里的 `provider_endpoint` 决定实际转发目标（即被摘除的开放代理形态）；
 * NyaaChat 版把它交给 ext-host 的 `process.env`（SSOT §2.7 / §7.1），前端只调
 * 同源路径，请求体无法改写上游地址、模型与鉴权。
 */

/** 14 个 Edge-TTS 音色，顺序沿用 ST 原版（下拉框顺序即此顺序）。 */
export const AVAILABLE_VOICES = [
  "zh-CN-XiaoxiaoNeural",
  "zh-CN-XiaoyiNeural",
  "zh-CN-liaoning-XiaobeiNeural",
  "zh-CN-shaanxi-XiaoniNeural",
  "zh-HK-HiuGaaiNeural",
  "zh-HK-HiuMaanNeural",
  "zh-TW-HsiaoChenNeural",
  "zh-TW-HsiaoYuNeural",
  "zh-CN-YunjianNeural",
  "zh-CN-YunxiNeural",
  "zh-CN-YunxiaNeural",
  "zh-CN-YunyangNeural",
  "zh-HK-WanLungNeural",
  "zh-TW-YunJheNeural",
] as const;

export type QuoteTtsVoice = (typeof AVAILABLE_VOICES)[number];

/** 未配置音色时的回落值 —— **按说话人类型区分**（用户 2026-09-15 定稿）：
 *  · **用户角色**（消息 role = user）→ 云健（`zh-CN-YunjianNeural`，男声）
 *  · **对话角色**（助手/角色）→ 晓晓（`zh-CN-XiaoxiaoNeural`，女声）
 *  两者都只在"用户没有自己改过该角色音色"时生效；一旦用户在某角色行改过，就按存档走。 */
export const USER_DEFAULT_VOICE: QuoteTtsVoice = "zh-CN-YunjianNeural";
export const CHARACTER_DEFAULT_VOICE: QuoteTtsVoice = "zh-CN-XiaoxiaoNeural";

/** 历史别名：等同"对话角色"的默认音色（面板与按钮在拿不到类型时用它兜底）。 */
export const DEFAULT_VOICE: QuoteTtsVoice = CHARACTER_DEFAULT_VOICE;

/** 按说话人类型取默认音色。 */
export function defaultVoiceFor(kind: "user" | "character"): QuoteTtsVoice {
  return kind === "user" ? USER_DEFAULT_VOICE : CHARACTER_DEFAULT_VOICE;
}

/** 设置面板「试听」按钮的固定文案（沿用 ST 原版）。 */
export const PREVIEW_TEXT = "欢迎使用由妮娅开发的敏捷语音生成插件。";

/** 上游模型 id（沿用 ST 原版；实际模型由 ext-host 的 env 覆盖）。 */
export const MODEL_ID = "tts-1-hd";

export const RESPONSE_FORMAT = "mp3";

/** 单次合成的输入上限 —— 必须与 ext-host 侧的限制一致（SSOT §2.7）。 */
export const MAX_INPUT_LENGTH = 1000;

// ─── 插件身份与后端能力声明 ──────────────────────────────────────────────────
// 这三个常量是 `plugin.tsx` 的 `backend[]` 声明与调用方共用的唯一来源：
// 能力名必须全仓唯一，路径必须以 `/api/ext-host/plugins/<id>/` 开头（注册表校验）。

export const QUOTE_TTS_PLUGIN_ID = "quote-tts";
export const QUOTE_TTS_SPEECH_CAPABILITY = "quote-tts.speech";
export const QUOTE_TTS_SPEECH_PATH = "/api/ext-host/plugins/quote-tts/speech";

/** 插件配置形态：`{ characterMap: { [角色名]: 音色 } }`。 */
export interface QuoteTtsConfig {
  characterMap: Record<string, QuoteTtsVoice>;
}

export const QUOTE_TTS_DEFAULTS: QuoteTtsConfig = { characterMap: {} };

const VOICE_SET: ReadonlySet<string> = new Set(AVAILABLE_VOICES);

/** 把任意来源的 config 收敛成合法形态：非对象丢空，非白名单音色丢弃。 */
export function readCharacterMap(config: Record<string, unknown> | undefined): Record<string, QuoteTtsVoice> {
  const raw = config?.characterMap;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, QuoteTtsVoice> = {};
  for (const [charName, voice] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof voice === "string" && VOICE_SET.has(voice)) {
      out[charName] = voice as QuoteTtsVoice;
    }
  }
  return out;
}

/** 角色 → 音色；未配置或配置了非法值时回落到 `fallback`（默认 = 对话角色默认音色）。
 *  调用方按说话人类型传 `defaultVoiceFor("user" | "character")` 即可区分用户/角色默认。 */
export function resolveVoice(
  characterMap: Record<string, QuoteTtsVoice>,
  charName: string,
  fallback: QuoteTtsVoice = DEFAULT_VOICE,
): QuoteTtsVoice {
  return characterMap[charName] ?? fallback;
}
