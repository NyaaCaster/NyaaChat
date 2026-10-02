/**
 * 长文本自适应断句（v1.1.0 引入）—— 「朗读消息」的分段纯函数。
 *
 * ## 为什么必须分段
 *
 * 上游链路对单请求有三重压力：① ext-host 硬上限 `MAX_INPUT_LENGTH = 1000`
 * （超出直接 400，前端此前只能**静默截断丢弃**长文尾部）；② 本机 edge-tts 服务
 * （travisvn/openai-edge-tts）非流式模式下 `communicator.save()` **同步阻塞**合成
 * 整段 mp3 —— 输入越长单请求占用越久，越容易撞上边车 60s 超时；③ 一次性大请求
 * 对微软 Edge 在线 TTS 上游与局域网传输都是峰值负担。
 *
 * ## 算法（两级切分 + 贪心聚合，成熟方案的收敛形态）
 *
 * 业界（epub_to_audiobook / legado / Coqui TTS text_splitter 等阅读器与有声书
 * 项目）对长文本 TTS 的共识做法：**按句子边界分段 → 贪心聚合到目标段长 →
 * 超长单句按弱标点回退 → 硬切兜底**。本实现：
 *
 *  1. **句子层**：`Intl.Segmenter(locale, { granularity: "sentence" })` ——
 *     浏览器**原生**句子边界 API（Web Baseline 2024：Chrome/Edge 87+、Safari
 *     14.1+、Firefox 125+，Node 16+；底层是 ICU/CLDR 句界规则，对中文
 *     `。！？；…` 可靠，还能正确处理 `Mr.` 这类英文缩写误切）。环境不支持时
 *     （旧 Firefox）回退到正则按句末标点切分。
 *  2. **聚合层**：按出现顺序贪心聚合句子，直到再放一句就超过 `TARGET_CHUNK`
 *     —— 短句被自然合并（减少请求数与段间停顿），段长落在 200~500 字的
 *     业界常用区间（单段合成 2~5s，边播边预取零空隙）。
 *  3. **回退层**：超过 `HARD_LIMIT` 的单句按弱标点（`，、：`）**就近**二次切分；
 *     仍超限的残余按 `MAX_CHUNK` 硬切（保证任何输入都终结）。
 *
 * 切分点把**标点留在段尾**（原文连续切片），段与段之间不做任何改写 ——
 * 与引号扫描（quoteScan.ts）同一条「不改写正文」纪律。
 */

/** 目标段长（字符）：业界常用 200–500 区间的中值。单段合成约 2–5s，
 *  串行流水线（预取深度 1）下播放无缝，且不把段切得太碎（中文段边界处
 *  音调衔接有既有折损，段越碎损失频率越高）。 */
export const TARGET_CHUNK_LENGTH = 300;

/** 单段硬上限：必须 ≤ ext-host 的 `MAX_INPUT_LENGTH`（1000），否则必被 400。
 *  聚合与回退都以它收口。 */
export const MAX_CHUNK_LENGTH = 900;

/** 二级回退（弱标点）优先在什么范围找切点：就近原则 —— 从「离硬上限最近」
 *  的弱标点往前找，找不到再放宽。 */
const SECONDARY_BREAK_CHARS = "，、：,、: ";

/** 句子层的最小产出保护：Segmenter/正则都可能产出纯空白句（连续换行等），
 *  丢弃时不产生缺口（原文连续拼接即可覆盖）。 */
const BLANK_RE = /^\s*$/;

interface SegmenterLike {
  segment(input: string): Iterable<{ index: number; segment: string }>;
}

/** 环境探测：模块加载时判一次（不逐调用探测 —— 结果不会变）。 */
const SENTENCE_SEGMENTER: SegmenterLike | null = (() => {
  try {
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
      return null;
    }
    // 探测 + 实例化一次：句界规则由 locale 驱动，zh 覆盖本插件全部朗读文本。
    return new Intl.Segmenter("zh", { granularity: "sentence" }) as unknown as SegmenterLike;
  } catch {
    return null;
  }
})();

/** 无 Segmenter 环境的正则回退：句末标点（含省略号/换行）后为句边界。 */
const SENTENCE_END_RE = /[^。！？；…\n]*[。！？；…\n]+|[^。！？；…\n]+$/g;

/** 按 Segmenter（或正则回退）把文本切成句子数组。切片**连续无缝**
 *  （`sentences.join("") === text`），不丢任何字符。 */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];

  if (SENTENCE_SEGMENTER) {
    for (const item of SENTENCE_SEGMENTER.segment(text)) {
      if (item.segment) sentences.push(item.segment);
    }
    return sentences;
  }

  SENTENCE_END_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END_RE.exec(text)) !== null) {
    sentences.push(match[0]);
  }
  return sentences;
}

/** 单句超限时的二级切分：从不超过上限的**最靠后**弱标点（含标点本身）处断开。
 *  找不到弱标点时返回 null（交给硬切兜底）。
 *  就近原则 = 尽量用满句长、少切几刀 —— 与「先弱标点、整句仍超限才硬切」的
 *  业界惯例一致。 */
function splitAtSecondary(text: string, limit: number): [string, string] | null {
  let best = -1;
  for (let i = Math.min(limit, text.length) - 1; i > 0; i--) {
    if (SECONDARY_BREAK_CHARS.includes(text[i])) {
      // 切点含弱标点本身（标点留在段尾），且该前缀本身不超限。
      if (i + 1 <= limit) {
        best = i + 1;
        break;
      }
    }
  }
  if (best <= 0) return null;
  return [text.slice(0, best), text.slice(best)];
}

