/**
 * 消息装饰入口（SSOT §2.6）。
 *
 * ⚠️ 本文件由 **captain 自办**（用户 2026-09-15 明确要求：装饰区间相关实现不派发
 * 子代理，由 captain 亲自做以便实时核对）。
 *
 * ## 实现路径：B「逐块复用既有引号渲染路径」
 *
 * 用户 2026-09-15 复核时把 §2.6 由 A（自研 rehype 全局管线）改为 B。这不是省事，
 * 而是把两个最高风险**从"要靠纪律守住"变成"结构上不可能发生"**：
 *
 *  · **R1 消失**：不再往 `rehypePlugins` 里插东西，也就不存在"必须排在
 *    `rehypeSanitize` 之后、写反了在无危险标签的消息上看不出异常、却在含原始
 *    HTML 的消息上整段丢装饰"这个静默失效。
 *  · **R2 消失**：区间是**当前块文本**内的偏移（A 方案要求"整条消息的渲染后
 *    纯文本"，markdown 折叠会让偏移换算出错）。传进来的 `text` 就是要切分的那段
 *    字符串，空间定义天然一致。
 *  · sanitize 不参与：装饰产物是 React 节点，不是 HTML 字符串，不存在
 *    "绕过 sanitize 渲染不可信 HTML"（§7.6）；也**不使用**
 *    `dangerouslySetInnerHTML`。
 *
 * 复用点：`src/components/MessageItem.tsx` 的 `renderTextWithQuotes()`
 * （L142，既有逐块引号渲染扩展点）改为调用本模块；接线块组件见
 * `DECORATED_BLOCK_COMPONENTS` 注释。
 *
 * ## 契约语义：**装饰 = 在片段旁边加东西，不是替换片段**（2026-09-15 修复后明确）
 *
 * 被标注的那段原文**始终原样输出**，`render` 的返回值**追加在它之后**。因此
 * `render: ({ text }) => <QuoteTtsButton text={text} …/>` 渲染成 `原文` + `🔊`，
 * 而不是只剩 `🔊`。
 *
 * 这与 ST 原版一致（`.ref/st-Quote-TTS/index.js` L107 是
 * `` `${match}<span class="quote-tts-btn">🔊</span>` `` —— 追加）。⚠️ 本模块初版实现
 * 只 push `render` 的返回值、丢掉了原文，导致引号文字从消息里消失（`verify` 在 t7
 * 以 `猫娘: 「第一条引用」` → `猫娘: 🔊` 复现）；`render` 抛错时也**不得**用 `slice`
 * 顶替，否则会与始终输出的正文重复。
 *
 * ## 覆盖边界（必须诚实记录，不得声称全覆盖）
 *
 * `renderTextWithQuotes` 只转换 **string 类型**的 children，React 元素原样透传
 * （MessageItem L145 `: c`）。因此 `<strong>“引用”</strong>` 这类**嵌套内联元素
 * 内部**的引号不会被装饰。⚠️ 这**是既有 `quote-highlight` 就已存在的行为**，
 * 不是本阶段引入的缺陷；已写入 SSOT §2.6 与插件框架规范。
 */
import * as React from "react";
import type { Message } from "../types";
import type { MessageTextDecorator, TextDecoration } from "./types";
import { getRegisteredPlugins } from "./registry";
import { getPluginConfig, getPluginRuntimeSnapshot } from "./runtime";
import { callPluginBackend } from "./backend";

/** 渲染一次板块装饰所需的上下文（由 MessageItem 在渲染期提供）。 */
export interface DecorationRenderInput {
  /** 消息 id；用于 `TextDecoration.key` 的命名空间与调试日志。 */
  messageId: string;
  role: Message["role"];
  /** user → 当前用户角色名；assistant → 当前角色名（与宏语义同源）。 */
  senderName: string;
}

/** 已收集的装饰（附带来源插件 id，用于 key 与日志）。 */
interface CollectedDecoration extends TextDecoration {
  pluginId: string;
}

/** 启用中且声明了 `decorators.messageText` 的插件。 */
function enabledMessageDecorators(): Array<{
  pluginId: string;
  decorators: MessageTextDecorator[];
}> {
  const snapshot = getPluginRuntimeSnapshot();
  const owners: Array<{ pluginId: string; decorators: MessageTextDecorator[] }> = [];

  for (const plugin of getRegisteredPlugins()) {
    const pluginId = plugin?.meta?.id;
    if (!pluginId) continue;
    // 只有**已启用**的插件参与装饰（SSOT §2.4 的启用语义）。
    if (snapshot[pluginId]?.enabled !== true) continue;

    const declared = plugin.decorators?.messageText;
    if (!Array.isArray(declared)) continue;
    const decorators = declared.filter(
      (fn): fn is MessageTextDecorator => typeof fn === "function",
    );
    if (decorators.length === 0) continue;

    owners.push({ pluginId, decorators });
  }

  return owners;
}

