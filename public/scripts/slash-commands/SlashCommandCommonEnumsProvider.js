// Shim for SillyTavern slash command common enum providers.

import { SlashCommandEnumValue, enumTypes } from "./SlashCommandEnumValue.js";
import { ctx } from "../_compat-host.js";

export const enumIcons = {
  default: "◊",
  variable: "𝑥",
  localVariable: "L",
  globalVariable: "G",
  scopeVariable: "S",
  character: "👤",
  persona: "🧙‍♂️",
  qr: "QR",
  macro: "{{",
  world: "🌐",
  preset: "⚙️",
  message: "💬",
  true: "✔️",
  false: "❌",
  boolean: "🔲",
  number: "1️⃣",
  enum: "📚",
  system: "⚙️",
  user: "👤",
  assistant: "🤖",
  getStateIcon: (state) => (state ? enumIcons.true : enumIcons.false),
  getRoleIcon: (role) => [enumIcons.system, enumIcons.user, enumIcons.assistant][role] ?? enumIcons.default,
  getDataTypeIcon: (type) => enumIcons[String(type ?? "").replace(/\?$/, "")] ?? enumIcons.default,
};

function valuesFromObject(object, type = enumTypes.enum, icon = enumIcons.default) {
  return Object.keys(object ?? {}).map((name) => new SlashCommandEnumValue(name, null, type, icon));
}

export const commonEnumProviders = {
  boolean: (mode = "trueFalse") => () => {
    switch (mode) {
      case "onOff":
        return [new SlashCommandEnumValue("on", null, "macro", enumIcons.true), new SlashCommandEnumValue("off", null, "macro", enumIcons.false)];
      case "onOffToggle":
        return [new SlashCommandEnumValue("on", null, "macro", enumIcons.true), new SlashCommandEnumValue("off", null, "macro", enumIcons.false), new SlashCommandEnumValue("toggle", null, "macro", enumIcons.boolean)];
      default:
        return [new SlashCommandEnumValue("true", null, "macro", enumIcons.true), new SlashCommandEnumValue("false", null, "macro", enumIcons.false)];
    }
  },
  variables: (...type) => () => {
    const settingsVars = ctx().extension_settings?.variables ?? {};
    const chatVars = ctx().chat_metadata?.variables ?? {};
    const includeAll = type.flat().includes("all") || type.length === 0;
    return [
      ...(includeAll || type.flat().includes("local") ? valuesFromObject(chatVars, enumTypes.name, enumIcons.localVariable) : []),
      ...(includeAll || type.flat().includes("global") ? valuesFromObject(settingsVars.global, enumTypes.macro, enumIcons.globalVariable) : []),
    ];
  },
  numbersAndVariables: () => [new SlashCommandEnumValue("any number", null, enumTypes.number, enumIcons.number, (input) => input === "" || !Number.isNaN(Number(input)), (input) => input)],
  characters: () => () => (ctx().characters ?? []).map((char) => new SlashCommandEnumValue(char.name, null, enumTypes.name, enumIcons.character)),
  personas: () => () => [],
  worlds: () => () => [],
  messages: () => () => (ctx().chat ?? []).map((_, index) => new SlashCommandEnumValue(String(index), null, enumTypes.number, enumIcons.message)),
};
