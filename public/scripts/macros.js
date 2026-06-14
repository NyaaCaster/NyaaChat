// Shim for SillyTavern's public/scripts/macros.js.

import { ctx } from "./_compat-host.js";

export class MacrosParser {
  constructor(env = {}) {
    this.env = env;
  }
  parse(text, env = {}) {
    return ctx().substituteParamsExtended?.(text, { ...this.env, ...env }) ?? String(text ?? "");
  }
}

export function getLastMessageId() {
  return Math.max(0, (ctx().chat?.length ?? 0) - 1);
}