function isValidDecoration(value: unknown, textLength: number): value is TextDecoration {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TextDecoration>;
  const { start, end } = candidate;
  if (typeof start !== "number" || typeof end !== "number") return false;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  if (start < 0 || end > textLength || start >= end) return false;
  return typeof candidate.render === "function";
}

/**
 * 对一个文本块应用全部已启用插件的装饰。
 *
 * 零开销路径：文本为空 / 无启用插件声明装饰器 / 全部无命中 ⇒ **原样返回入参**
 * （返回同一个字符串，调用方可以据此跳过任何额外处理）。
 */
export function renderPluginDecorations(
  text: string,
  input: DecorationRenderInput,
): React.ReactNode {
  if (!text) return text;

  const owners = enabledMessageDecorators();
  if (owners.length === 0) return text;

  const collected: CollectedDecoration[] = [];

  for (const owner of owners) {
    const config = getPluginConfig(owner.pluginId);
    const context = {
      pluginId: owner.pluginId,
      config,
      messageId: input.messageId,
      role: input.role,
      senderName: input.senderName,
      callBackend: <T = unknown,>(capability: string, payload?: unknown): Promise<T> =>
        callPluginBackend<T>(owner.pluginId, capability, payload),
    };

    for (const decorate of owner.decorators) {
      let produced: unknown;
      try {
        produced = decorate(text, context);
      } catch (err) {
        // 一个装饰器抛错不能拖垮整条消息 —— 只丢这个插件的这一次装饰。
        console.warn(
          `[plugins] 插件 "${owner.pluginId}" 的 messageText 装饰器抛错，已跳过`,
          err,
        );
        continue;
      }
      if (!Array.isArray(produced)) continue;

      for (const candidate of produced) {
        if (!isValidDecoration(candidate, text.length)) {
          console.warn(
            `[plugins] 插件 "${owner.pluginId}" 返回了非法装饰区间，已丢弃`,
            candidate,
          );
          continue;
        }
        collected.push({ ...candidate, pluginId: owner.pluginId });
      }
    }
  }

  if (collected.length === 0) return text;

  // 先到者胜：按 start 升序（同 start 取 end 小的，即更短的那个），随后贪心去重叠。
  collected.sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted: CollectedDecoration[] = [];
  let cursor = 0;
  for (const decoration of collected) {
    if (decoration.start < cursor) {
      console.warn(
        `[plugins] 装饰区间 [${decoration.start}, ${decoration.end}) 与已接受区间重叠，已丢弃（插件 "${decoration.pluginId}"）`,
      );
      continue;
    }
    accepted.push(decoration);
    cursor = decoration.end;
  }

  if (accepted.length === 0) return text;

  const nodes: React.ReactNode[] = [];
  let last = 0;

  accepted.forEach((decoration, index) => {
    if (decoration.start > last) nodes.push(text.slice(last, decoration.start));

    const slice = text.slice(decoration.start, decoration.end);
    let rendered: React.ReactNode = null;
    try {
      rendered = decoration.render({ text: slice });
    } catch (err) {
      // 降级：只保留正文（正文无论如何都会输出，见下），丢掉这个装饰节点。
      // ⚠️ 这里**不能**把 rendered 设成 slice —— 正文已在下面单独输出，那样会重复。
      console.warn(
        `[plugins] 插件 "${decoration.pluginId}" 的装饰 render 抛错，该片段仅保留正文`,
        err,
      );
      rendered = null;
    }

    // ⚠️ **正文必须作为「顶层字符串节点」输出，不能塞进下面的 Fragment 里。**
    // 宿主 `MessageItem.decorateAndHighlight` 只对 **string 型** children 做引号高亮
    // （`.quote-highlight`）；一旦把 `slice` 放进 Fragment，被装饰的引号就会**失去
    // 原有的高亮**（`verify` 在 t7 的 R2 报的就是这个：文本与按钮都在，但
    // `.quote-highlight` 计数为 0）。拆成两个同级节点即可两全：
    //   顶层 string（slice）→ 交给宿主高亮；
    //   带 key 的 Fragment → 只承载插件返回的装饰节点。
    nodes.push(slice);
    nodes.push(
      React.createElement(
        React.Fragment,
        // key 需要在该块内唯一；装饰器给的 key 已按块内偏移生成，仍拼上插件 id
        // 以防止两个插件在同一起点各产出一个装饰时撞 key。
        { key: `${decoration.pluginId}::${decoration.key || index}` },
        rendered,
      ),
    );
    last = decoration.end;
  });

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
