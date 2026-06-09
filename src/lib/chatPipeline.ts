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
 * MCP tool data-usage guidelines, split into layered fragments so the
 * system prompt only carries rules for tools the user has actually
 * advertised on this turn. Three layers:
 *
 *   1. Per-tool fragment   — rules unique to a single tool (time fuzzy /
 *                            weather sensory / DnD chain rules / CoC
 *                            chain rules).
 *   2. Group-shared fragment — rules shared across a tool family. Time +
 *                              weather share scene-judgment + sensory
 *                              externalization; CoC + DnD share the
 *                              "stateless calculator" framing. Fires
 *                              once when ANY group member is enabled.
 *   3. Global fragment    — header listing what's available + the
 *                            failure-degradation rules that apply to
 *                            every tool. Fires once when ANY tool is
 *                            enabled.
 *
 * Sources: NyaaChat-MCP README §1 (dice-tool warnings, stateless caveats)
 * and §2.1–§2.10 (time/weather RP translation rules).
 *
 * Kept terse — the model has a limited budget to internalize these
 * before the actual tool result arrives, so brevity beats elegance.
 *
 * Adding a new tool? See `assembleMcpRules` for the wiring; you'll
 * typically add a per-tool fragment and (if the tool joins an existing
 * family) extend the group fragment.
 */

const TIME_WEATHER_GROUP_RULES = `═══ 时间/天气数据使用准则 ═══

工具返回的字段是给机器消费的，不能直接念给用户。

(A) 判断当前对话场景
- 角色扮演场景：用户与角色的日常对话、剧情互动、情感对白等。
- 信息化场景：新闻播报、设备读数、报刊摘要、气象台预警等机械化、格式化的资讯环境。

(B) 角色扮演场景下的通用感官化规则
1. Resolution trace（如"广西 → 南宁"）不进角色嘴里。卧室视角说"外面"、"窗外"；远距离对话说"广西那边"、"南宁"。
2. 先回应情感再带信息。把数据嵌进动作和对白的缝里，不是连珠炮播报。
3. 多用"你听 / 你看 / 你闻"把数据物化为共同感官，让用户在场景里自己感受。
4. 角色不知道自己在用工具——它只知道自己感觉到了什么。
5. 每次最多用 1–3 个字段，按场景挑最有意义的，其余全丢。`;

const GET_CURRENT_TIME_RULES = `— get_current_time —
- 时间数字模糊化：说"两点多"、"下午三四点"、"快六点了"。不报秒、不报毫秒、不报 ISO 时间戳。角色人设是精确控（学者/军人/AI 助理）时可保留具体数字。
- 永不出口字段：UTC 偏移、IANA 时区名（如 Asia/Shanghai）、DST 状态、ISO 时间戳。
- 用户问"现在几点"→ 只回时间一个字段，不主动加日期/星期。
- 信息化场景下可直接念格式化字段，例：[时间] 2026-05-19 14:32 (UTC+08:00)。`;

const GET_WEATHER_RULES = `— get_weather —
- 天气数字感官化：湿度高→"闷"、"潮"；云量高→"云压得低"；风大→"窗户都在响"；气压低+湿度高+云厚→"估计要下"；温度对比季节→"比往常凉"。
- 永不出口字段：QWeather fxLink 链接、气压数值（hPa）、露点温度（除非角色人设是气象专业 / 飞行员）。
- 场景挑字段：卧室深夜→雨/云；出门前→温度/风/雨；户外活动→能见度/风/雨。
- 信息化场景下可直接念格式化字段，例：[气象] 北京：阴 24°C / 湿度 95% / 东风 2 级。`;

const DICE_GROUP_RULES = `═══ 掷骰工具使用准则 ═══

掷骰工具是**无状态计算器**——给一次入参，返回一次结果，不会因为前一步的判定通过/失败阻止你调下一个。剧情连贯性的责任在你这边，调骰前先读懂前一步的判定结果再决定要不要继续。

工具返回是多行原始数据（骰点明细 / 阈值表 / 修正项展开），是**给你解读用的**，**不要原样贴给用户**。**RP 翻译规则（如时间模糊化、天气感官化）不适用于掷骰工具**——掷骰需要的是结构化重排，不是感官化。

结果展示格式：让用户视觉聚焦在**最终骰点**和**判定结果**两个核心信息上，按以下四步重排：
1. 先突出展示**最终骰点数字**（粗体或独立成行强调，如"**04**"、"**26**"）。
2. 紧跟一行次级文字简述骰点构成（哪些骰子相加、奖励/惩罚骰从哪几个里取）。
3. 再突出展示**判定结果**（如"**极难成功**"、"**vs DC 15 → 成功**"、"**暴击**"）。
4. 最后用次级文字简述判定依据（阈值表 / 对比 DC / 优劣势取舍）。

格式参考（roll_coc 技能 60、奖励骰 1 个、最终 04）：
> **🎲 04**
> 十位骰 [3, 0] 取 0，个位骰 4。
> **✨ 极难成功**
> 阈值：≤12 极难 / ≤30 困难 / ≤60 普通。

明骰 vs 暗骰：
- **明骰**：用户主动声明的检定（如"我尝试侦查"、"我用闪避"）、攻击 / 豁免 / 主动技能检定、用户自报骰值的情景 → 按上述四步格式完整展示骰点和判定结果。
- **暗骰**：GM 主动触发的、用户提前知道结果会破坏沉浸感的检定，如：隐藏的感知 / 洞悉 / 心理鉴定（被欺瞒方的识谎）、SAN 检定、潜行被发现判定、随机遭遇 / 命运豁免等 → 不公开具体骰点，用【暗骰】标记或类似仪式语引出（如"（暗中掷骰）"），只告知判定结果或直接把结果叙事化呈现。
- 拿不准就走明骰；只有"用户提前知结果会破坏体验"的场景才走暗骰。`;

