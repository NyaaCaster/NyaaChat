// Shim for SillyTavern's public/scripts/extensions/regex/engine.js.

import { ctx } from "../../_compat-host.js";

export const regex_placement = {
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
};

export function getRegexedString(rawString, placement, options = {}) {
  const helper = globalThis.TavernHelper;
  const scripts = helper?.getTavernRegexes?.() ?? [];
  if (!Array.isArray(scripts) || typeof rawString !== "string") return rawString ?? "";
  let output = rawString;
  for (const script of scripts) {
    if (!script || script.disabled || !script.findRegex) continue;
    if (Array.isArray(script.placement) && !script.placement.includes(placement)) continue;
    try {
      const source = String(script.findRegex);
      const match = source.match(/^\/(.*)\/([a-z]*)$/i);
      const regex = match ? new RegExp(match[1], match[2]) : new RegExp(source, "g");
      output = output.replace(regex, script.replaceString ?? "");
    } catch (err) {
      console.warn("[nyaa-shim] regex script failed", err);
    }
  }
  return ctx().substituteParams?.(output, options) ?? output;
}
