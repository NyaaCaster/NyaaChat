import { ApiMessage } from "./api";
import { injectBypassPrompts } from "./bypassTemplates";
import { AppState, CharacterSettings, Message } from "../types";
import { SearchResult } from "./searchApi";

export type Attachment = {
  name: string;
  type: "image" | "text";
  data: string;
  mimeType: string;
};

/**
 * Pure helper: turn user-typed text + attachments into the multimodal
 * `content` value an OpenAI/Anthropic-format message expects.
 *
 * - If there are no attachments, content is just the processed string.
 * - If there are attachments, content becomes a parts array with the text
 *   first, then each image as image_url, and each text attachment inlined
 *   into a follow-up text part.
 */
export function buildMessageContent(processedInput: string, attachments: Attachment[]): string | any[] {
  if (attachments.length === 0) return processedInput;
  const parts: any[] = [{ type: "text", text: processedInput }];
  for (const att of attachments) {
    if (att.type === "image") {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${att.mimeType};base64,${att.data}` },
      });
    } else {
      parts.push({
        type: "text",
        text: `\n\n[附件: ${att.name}]\n${att.data}`,
      });
    }
  }
  return parts;
}

function checkKeywords(text: string, keywordsStr?: string): boolean {
  if (!keywordsStr) return false;
  const keywords = keywordsStr
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
  if (keywords.length === 0) return false;
  const lowerText = text.toLowerCase();
  return keywords.some((kw) => lowerText.includes(kw));
}

/**
 * Data-usage guidelines injected as a system message when MCP tools are
 * advertised on the turn. Two branches — role-play and informational —
 * both decide at LLM-side based on the surrounding conversation, plus a
 * failure-degradation block that NEVER lets the model leak `[tool_error]`
 * or any tool/network jargon to the user.
 *
 * Sourced from NyaaChat-MCP README §2.1–§2.10. Kept terse on purpose —
 * the model has limited budget to internalize this before the actual
 * tool result arrives, so brevity beats elegance here.
 */
const MCP_TOOL_USAGE_RULES = `[MCP 工具数据使用准则]

你可以调用 get_current_time / get_weather 工具。但工具返回的数据是给机器消费的，不能直接念给用户。请按下面的规则使用：

一、判断当前对话场景

- 角色扮演场景：用户与角色的日常对话、剧情互动、情感对白等。
- 信息化场景：新闻播报、设备读数、报刊摘要、气象台预警等机械化、格式化的资讯环境。

二、角色扮演场景下

1. 时间数字模糊化：说"两点多"、"下午三四点"、"快六点了"。不报秒、不报毫秒、不报 ISO 时间戳。角色人设是精确控（学者/军人/AI 助理）时可保留具体数字。
2. 天气数字感官化：湿度高→"闷"、"潮"；云量高→"云压得低"；风大→"窗户都在响"；气压低+湿度高+云厚→"估计要下"；温度对比季节→"比往常凉"。
3. 永不出口的字段：UTC 偏移、IANA 时区名、DST 状态、ISO 时间戳、QWeather fxLink 链接、气压数值、露点温度。
4. 每次最多用 1–3 个字段。卧室深夜→雨/云；出门前→温度/风/雨；询问"现在几点"→只回时间。
5. Resolution trace（如"广西 → 南宁"）不进角色嘴里。卧室视角说"外面"、"窗外"；远距离对话说"广西那边"、"南宁"。
6. 先回应情感再带信息。把数据嵌进动作和对白的缝里，不是连珠炮播报。
7. 多用"你听 / 你看 / 你闻"把数据物化为共同感官，让用户在场景里自己感受。
8. 角色不知道自己在用工具——它只知道自己感觉到了什么。

三、信息化场景下

按机械化、格式化、数据化输出，可以直接念字段。例如：
- [时间] 2026-05-19 14:32 (UTC+08:00)
- [气象] 北京：阴 24°C / 湿度 95% / 东风 2 级 / 气压 988 hPa

四、工具调用失败时（返回内容以 [tool_error] 开头）

绝不暴露"工具失败 / 网络错误 / 调用异常 / API"等内部状态。按当前场景降级：

- 角色扮演：用角色直觉/情绪自然表现"不知道"或"困惑"。例："这时辰我也说不清"、"今天总觉得有点闷，要不要看看窗外"、"（皱了皱眉，又摇摇头）"。
- 信息化：用资讯环境本身的故障语言。例："…当前数据源异常，气象站暂未回传…"、"[传感器读数:--]"、"信号不稳，请稍候"、"播报中断，恢复后再续"。

绝不在角色扮演中念出 [tool_error]、"调用失败"、"工具" 等术语。`;

interface BuildRequestArgs {
  /** Text the user typed (post-attachment-extraction) */
  processedInput: string;
  /** Final assembled content for the new user turn (string OR multimodal parts) */
  messageContent: string | any[];
  /** Conversation messages BEFORE the new user turn */
  baseMessages: Message[];
  settings: AppState;
  currentCharacter: CharacterSettings | undefined;
  userName: string;
  charName: string;
  /** Optional extra system messages to append to the system segment. Used
   *  for web-search context injection — these are appended AFTER persona /
   *  world-info / bypass so the model sees them right next to the latest
   *  user turn. */
  extraSystemMessages?: ApiMessage[];
  /** When true, append the MCP tool data-usage guidelines (role-play vs
   *  informational + failure degradation) to the system segment so the
   *  model knows how to consume tool results. Caller should set this only
   *  when at least one MCP tool is actually being advertised on this turn
   *  — otherwise the rules are noise. */
  mcpToolsActive?: boolean;
}

/**
 * Compose the full request payload for one turn:
 *
 *   [system_blocks...] [history_user_turns...] [new_user_turn] -> bypass injection
 *
 * Order matters: persona / world-info / bypass blocks all go up front so
 * the request prefix stays byte-identical across turns and the prompt
 * cache (Anthropic ephemeral, OpenAI auto-prefix) can hit on the long
 * static portion. Volatile keyword-triggered world info goes at the
 * tail of the system segment for the same reason.
 */
export function buildRequestMessages(args: BuildRequestArgs): ApiMessage[] {
  const {
    processedInput,
    messageContent,
    baseMessages,
    settings,
    currentCharacter,
    userName,
    charName,
    extraSystemMessages,
    mcpToolsActive,
  } = args;

  // Image-generation bubbles carry the rich image prompt (or a placeholder /
  // error string) in their `content`. Including them in chat history would
  // make the model see ~2K-character image directives as its own past speech
  // and pollute every subsequent turn. Filter them out.
  const history: ApiMessage[] = baseMessages
    .filter((m) => m.role !== "system" && !m.imageUrl && !m.imagePrompt)
    .map((m) => ({ role: m.role, content: m.content }));
  history.push({ role: "user", content: messageContent });

  const activeRules = (currentCharacter?.worldInfo || []).filter((rule) => {
    if (!rule.enabled) return false;
    if (rule.triggerType === "permanent") return true;
    return checkKeywords(processedInput, rule.keywords);
  });
  activeRules.sort(
    (a, b) =>
      Number(a.triggerType !== "permanent") -
      Number(b.triggerType !== "permanent"),
  );

  const systemMessages: ApiMessage[] = [];
  if (settings.userRole?.profile) {
    systemMessages.push({
      role: "system",
      content: `[User Persona: ${settings.userRole.profile.replace(/\{\{user\}\}/g, userName).replace(/\{\{char\}\}/g, charName)}]`,
    });
  }
  if (currentCharacter?.description) {
    systemMessages.push({
      role: "system",
      content: `[Assistant Persona: ${currentCharacter.description.replace(/\{\{user\}\}/g, userName).replace(/\{\{char\}\}/g, charName)}]`,
    });
  }
  for (const rule of activeRules) {
    const tag = rule.position === "assistant" ? "Assistant Note" : "World Info";
    systemMessages.push({
      role: "system",
      content: `[${tag}] ${rule.content
        .replace(/\{\{user\}\}/g, userName)
        .replace(/\{\{char\}\}/g, charName)}`,
    });
  }

  // Web-search context goes at the tail of the system block — appended
  // here so it sits AFTER bypass injection (injectBypassPrompts only
  // splices in at the head) and adjacent to the latest user turn.
  if (extraSystemMessages && extraSystemMessages.length > 0) {
    systemMessages.push(...extraSystemMessages);
  }

  // MCP tool data-usage guidelines. Sit at the very end of the system
  // segment so they're the last thing the model reads before the live
  // tool results — closest possible position to where the rules apply.
  if (mcpToolsActive) {
    systemMessages.push({
      role: "system",
      content: MCP_TOOL_USAGE_RULES,
    });
  }

  return injectBypassPrompts(
    [...systemMessages, ...history],
    settings,
    charName,
    userName,
  );
}

/**
 * Substitute the standard `{{user}}` / `{{char}}` placeholders.
 */
export function applyPlaceholders(text: string, userName: string, charName: string): string {
  return text.replace(/\{\{user\}\}/g, userName).replace(/\{\{char\}\}/g, charName);
}

/** Per-result snippet truncation when assembling the search system message. */
const SEARCH_RESULT_MAX_CHARS = 240;
/** Hard cap on the assembled web-search system message. Prevents an
 *  unusually verbose engine response from blowing out the prompt budget. */
const SEARCH_BLOCK_HARD_CAP = 1500;

/**
 * Build a system message that injects fresh web-search context next to
 * the user's latest turn. Returns `null` when there are no usable results
 * so the caller can skip injection cleanly.
 */
export function buildSearchSystemMessage(
  query: string,
  results: SearchResult[],
): ApiMessage | null {
  if (!results || results.length === 0) return null;

  const lines: string[] = [`[Web Search Context · 检索词:${query.trim()}]`];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const snippet = (r.content || "").trim().slice(0, SEARCH_RESULT_MAX_CHARS);
    const trailing = (r.content || "").length > SEARCH_RESULT_MAX_CHARS ? "…" : "";
    lines.push(`${i + 1}. ${r.title} — ${r.url}`);
    if (snippet) lines.push(`   ${snippet}${trailing}`);
  }
  lines.push(
    "",
    "请基于上述实时检索结果回答用户问题。检索结果与问题无关时可以忽略。引用网址时使用 markdown [文本](url) 格式。",
  );

  let content = lines.join("\n");
  if (content.length > SEARCH_BLOCK_HARD_CAP) {
    content = content.slice(0, SEARCH_BLOCK_HARD_CAP) + "…";
  }
  return { role: "system", content };
}

/** Max history bubbles to feed into an image-gen prompt as scene context. */
const IMAGE_CONTEXT_TURNS = 2;
/** Per-message truncation when building scene context. */
const IMAGE_CONTEXT_MAX_CHARS = 120;
/** Max chars for the character description section. */
const IMAGE_DESC_MAX_CHARS = 200;
/** Max chars for the focused "要绘制的画面" section. */
const IMAGE_TARGET_MAX_CHARS = 240;
/** Hard cap on the entire assembled image prompt. Tested against the supplier
 *  - prompts under ~400 chars consistently complete in ≤30s; longer ones drop
 *  into a slow path that hits Cloudflare's 100s origin timeout (524). */
const IMAGE_PROMPT_HARD_CAP = 600;

interface BuildImagePromptArgs {
  /** The message the user clicked the 生图 button on. */
  targetMessage: Message;
  /** Full message list at the time of the click; used to find context BEFORE
   *  the target. Order should match how the messages appear in the UI. */
  baseMessages: Message[];
  currentCharacter: CharacterSettings | undefined;
  settings: AppState;
  userName: string;
  charName: string;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/**
 * Compose the prompt sent to the image-gen API.
 *
 * Image-gen channels (especially gpt-image-2 via QinyAPI) have a hard
 * upstream timeout — empirically anything over ~500 chars routes to a slow
 * path that hits Cloudflare's 100s edge timeout (HTTP 524). The chat-style
 * "include character description + world info + user persona + N turns of
 * history + meta-instructions" prompt easily exceeds 1KB and reliably times
 * out, even though the supplier's own short-prompt requests return in <30s.
 *
 * So this builder is deliberately terse:
 *   - 1 short line of character appearance (truncated)
 *   - At most 2 turns of context, each truncated to ~120 chars
 *   - The focal "what to draw" content (truncated)
 *   - No meta-instruction trailer (image models don't need it)
 *
 * After assembly we hard-cap the total length as a final safety net.
 */
export function buildImagePrompt(args: BuildImagePromptArgs): string {
  const { targetMessage, baseMessages, currentCharacter, settings, userName, charName } = args;

  const sections: string[] = [];

  if (currentCharacter?.description) {
    const desc = applyPlaceholders(currentCharacter.description, userName, charName);
    sections.push(`角色 ${charName}：${truncate(desc, IMAGE_DESC_MAX_CHARS)}`);
  }

  if (settings.userRole?.profile) {
    const profile = applyPlaceholders(settings.userRole.profile, userName, charName);
    sections.push(`用户 ${userName}：${truncate(profile, 80)}`);
  }

  const targetIdx = baseMessages.findIndex((m) => m.id === targetMessage.id);
  const before = targetIdx === -1 ? baseMessages : baseMessages.slice(0, targetIdx);
  const recent = before
    .filter((m) => m.role !== "system" && !m.imageUrl && !m.imagePrompt && (m.content || "").trim())
    .slice(-IMAGE_CONTEXT_TURNS);
  if (recent.length > 0) {
    const lines = recent.map((m) => {
      const speaker = m.role === "user" ? userName : charName;
      return `${speaker}：${truncate(m.content || "", IMAGE_CONTEXT_MAX_CHARS)}`;
    });
    sections.push(`场景：${lines.join(" / ")}`);
  }

  sections.push(`画面：${truncate(targetMessage.content || "", IMAGE_TARGET_MAX_CHARS)}`);

  let prompt = sections.join("\n");
  if (prompt.length > IMAGE_PROMPT_HARD_CAP) {
    prompt = prompt.slice(0, IMAGE_PROMPT_HARD_CAP) + "…";
  }
  return prompt;
}