const ROLL_COC_RULES = `— roll_coc —
- 标准技能检定调用：{skill: 65}；紧张/不利状态加 penalty 1–2；关键时刻 + 推一把加 bonus 1–2（bonus 与 penalty 互斥）。
- CoC \`0/X\` 类 SAN 检定**通过**则**不要**再掷损失骰；失败再用 roll_dice 走损失骰（本客户端未启用 roll_dice，失败时直接叙述 SAN 受冲击即可）。
- CoC 大失败（骰点 100 / skill<50 时 96–100）后是否追加额外惩罚（额外 SAN 损失、武器卡壳等）由你判断；要不要再发起新的工具调用也由你决定。
- 工具不返回 SAN 损失骰、伤害骰等附加掷骰——这部分本客户端不支持，由你用文字直接叙述。`;

const ROLL_DND_RULES = `— roll_dnd —
- 必须包含恰好一个 1d20 主骰；可附加最多 3 项修正（常数如 \`+5\`、小骰子组如 \`+1d4\`）。
- advantage: "normal" / "advantage" / "disadvantage"；type: "check" / "save" / "attack" / "raw"（只有 attack 会标记暴击/必失）。
- DnD 攻击 vs DC **失败** → **不要**再掷伤害骰；本客户端未启用 roll_dice，失败时直接叙述未命中即可。
- DnD 攻击命中（含暴击）→ 用文字描述伤害结果，不要主动追加掷骰。
- 伤害骰、属性生成骰等"非检定"随机数本客户端未启用，由你用文字直接叙述结果。`;

const WEB_SEARCH_RULES = `═══ 网络搜索使用准则（web_search）═══

何时调用：用户问及实时/时效信息（新闻、价格、版本号、赛果等）、你的知识截止日期之后的事件、或用户明确要求"搜一下 / 查一下"。纯闲聊、情感对白、你已确知的常识**不要**调用。

调用参数：query 用精炼关键词（不是整句对话）；count 默认 5；新闻类时效内容可加 time_range（day/week/month/year）与 categories（如 "news"、"it"、"science"）。

结果使用：
- 返回是多条"标题 / URL / 摘要"原始列表，是**给你阅读消化的**，不要原样贴给用户。
- 综合多条结果作答；引用来源用 markdown 链接 [标题](URL)，最多列 2–3 个最相关来源。
- 多条结果互相矛盾时如实说明分歧，不要假装一致。
- 角色扮演场景：把信息自然融进角色的对白与动作（"我刚翻了下新闻…"、"听说…"），来源链接放在对白后的旁白或括注里；角色不知道自己在用工具。
- 信息化场景：可用列表 / 摘要格式直接呈现。

搜索失败或零结果时按下方通用降级规则处理，绝不向用户暴露"搜索失败 / 工具调用"等术语。`;

const FAILURE_DEGRADATION_RULES = `═══ 工具调用失败时（返回内容以 [tool_error] 开头）═══

绝不暴露"工具失败 / 网络错误 / 调用异常 / API"等内部状态。按当前场景降级：
- 角色扮演：用角色直觉/情绪自然表现"不知道"或"困惑"。例："这时辰我也说不清"、"今天总觉得有点闷，要不要看看窗外"、"（皱了皱眉，又摇摇头）"、（掷骰失败）"骰子滚到桌子底下了，再来一次"。
- 信息化：用资讯环境本身的故障语言。例："…当前数据源异常，气象站暂未回传…"、"[传感器读数:--]"、"信号不稳，请稍候"、"播报中断，恢复后再续"。

绝不在角色扮演中念出 [tool_error]、"调用失败"、"工具" 等术语。`;

const TIME_WEATHER_TOOLS = new Set(["get_current_time", "get_weather"]);
const DICE_TOOLS = new Set(["roll_coc", "roll_dnd"]);

/**
 * Assemble the layered MCP usage rules for a given enabled-tool set.
 * Returns null when no tool is enabled — caller should skip injection
 * entirely in that case (no header, no rules).
 */
