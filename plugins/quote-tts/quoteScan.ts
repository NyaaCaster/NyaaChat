/**
 * 引号扫描 —— 把 ST 扩展的 `.mes_text` DOM 扫描移植到 **块文本** 空间。
 *
 * ⚠️ 本文件由 **captain 自办**（用户 2026-09-15 明确要求：装饰区间相关实现不派发
 * 子代理，由 captain 亲自做以便实时核对）。
 *
 * ## 契约（SSOT §2.6，2026-09-15 经用户复核改为「逐块」）
 *
 * 宿主**逐块**调用装饰器（`p` / `li` / `blockquote` / `h1`~`h6` / `td`），传入的
 * `text` 就是**当前块的纯文本**；返回的 `start` / `end` 是**块内**字符偏移，
 * 空间定义天然正确（不存在"渲染后纯文本 vs markdown 原文"的偏移换算问题）。
 *
 * ## 与 ST 原版的差异（移植时必须理解，不得照抄）
 *
 * | 维度 | ST 版（`.ref/st-Quote-TTS/index.js` L87-113） | 本版 |
 * |---|---|---|
 * | 输入 | `$element.html()` —— **HTML 字符串** | 当前块的**纯文本** |
 * | 前缀判定 | `(?:^\|>\|[\n\r])\s*([^:<>&"'\n\r]{1,30}?):` —— 把 HTML 标签边界也算作起始 | `(?:^\|\n)[ \t]*([^:\n]{1,30}?):` —— 只认行首，无标签概念 |
 * | 引号对 | `([“‘「『][\s\S]*?[”’」』])` —— 开闭可错配（`“…」` 也算） | 逐对匹配（`“…”` / `‘…’` / `「…」` / `『…』`），不允许错配 |
 * | `charName` 兜底 | 无前缀 ⇒ 用所在 `.mes_block` 的 `.name_text` | 无前缀 ⇒ 用宿主给的 `senderName`（角色名口径与宏语义一致） |
 * | 产物 | 直接拼 HTML 字符串回写 DOM（`onclick="window.playQuoteTTS(...)"`） | 返回结构化区间，由宿主渲染 React 节点（**不注入 DOM**） |
 */

/** 一个引号片段。`start`/`end` 为**当前块文本内**的字符偏移，`[start, end)`。 */
export interface QuoteMatch {
  start: number;
  end: number;
  /** 同一块内唯一，作为 React key 的一部分。 */
  key: string;
  /** 含引号本身的原文（例如 `“你好”`）。 */
  text: string;
  /** 该片段的说话人：带「人名:」前缀时取前缀，否则回落 `senderName`。 */
  charName: string;
}

/** 单块装饰数量上限 —— 防病态输入（一行塞满引号）拖垮渲染。 */
const MAX_MATCHES_PER_BLOCK = 200;

/** 角色名前缀的长度上限，沿用 ST 原版的 30。 */
const MAX_INLINE_NAME_LENGTH = 30;

/** 带「人名:」前缀的引号（只认行首；允许前导空格/制表符）。
 *
 *  ⚠️ **字符类必须与设置面板的口径一致**（2026-09-15 修正）：面板侧
 *  `QuoteTtsSettings.INLINE_NAME_LINE_RE` 用 `[^:<>"'\n]`，而本正则原先用 `[^:\n]`
 *  ⇒ 形如 `猫娘 <b>角色</b>: 「早」` 会被**装饰命中却列不进面板**，用户配不到音色
 *  （`verify` 在 t7 发现）。ST 原版同样是排除 `<>` 的（`[^:<>&"'\n\r]`），故对齐面板
 *  既修一致性、也更贴近移植源。**两处若要改，必须同时改。** */
const PREFIXED_QUOTE_RE =
  /(?:^|\n)[ \t]*([^:<>"'\n]{1,30}?):[ \t]*(“[^”]*?”|‘[^’]*?’|「[^」]*?」|『[^』]*?』)/g;

/** 不带前缀的引号。 */
const PLAIN_QUOTE_RE = /(“[^”]*?”|‘[^’]*?’|「[^」]*?」|『[^』]*?』)/g;

/** 去掉引号本身后判断是否全空白（`“”` 这类空引用要被跳过）。 */
function isBlankQuotedContent(quoted: string): boolean {
  return quoted.slice(1, -1).trim().length === 0;
}

/**
 * 扫描一个文本块，返回按 `start` 升序、互不重叠的引号片段。
 *
 * @param text       当前块的纯文本
 * @param senderName 该消息的发送者名（无「人名:」前缀时的回落值）
 */
export function scanQuotes(text: string, senderName: string): QuoteMatch[] {
  if (!text) return [];

  /** 已占用的区间，用于去重与去包含（带前缀的扫描优先）。 */
  const taken: Array<[number, number]> = [];
  const matches: QuoteMatch[] = [];

  const overlaps = (start: number, end: number): boolean =>
    taken.some(([s, e]) => start < e && end > s);

  const push = (quoted: string, quoteStart: number, charName: string): void => {
    if (matches.length >= MAX_MATCHES_PER_BLOCK) return;
    if (isBlankQuotedContent(quoted)) return;
    const quoteEnd = quoteStart + quoted.length;
    if (overlaps(quoteStart, quoteEnd)) return;
    taken.push([quoteStart, quoteEnd]);
    matches.push({
      start: quoteStart,
      end: quoteEnd,
      key: `${quoteStart}-${quoteEnd}`,
      text: quoted,
      charName: charName || senderName,
    });
  };

  // 第 1 趟：带「人名:」前缀。正则已锚定行首，故 `m[0]` 必然以引号结尾，
  // 引号起点可直接由「匹配末端 - 引号长度」算出（比对 m[0] 做 indexOf 更稳）。
  PREFIXED_QUOTE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PREFIXED_QUOTE_RE.exec(text)) !== null) {
    const inlineName = (match[1] ?? "").trim().slice(0, MAX_INLINE_NAME_LENGTH);
    const quoted = match[2];
    if (!quoted) continue;
    push(quoted, match.index + match[0].length - quoted.length, inlineName);
  }

  // 第 2 趟：无前缀的引号，落回 senderName。被第 1 趟占用的区间会被跳过。
  PLAIN_QUOTE_RE.lastIndex = 0;
  while ((match = PLAIN_QUOTE_RE.exec(text)) !== null) {
    const quoted = match[1];
    if (!quoted) continue;
    push(quoted, match.index, senderName);
  }

  matches.sort((a, b) => a.start - b.start);
  return matches;
}
