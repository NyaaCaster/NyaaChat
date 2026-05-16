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

  const history: ApiMessage[] = baseMessages
    .filter((m) => m.role !== "system")
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
