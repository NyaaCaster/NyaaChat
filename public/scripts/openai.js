// Shim for SillyTavern's public/scripts/openai.js.
//
// Export shape for extensions that import ST's chat-completion helpers. The
// prompt-manager objects here are inert containers; request construction is not
// delegated to extensions, preserving NyaaChat's prompt layout/trust boundary.

import { warnOnce } from "./_compat-host.js";
import { Prompt, PromptCollection } from "./PromptManager.js";

export { Prompt, PromptCollection };

export class Message {
  constructor(role = "user", content = "", identifier = undefined) {
    if (typeof role === "object" && role !== null) {
      Object.assign(this, role);
    } else {
      this.role = role;
      this.content = content;
      this.identifier = identifier;
    }
  }
}

export class MessageCollection {
  constructor(...messages) {
    this.collection = [];
    this.add(...messages);
  }
  add(...messages) {
    this.collection.push(...messages);
  }
  get(identifier) {
    return this.collection.find((m) => m.identifier === identifier);
  }
  has(identifier) {
    return !!this.get(identifier);
  }
  getChat() {
    return this.collection.map((m) => ({ role: m.role, content: m.content }));
  }
}

export class ChatCompletion {
  constructor(messages = []) {
    this.messages = messages;
  }
}

export const oai_settings = {
  chat_completion_source: "openai",
  openai_model: "",
  prompts: [],
};

export const proxies = [];

export const promptManager = {
  serviceSettings: oai_settings,
  messages: new MessageCollection(),
  tokenUsage: 0,
  error: null,
  preparePrompt: () => [],
  render: () => undefined,
  saveServiceSettings: () => Promise.resolve(),
};

export function setupChatCompletionPromptManager(...args) {
  void args;
  return promptManager;
}

export function setOpenAIMessages(messages = []) {
  promptManager.messages = messages instanceof MessageCollection ? messages : new MessageCollection(...messages);
  return promptManager.messages;
}

export function setOpenAIMessageExamples(...args) {
  void args;
  return [];
}

export function prepareOpenAIMessages({ messages } = {}) {
  if (Array.isArray(messages)) return messages;
  if (promptManager.messages?.getChat) return promptManager.messages.getChat();
  return [];
}

export function getChatCompletionModel() {
  return oai_settings.openai_model || "";
}

export function isImageInliningSupported() {
  return false;
}

export async function sendOpenAIRequest(...args) {
  void args;
  warnOnce("sendOpenAIRequest() is blocked in the NyaaChat compat layer; use TavernHelper.generateRaw for side requests");
  return "";
}

export async function getStreamingReply(...args) {
  void args;
  warnOnce("getStreamingReply() is blocked in the NyaaChat compat layer");
  return "";
}

export function tryParseStreamingError(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message ?? String(error);
}
