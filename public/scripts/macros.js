// Shim for SillyTavern's public/scripts/macros.js.
//
// ST's MacrosParser is a class with STATIC registration methods that extensions
// call to add their own {{key}} macros (JS-Slash-Runner does
// `MacrosParser.registerMacro('userAvatarPath', fn)` at init). It also doubles
// as an instance-based parser in older code paths. We mirror both: the static
// methods forward to the compat macro registry via the host bridge, and the
// instance keeps the lightweight parse() used by a few call sites.

import { ctx } from "./_compat-host.js";

export class MacrosParser {
  constructor(env = {}) {
    this.env = env;
  }
  parse(text, env = {}) {
    return ctx().substituteParamsExtended?.(text, { ...this.env, ...env }) ?? String(text ?? "");
  }

  /** Register a custom {{key}} macro. `value` is a string or a () => string.
   *  ST also accepts a (nonce) => string signature; our engine calls value()
   *  with no args, which covers the common avatar-path/state macros. */
  static registerMacro(key, value, _description = "") {
    const fn = ctx().registerMacro;
    if (typeof fn === "function") fn(key, value);
  }

  static unregisterMacro(key) {
    const fn = ctx().unregisterMacro;
    if (typeof fn === "function") fn(key);
  }
}

export function getLastMessageId() {
  return Math.max(0, (ctx().chat?.length ?? 0) - 1);
}
