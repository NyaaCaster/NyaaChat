// TavernHelper.generate / generateRaw — real LLM calls for front-end cards.
//
// Cards sometimes need to call the model themselves (e.g. "summarize the scene",
// "roll a description"). ST exposes two entry points:
//   - generate(config):    assemble from chat history + user_input + injects
//   - generateRaw(config):  send a fully card-authored message sequence
//                           (ordered_prompts), bypassing card/preset assembly
//
// DESIGN (audited against llm-chat-prompt-architecture-standard.md):
//   - These are SIDE REQUESTS, not the main chat turn. Per the chosen design
//     they do NOT write back into the conversation — the card receives the
//     string and decides what to do with it. So none of this touches the
//     durable chat history or the four-part main-turn layout.
//   - generate() uses LIGHT assembly: current history (from runtimeStore) +
//     optional injects + user_input. It deliberately does NOT pull in
//     NyaaChat's persona / world info / bypass / <session_rules> tail — those
//     belong to the main turn pipeline (buildRequestMessages). Keeping the side
//     request clean avoids leaking per-turn dynamic injections into a card's
//     private call and sidesteps the trust-boundary / cache concerns entirely.
//   - generateRaw() is a pure passthrough of card-authored ordered_prompts.
//     The card owns that layout; NyaaChat injects nothing.
//   - Provider formatting (openai/anthropic) and any cache-control live inside
//     fetchChatCompletion, so we inherit correct provider adaptation for free.
//
// The compat layer can't see React state, so the host injects a resolver that
// yields the active ApiSettings (provider + model + key). Until one is
// registered, generate throws a clear error rather than silently no-op'ing.

import type { ApiMessage } from "../lib/api";
import type { ApiSettings } from "../types";
import { fetchChatCompletion } from "../lib/api";
import { getChat } from "./runtimeStore";

/** Card-authored role/content prompt (generateRaw ordered_prompts entries). */
export interface RolePrompt {
  role: "system" | "assistant" | "user";
  content: string;
}

export interface GenerateConfig {
  user_input?: string;
  /** Extra prompts injected after history, before user_input. */
  injects?: RolePrompt[];
  /** 'all' (default) or a number capping how many trailing history msgs to include. */
  max_chat_history?: "all" | number;
  should_stream?: boolean;
}

export interface GenerateRawConfig {
  /** Fully card-authored message sequence. Sent verbatim. */
  ordered_prompts?: RolePrompt[];
  user_input?: string;
  should_stream?: boolean;
}

type ApiSettingsResolver = () => ApiSettings | null;

let resolveApiSettings: ApiSettingsResolver | null = null;

/** Host registers how to get the active provider's ApiSettings. */
export function setGenerateApiResolver(fn: ApiSettingsResolver | null): void {
  resolveApiSettings = fn;
}

function requireSettings(): ApiSettings {
  const s = resolveApiSettings?.() ?? null;
  if (!s || !s.baseUrl || !s.model) {
    throw new Error(
      "[compat] TavernHelper.generate: no active LLM provider/model configured",
    );
  }
  return s;
}

/** Map runtimeStore chat into ApiMessages, dropping system rows (those are
 *  NyaaChat's own injected markers, not real dialogue the card should resend).
 *  Honours max_chat_history by keeping the trailing N. */
function historyToMessages(maxHistory: "all" | number): ApiMessage[] {
  const chat = getChat().filter((m) => m.role !== "system");
  const sliced =
    maxHistory === "all" || maxHistory >= chat.length
      ? chat
      : chat.slice(chat.length - Math.max(0, maxHistory));
  return sliced.map((m) => ({ role: m.role, content: m.content }));
}

/** Run a completion over the given messages and return the full text. The
 *  side-request path is non-streaming from the card's perspective — we collect
 *  chunks and resolve once with the concatenated result. */
async function runCompletion(messages: ApiMessage[], settings: ApiSettings): Promise<string> {
  if (messages.length === 0) return "";
  let text = "";
  // Force non-streaming for the side request: the card awaits a single string.
  const sideSettings: ApiSettings = { ...settings, isStreaming: false };
  await fetchChatCompletion(messages, sideSettings, (chunk) => {
    text += chunk;
  });
  return text;
}

/** TavernHelper.generate — light assembly (history + injects + user_input). */
export async function generate(config: GenerateConfig = {}): Promise<string> {
  const settings = requireSettings();
  const messages = historyToMessages(config.max_chat_history ?? "all");

  for (const inj of config.injects ?? []) {
    if (inj && inj.content) messages.push({ role: inj.role, content: inj.content });
  }
  if (config.user_input) {
    messages.push({ role: "user", content: config.user_input });
  }
  return runCompletion(messages, settings);
}

/** TavernHelper.generateRaw — passthrough of card-authored ordered_prompts. */
export async function generateRaw(config: GenerateRawConfig = {}): Promise<string> {
  const settings = requireSettings();
  const messages: ApiMessage[] = [];
  for (const p of config.ordered_prompts ?? []) {
    if (p && p.content) messages.push({ role: p.role, content: p.content });
  }
  if (config.user_input) {
    messages.push({ role: "user", content: config.user_input });
  }
  return runCompletion(messages, settings);
}