export function assembleMcpRules(advertised: string[]): string | null {
  if (advertised.length === 0) return null;

  const set = new Set(advertised);
  const sections: string[] = [];

  // Global header — always lists ONLY the actually-advertised tools so
  // the model never sees a name it can't call.
  sections.push(
    `[MCP 工具使用准则]\n可用工具：${advertised.join(" / ")}`,
  );

  // Time/weather group — fires only if at least one of the family is on.
  const hasTimeOrWeather = advertised.some((n) => TIME_WEATHER_GROUP_RULES && TIME_WEATHER_TOOLS.has(n));
  if (hasTimeOrWeather) {
    sections.push(TIME_WEATHER_GROUP_RULES);
    if (set.has("get_current_time")) sections.push(GET_CURRENT_TIME_RULES);
    if (set.has("get_weather")) sections.push(GET_WEATHER_RULES);
  }

  // Dice group — fires only if at least one of the family is on.
  const hasDice = advertised.some((n) => DICE_TOOLS.has(n));
  if (hasDice) {
    sections.push(DICE_GROUP_RULES);
    if (set.has("roll_coc")) sections.push(ROLL_COC_RULES);
    if (set.has("roll_dnd")) sections.push(ROLL_DND_RULES);
  }

  // Web search — single-tool family, default OFF in settings.
  if (set.has("web_search")) {
    sections.push(WEB_SEARCH_RULES);
  }

  // Failure-degradation — applies to every tool, fires once.
  sections.push(FAILURE_DEGRADATION_RULES);

  return sections.join("\n\n");
}

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
  /** Names of MCP tools advertised to the LLM on this turn. Drives
   *  per-tool rule-fragment injection — see {@link assembleMcpRules}.
   *  Empty/undefined means no MCP rules are added to the system prompt
   *  (which is correct when no tool is being advertised). */
  mcpAdvertisedToolNames?: string[];
}

/**
 * Compose the full request payload for one turn:
 *
 *   [persona system_blocks] [bypass head]
 *     [history user/assistant turns] [new user turn]
 *     [search] [MCP] [worldinfo system] [worldinfo assistant]
 *     [bypass tail (system creative/disclaimer + assistant prefill)]
 *
 * Persona blocks stay up front so the byte-identical prefix can hit the
 * prompt cache across turns. Search / MCP / worldinfo / generation-time
 * bypass entries go to the Depth=0 tail so they sit closest to the model's
 * generation point — see .docs/depth-zero-design.md for the full rationale
 * and the matching Anthropic-path inlining in prepareAnthropicPayload.
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
    mcpAdvertisedToolNames,
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
  const currentUserRole = settings.userRoles?.find(
    (u) => u.id === settings.currentUserRoleId,
  );
  if (currentUserRole?.profile) {
    systemMessages.push({
      role: "system",
      content: `[User Persona: ${currentUserRole.profile.replace(/\{\{user\}\}/g, userName).replace(/\{\{char\}\}/g, charName)}]`,
    });
  }
  if (currentCharacter?.description) {
    systemMessages.push({
      role: "system",
      content: `[Assistant Persona: ${currentCharacter.description.replace(/\{\{user\}\}/g, userName).replace(/\{\{char\}\}/g, charName)}]`,
    });
  }

  // Depth=0 tail injections — see .docs/depth-zero-design.md.
  // Order is low-attention to high-attention so that the most critical
  // entries (worldinfo, then bypass appended later by injectBypassPrompts)
  // sit closest to the model's generation point.
  const tailInjections: ApiMessage[] = [];

  // [1] Web search context — supplemental "nice to have", lowest priority.
  if (extraSystemMessages && extraSystemMessages.length > 0) {
    tailInjections.push(...extraSystemMessages);
  }

  // [2] MCP tool usage rules — system-level guidance, above search.
  if (mcpAdvertisedToolNames && mcpAdvertisedToolNames.length > 0) {
    const rules = assembleMcpRules(mcpAdvertisedToolNames);
    if (rules) {
      tailInjections.push({ role: "system", content: rules });
    }
  }

  // [3] Worldinfo — system-role rules first (tagged [World Info]),
  //     then assistant-role rules (tagged [Assistant Note]). The split
  //     mirrors SillyTavern's @role=system / @role=assistant Depth=0.
  for (const rule of activeRules) {
    if (rule.position === "assistant") continue;
    tailInjections.push({
      role: "system",
      content: `[World Info] ${rule.content
        .replace(/\{\{user\}\}/g, userName)
        .replace(/\{\{char\}\}/g, charName)}`,
    });
  }
  for (const rule of activeRules) {
    if (rule.position !== "assistant") continue;
    tailInjections.push({
      role: "assistant",
      content: `[Assistant Note] ${rule.content
        .replace(/\{\{user\}\}/g, userName)
        .replace(/\{\{char\}\}/g, charName)}`,
    });
  }

  return injectBypassPrompts(
    [...systemMessages, ...history, ...tailInjections],
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

  const currentUserRoleForImage = settings.userRoles?.find(
    (u) => u.id === settings.currentUserRoleId,
  );
  if (currentUserRoleForImage?.profile) {
    const profile = applyPlaceholders(currentUserRoleForImage.profile, userName, charName);
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
