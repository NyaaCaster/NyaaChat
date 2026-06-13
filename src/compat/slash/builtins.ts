// Built-in slash commands — the subset that maps onto NyaaChat's own state.
//
// These are the commands cards/extensions reach for most: toasts (/echo), pipe
// plumbing (/pass, /delay, /comment, /abort), the variable family (chat +
// global, backed by variables.ts), and message insertion (/send, /sys via the
// runtimeStore write-back channel). Generation-bound commands (/trigger, /gen)
// route to the host when one is registered, otherwise warn and degrade.
//
// Scope notes vs. ST:
//   - /setvar etc. operate on NyaaChat's chat scope (per-session) and /set
//     globalvar on the persisted global scope — ST's chat_metadata.variables /
//     extension_settings.variables.global respectively.
//   - Argument-type coercion (as=, index=) is not modelled; values are strings,
//     with numeric coercion only where the command is inherently numeric.

import { toastr, type ToastLevel } from "../globals";
import { getChat, commandInsertMessage } from "../runtimeStore";
import { getVariables, insertOrAssignVariables, deleteVariable, updateVariablesWith } from "../variables";
import { addCommandObject, SlashAbort, getSlashHost, type SlashCallback } from "./engine";
import type { VariableOption } from "../variables";

const warned = new Set<string>();
function warnOnce(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[compat] slash /${name}: no host registered — command is a no-op`);
}

/** ST's getvar coercion: numeric strings come back as numbers, else as-is. */
function coerceNumberish(v: unknown): string | number {
  if (typeof v === "number") return v;
  const s = v == null ? "" : String(v);
  if (s.trim() === "" || isNaN(Number(s))) return s;
  return Number(s);
}

// --- variable command factories (chat + global share the shape) -------------

function makeSetVar(scope: VariableOption): SlashCallback {
  return (args, value) => {
    const key = args.key || args.name;
    if (!key) throw new Error("missing required argument 'key'");
    insertOrAssignVariables({ [key]: value }, scope);
    return value;
  };
}

function makeGetVar(scope: VariableOption): SlashCallback {
  return (args, value) => {
    const key = args.key || value;
    if (!key) return "";
    return coerceNumberish(getVariables(scope)[key]);
  };
}

/** Numeric add (incvar/decvar use delta=±1 with the name as the unnamed arg;
 *  addvar uses key= and a numeric value). Returns the new value. */
function bumpVar(scope: VariableOption, key: string, delta: number): number {
  let result = 0;
  updateVariablesWith((v) => {
    const cur = Number(v[key]);
    result = (isNaN(cur) ? 0 : cur) + delta;
    v[key] = result;
    return v;
  }, scope);
  return result;
}

function makeAddVar(scope: VariableOption): SlashCallback {
  return (args, value) => {
    const key = args.key || args.name;
    if (!key) throw new Error("missing required argument 'key'");
    const inc = Number(value);
    return bumpVar(scope, key, isNaN(inc) ? 0 : inc);
  };
}

function makeFlushVar(scope: VariableOption): SlashCallback {
  return (_args, value) => {
    if (value) deleteVariable(value, scope);
    return "";
  };
}

const CHAT: VariableOption = { type: "chat" };
const GLOBAL: VariableOption = { type: "global" };

let installed = false;

/** Register all built-in commands once. Idempotent. */
export function registerBuiltins(): void {
  if (installed) return;
  installed = true;

  // --- pipe plumbing ---
  addCommandObject({ name: "pass", aliases: ["return"], callback: (_a, v) => v });
  addCommandObject({ name: "comment", callback: () => "" });
  addCommandObject({
    name: "delay",
    aliases: ["wait", "sleep"],
    callback: async (_a, v) => {
      const ms = Number(v);
      await new Promise((r) => setTimeout(r, isNaN(ms) ? 0 : Math.max(0, ms)));
      return "";
    },
  });
  addCommandObject({
    name: "abort",
    callback: (_a, v) => {
      throw new SlashAbort(v || "");
    },
  });

  // --- toast ---
  addCommandObject({
    name: "echo",
    callback: (args, value) => {
      const sev = (args.severity || "info") as ToastLevel;
      const fn = toastr[sev] ?? toastr.info;
      fn(value, args.title);
      return value;
    },
  });

  // --- chat-scope variables ---
  addCommandObject({ name: "setvar", aliases: ["setchatvar"], callback: makeSetVar(CHAT) });
  addCommandObject({ name: "getvar", aliases: ["getchatvar"], callback: makeGetVar(CHAT) });
  addCommandObject({ name: "addvar", aliases: ["addchatvar"], callback: makeAddVar(CHAT) });
  addCommandObject({ name: "incvar", callback: (_a, v) => bumpVar(CHAT, v, 1) });
  addCommandObject({ name: "decvar", callback: (_a, v) => bumpVar(CHAT, v, -1) });
  addCommandObject({ name: "flushvar", callback: makeFlushVar(CHAT) });

  // --- global-scope variables ---
  addCommandObject({ name: "setglobalvar", callback: makeSetVar(GLOBAL) });
  addCommandObject({ name: "getglobalvar", callback: makeGetVar(GLOBAL) });
  addCommandObject({ name: "addglobalvar", callback: makeAddVar(GLOBAL) });
  addCommandObject({ name: "incglobalvar", callback: (_a, v) => bumpVar(GLOBAL, v, 1) });
  addCommandObject({ name: "decglobalvar", callback: (_a, v) => bumpVar(GLOBAL, v, -1) });
  addCommandObject({ name: "flushglobalvar", callback: makeFlushVar(GLOBAL) });

  // --- message insertion (no generation) ---
  addCommandObject({
    name: "send",
    callback: (args, value) => {
      const len = getChat().length;
      const at = args.at !== undefined ? Number(args.at) : len;
      commandInsertMessage(isNaN(at) ? len : at, { role: "user", content: value });
      return "";
    },
  });
  addCommandObject({
    name: "sys",
    callback: (_a, value) => {
      commandInsertMessage(getChat().length, { role: "system", content: value });
      return "";
    },
  });

  // --- generation-bound (host-injected; degrade when absent) ---
  const triggerCallback: SlashCallback = async (args) => {
    const h = getSlashHost();
    if (!h?.triggerGeneration) {
      warnOnce("trigger");
      return "";
    }
    const out = await h.triggerGeneration({ await: args.await === "true" });
    return out ?? "";
  };
  addCommandObject({ name: "trigger", callback: triggerCallback });
  addCommandObject({ name: "gen", callback: triggerCallback });
}
