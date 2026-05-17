import { ApiMessage } from "./api";
import { injectBypassPrompts } from "./bypassTemplates";
import { AppState, CharacterSettings, Message } from "../types";

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