/** 把一个超限句子切成 ≤ limit 的段序列（弱标点优先、硬切兜底）。 */
function splitLongSentence(sentence: string): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_CHUNK_LENGTH) {
    const secondary = splitAtSecondary(rest, MAX_CHUNK_LENGTH);
    if (secondary) {
      out.push(secondary[0]);
      rest = secondary[1];
    } else {
      // 硬切兜底：不感知标点，保证终结。
      out.push(rest.slice(0, MAX_CHUNK_LENGTH));
      rest = rest.slice(MAX_CHUNK_LENGTH);
    }
  }
  if (rest) out.push(rest);
  return out;
}

export interface TextChunk {
  /** 段文本（原文切片，未改写）。 */
  text: string;
  /** 0 起的段序号，用于播放进度展示。 */
  index: number;
  /** 总段数（与 index 同源，避免调用方数数组）。 */
  total: number;
}

// ─── 朗读前的文本准备：剔除 <></> 类标签及其包裹内容 ─────────────────────────
//
// 聊天气泡的显示口径文本（正则脚本处理后的 markdown 原文）可能残留 LLM 输出的
// 指令/占位标签（<think>、<StatusPlaceHolderImpl>、前端卡片的 HTML 等）——
// 标签包裹的内容**不是要说给用户听的话**，必须在分段前整体剔除。
//
// 对齐参照：本机 edge-tts 服务端 `handle_text.py` 的 `prepare_tts_input_with_context`
// 也在合成前清理 HTML/markdown，但它是**保留内容只去标签**；本场景语义相反
// （标签包裹的内容不朗读），故成对标签**连内容一起去掉**，孤立标签去标签本身。
//
// 安全边界：标签名必须以字母开头且 `<` 后不能是空白 —— `a < b > c` 这类
// 数学/比较写法不会被误伤（`< b` 的 `<` 后是空格，不满足标签形态）。

/** 成对标签及其包裹内容：`<tag ...>...</tag>`（tag 为字母开头的标识符，≤60 字符，
 *  覆盖 HTML 标签与 ST 生态的自定义指令标签）。 */
const PAIRED_TAG_RE = /<([A-Za-z][^<> \t\n]{0,60})[^<>]*>([\s\S]*?)<\/\1[ \t\n]*>/g;

/** 孤立标签（清理残余）：自闭合 `<tag/>`、未成对的 `<tag>` / `</tag>`、HTML 注释。 */
const LONE_TAG_RE = /<\/?[A-Za-z][^<> \t\n]{0,60}(?:[^<>]*\/?)?>/g;
const COMMENT_TAG_RE = /<!--[\s\S]*?-->/g;

/** 剥掉全部成对标签（含嵌套）：每轮剥最内层，外层下一轮变内层，直到不动点。 */
function stripPairedTags(text: string): string {
  let prev = "";
  let cur = text;
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(PAIRED_TAG_RE, "");
  }
  return cur;
}

/**
 * 朗读文本准备：剔除 `<></>` 类标签包裹的内容（以及清理后残余的孤立标签与
 * HTML 注释），并压缩清理产生的多余空白（连续空行 → 单个空行，行内多空格 →
 * 单空格）。
 *
 * 由 `chunkText()` 在入口处调用 —— 调用方只需传显示口径原文，无需记得先清理。
 */
export function prepareSpeechText(input: string): string {
  let text = stripPairedTags(input);
  text = text.replace(COMMENT_TAG_RE, "");
  text = text.replace(LONE_TAG_RE, "");
  // 标签整段剔除后可能留下成段空行：压缩成单个空行（段落边界保留），
  // 行内多空格折叠 —— 避免把"空白段"交给 TTS 读出怪异停顿。
  text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  return text.trim();
}

/**
 * 把任意长度文本切成适合逐段合成朗读的段序列。
 *
 * 纯函数、零依赖（除 `voices.ts` 无关），导出以便独立验证：
 *  · `chunks.map(c => c.text).join("")` ≈ 原文去首尾空白（`text.trim()` 后进入
 *    本函数，首尾空白丢弃与旧版「朗读前 slice」口径一致）；
 *  · 除硬切兜底外，所有切点都落在句子边界或弱标点之后；
 *  · `Math.max(...chunks.map(c => c.text.length))` ≤ `MAX_CHUNK_LENGTH`。
 */
export function chunkText(input: string): TextChunk[] {
  // 先做标签剔除等朗读前清理（分段作用于"要说的话"，不是显示原文）。
  const text = prepareSpeechText(input);
  if (!text) return [];

  // 每句先做「超限预切」：超限句子在聚合**之前**已变成合法段 —— 聚合层就
  // 不需要"装不下再拆"的复杂回填逻辑（那是自创形状；预切是惯例做法）。
  const units: string[] = [];
  for (const sentence of splitSentences(text)) {
    if (BLANK_RE.test(sentence)) continue;
    if (sentence.length > MAX_CHUNK_LENGTH) units.push(...splitLongSentence(sentence));
    else units.push(sentence);
  }

  // 贪心聚合：短句合并到目标长度；单句（已预切）天然 ≥ 结果下限。
  const chunks: TextChunk[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      chunks.push({ text: buffer, index: chunks.length, total: 0 });
      buffer = "";
    }
  };
  for (const unit of units) {
    if (!buffer) {
      buffer = unit;
    } else if (buffer.length + unit.length <= TARGET_CHUNK_LENGTH) {
      buffer += unit;
    } else {
      flush();
      buffer = unit;
    }
  }
  flush();

  // 回填总数（Segmenter 可能产出 0 段的空输入已在前面拦截）。
  for (const chunk of chunks) chunk.total = chunks.length;
  return chunks;
}
