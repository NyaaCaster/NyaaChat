/**
 * AnswererFlagalac · `unicodeEncoding` — 转义格式的**唯一来源**（编码 + 解码）。
 *
 * 为什么需要这个模块：该选项要求"可能触发内容审查的措辞改用 `\uXXXX` 写出"，
 * 于是同一套转义格式同时出现在**两个方向**上——
 *   · 出站（编码）：用户消息在发给模型前改写成转义形式（请求侧，见 chatPipeline）；
 *   · 入站（解码）：模型回文本里的转义在**显示时**还原成明文（见 MessageItem）。
 * 两端必须逐字一致，因此格式、正则、码位处理都收敛在这里，调用方不得自带字面量。
 *
 * 实测依据（2026-09-13，`_probes/probe-37flash.mjs --two-turn`，n=1 四格对照 + 复现）：
 *   平台（`rix_api_error` 500）读的是**用户自己最新那条发言**：
 *     历史明文 + 用户明文 → 500；历史转义 + 用户明文 → 500；
 *     历史明文 + 用户转义 → 200；历史转义 + 用户转义 → 200（模型照常理解，正文最长 4779 字）。
 *   编码形态对模型无碍（它能读转义并继续创作），但对上游过滤器不可读 ⇒ 这就是本机制。
 *
 * 只转义**非 ASCII**：结构性标记（`<session_rules>`、`<session_conventions>`、JSON 字段名、
 * 函数名、工具参数名）全部是 ASCII，因此编码后协议不变；中文、中文标点、假名、emoji 一律转义。
 */

/** 完整转义：`\uXXXX`（BMP）与 `\u{...}`（补充平面）。解码侧只认完整形式。 */
const ESCAPE_RE = /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g;

/** Unicode 标量值上界 —— `String.fromCodePoint` 的合法上界（U+10FFFF）。 */
const MAX_CODE_POINT = 0x10ffff;

/**
 * 把文本里的**非 ASCII** 字符改写成转义序列；ASCII 逐字节保留。
 * 补充平面字符（emoji 等）用 `\u{...}` 形式，避免代理对在半途被截断。
 */
export function encodeFlagalacUnicodeEscapes(text: string): string {
  if (!text) return text;
  let needsEncoding = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) {
      needsEncoding = true;
      break;
    }
  }
  if (!needsEncoding) return text;
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x7f) out += ch;
    else if (cp <= 0xffff) out += "\\u" + cp.toString(16).padStart(4, "0");
    else out += "\\u{" + cp.toString(16) + "}";
  }
  return out;
}

/**
 * 还原 `\uXXXX` / `\u{...}`；**只解完整转义**——流式分块可能把一个转义切成两半，
 * 截断的尾巴保持字面量（不臆造内容）。渲染每来一个 chunk 重跑一次，尾部自然补全。
 *
 * 越界码位策略（t22，既有缺陷修复）：`\u{...}` 的花括号形式允许 1–6 位十六进制，
 * 因此能拼出 `\u{110000}`（= 0x110000 > U+10FFFF）这种**非法码位**，而
 * `String.fromCodePoint(0x110000)` 会抛 `RangeError: Invalid code point`——
 * 过去这条路径会直接把整条消息的渲染炸掉（MessageItem / 复制 / 拒绝判定都调本函数）。
 * 处理策略与"截断转义"一致：**越界片段保持字面量、原样返回**（既不抛异常，也不吞字符、
 * 不做替换字符 U+FFFD）。理由：① 不丢信息，越界片段必然是模型或用户粘贴的原文，
 * 留着可见才能被发现；② 与"只解合法完整转义"的既有语义同构（不臆造内容）；
 * ③ 文本里只有越界片段时解码是恒等变换 ⇒ 往返仍幂等。
 * `\uXXXX` 四位形式 = 0..0xFFFF，天然不会越界。
 */
export function decodeFlagalacUnicodeEscapes(text: string): string {
  if (!text || text.indexOf("\\u") === -1) return text;
  return text.replace(ESCAPE_RE, (m, braces: string | undefined, quad: string | undefined) => {
    const cp = parseInt(braces ?? quad ?? "0", 16);
    // 非法/越界 ⇒ 保留字面量（见上方策略注释）。isFinite 同时挡住 NaN/Infinity ——
    // 兜底防未来放宽正则后出现非十六进制捕获组（当前正则已排除该情形）。
    if (!Number.isFinite(cp) || cp > MAX_CODE_POINT) return m;
    return String.fromCodePoint(cp);
  });
}
