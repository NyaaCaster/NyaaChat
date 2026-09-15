// NyaaChat 的 `{{macro}}` 替换引擎 —— 正则脚本通道专用。
//
// 正则脚本的 find / replace 两侧都允许写宏：`substituteRegex` 决定 find 模式的宏
// 展开方式（0=NONE / 1=RAW / 2=ESCAPED），replaceString 里的宏则在替换时展开。
// 本模块就是那台替换机的唯一实现，零依赖（不引 moment / seedrandom / droll /
// Handlebars），只覆盖正则脚本与角色卡实际会用到的那批宏。
//
// 求值顺序（与用户对宏的直觉一致，也与通行实现一致）：
//   preEnv 内置 → env 变量 → postEnv 内置
//
// 聊天派生宏（{{lastMessage}} / {{allChatRange}} …）需要实时消息数组。为了不硬
// 依赖聊天存储（会形成环），聊天源通过 setChatAccessor() 注入；没人注册时这些宏
// 解析成空字符串（等价于空聊天），而不是抛错。

/**
 * Values fed into the macro environment. Anything a `{{key}}` can expand to.
 * Functions are called lazily at substitution time. Keys are matched
 * case-insensitively.
 */
export type MacroEnv = Record<string, string | (() => string) | undefined>;

/** A single chat message as the macro engine needs to see it. Intentionally a
 *  structural subset of the app `Message` type so callers can pass their own
 *  objects without adapting. */
export interface MacroChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  isSystem?: boolean;
}

type ChatAccessor = () => MacroChatMessage[];

let chatAccessor: ChatAccessor | null = null;

/**
 * Register the source of truth for chat-derived macros. Idempotent-friendly:
 * the last registration wins, and passing null detaches.
 */
export function setChatAccessor(fn: ChatAccessor | null): void {
  chatAccessor = fn;
}

function getChat(): MacroChatMessage[] {
  try {
    return chatAccessor?.() ?? [];
  } catch (err) {
    console.error("[regex] chat accessor threw during macro eval", err);
    return [];
  }
}

// --- default environment ---------------------------------------------------
//
// user / char / persona 等不是常量 —— 它们跟随当前角色与用户身份。宿主通过
// setDefaultEnvProvider 注册一个读取器，substituteParams() 在没有显式 env 时才
// 会用它。每次调用的 env 仍然优先于它。

type EnvProvider = () => MacroEnv;

let defaultEnvProvider: EnvProvider | null = null;

/** Register a provider for the baseline macro env (active char/user names,
 *  description, …). Reads live on every call, so switching character or user
 *  role is reflected without re-registering. */
export function setDefaultEnvProvider(fn: EnvProvider | null): void {
  defaultEnvProvider = fn;
}

function getDefaultEnv(): MacroEnv {
  try {
    return defaultEnvProvider?.() ?? {};
  } catch (err) {
    console.error("[regex] default env provider threw", err);
    return {};
  }
}

// --- chat-derived helpers ({{lastMessage}} family) -------------------------

function lastMatching(predicate: (m: MacroChatMessage) => boolean): string {
  const chat = getChat();
  for (let i = chat.length - 1; i >= 0; i--) {
    if (predicate(chat[i])) return chat[i].content ?? "";
  }
  return "";
}

function getLastMessage(): string {
  const chat = getChat();
  return chat.length ? (chat[chat.length - 1].content ?? "") : "";
}

function getLastUserMessage(): string {
  return lastMatching((m) => m.role === "user" && !m.isSystem);
}

function getLastCharMessage(): string {
  return lastMatching((m) => m.role === "assistant" && !m.isSystem);
}

// --- time helpers ----------------------------------------------------------

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function fmtWeekday(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long" });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Minimal token formatter covering the tokens that show up in practice
 *  ({{datetimeformat ...}}). Unknown tokens pass through verbatim. */
function formatWithTokens(d: Date, pattern: string): string {
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: pad2(d.getFullYear() % 100),
    MM: pad2(d.getMonth() + 1),
    DD: pad2(d.getDate()),
    HH: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
    ss: pad2(d.getSeconds()),
  };
  return pattern.replace(/YYYY|YY|MM|DD|HH|mm|ss/g, (t) => map[t] ?? t);
}

// --- list-splitting for {{random}} / {{pick}} ------------------------------

function splitMacroList(listString: string): string[] {
  if (listString.includes("::")) {
    return listString.split("::");
  }
  // Comma-separated form trims each item and honours escaped commas (\,).
  const COMMA = " COMMA ";
  return listString
    .replace(/\\,/g, COMMA)
    .split(",")
    .map((item) => item.trim().replace(new RegExp(COMMA, "g"), ","));
}

// --- dice rolls ({{roll:NdM+K}}) -------------------------------------------

/** Evaluate a dice formula like `2d6`, `d20`, `3d8+2`, `1d4-1`. Bare numbers
 *  are treated as `1dN`. Returns null on an unparseable formula so the macro
 *  can collapse to empty string. */
function rollDice(formula: string): number | null {
  const f = formula.trim();
  if (/^\d+$/.test(f)) {
    return rollDice(`1d${f}`);
  }
  const m = f.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  const modifier = m[3] ? parseInt(m[3], 10) : 0;
  if (count <= 0 || sides <= 0 || count > 1000) return null;
  let total = modifier;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  return total;
}

interface MacroRule {
  regex: RegExp;
  replace: (...args: string[]) => string;
}

function envValue(env: MacroEnv, key: string): string {
  // Case-insensitive lookup; functions are evaluated lazily.
  const direct = env[key];
  const raw = direct !== undefined ? direct : findCaseInsensitive(env, key);
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "function") {
    try {
      return raw() ?? "";
    } catch (err) {
      console.error(`[regex] macro env "${key}" function threw`, err);
      return "";
    }
  }
  return String(raw);
}

function findCaseInsensitive(env: MacroEnv, key: string): string | (() => string) | undefined {
  const lower = key.toLowerCase();
  for (const k in env) {
    if (Object.hasOwn(env, k) && k.toLowerCase() === lower) return env[k];
  }
  return undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Substitute `{{macro}}` placeholders in `content`.
 *
 * @param content The text to process. Returns "" for empty/nullish input.
 * @param env Per-call macro values. Merged over the default env (per-call wins).
 *            Pass `{ user, char, ... }`. Function values are evaluated lazily.
 */
export function substituteParams(content: string | null | undefined, env: MacroEnv = {}): string {
  if (!content) return "";
  let text = String(content);

  const merged: MacroEnv = { ...getDefaultEnv(), ...env };

  // Builtins that run BEFORE env substitution.
  const preEnv: MacroRule[] = [
    { regex: /<USER>/gi, replace: () => envValue(merged, "user") },
    { regex: /<BOT>/gi, replace: () => envValue(merged, "char") },
    { regex: /<CHAR>/gi, replace: () => envValue(merged, "char") },
    { regex: /{{newline}}/gi, replace: () => "\n" },
    { regex: /(?:\r?\n)*{{trim}}(?:\r?\n)*/gi, replace: () => "" },
    { regex: /{{noop}}/gi, replace: () => "" },
    // {{// comment}} — stripped entirely (multiline).
    { regex: /\{\{\/\/[\s\S]*?\}\}/g, replace: () => "" },
  ];

  // Env var macros: one rule per key, case-insensitive.
  const envRules: MacroRule[] = [];
  const seen = new Set<string>();
  for (const key in merged) {
    if (!Object.hasOwn(merged, key)) continue;
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    envRules.push({
      regex: new RegExp(`{{${escapeRegex(key)}}}`, "gi"),
      replace: () => envValue(merged, key),
    });
  }

  // Builtins that run AFTER env substitution.
  const postEnv: MacroRule[] = [
    { regex: /{{lastMessage}}/gi, replace: () => getLastMessage() },
    { regex: /{{lastUserMessage}}/gi, replace: () => getLastUserMessage() },
    { regex: /{{lastCharMessage}}/gi, replace: () => getLastCharMessage() },
    {
      regex: /{{lastMessageId}}/gi,
      replace: () => {
        const n = getChat().length;
        return n ? String(n - 1) : "";
      },
    },
    {
      regex: /{{allChatRange}}/gi,
      replace: () => {
        const n = getChat().length;
        return n === 0 ? "" : `0-${n - 1}`;
      },
    },
    { regex: /{{reverse:(.+?)}}/gi, replace: (_m, str) => Array.from(str).reverse().join("") },
    { regex: /{{time}}/gi, replace: () => fmtTime(new Date()) },
    { regex: /{{date}}/gi, replace: () => fmtDate(new Date()) },
    { regex: /{{weekday}}/gi, replace: () => fmtWeekday(new Date()) },
    { regex: /{{isotime}}/gi, replace: () => `${pad2(new Date().getHours())}:${pad2(new Date().getMinutes())}` },
    {
      regex: /{{isodate}}/gi,
      replace: () => {
        const d = new Date();
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      },
    },
    {
      regex: /{{datetimeformat +([^}]*)}}/gi,
      replace: (_m, pattern) => formatWithTokens(new Date(), pattern),
    },
    {
      regex: /{{time_UTC([-+]\d+)}}/gi,
      replace: (_m, offset) => {
        const off = parseInt(offset, 10);
        const d = new Date(Date.now() + off * 3600 * 1000);
        return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
      },
    },
    {
      regex: /{{roll[ :]([^}]+)}}/gi,
      replace: (_m, formula) => {
        const r = rollDice(formula);
        return r === null ? "" : String(r);
      },
    },
    {
      regex: /{{random\s?::?([^}]+)}}/gi,
      replace: (_m, listString) => {
        const list = splitMacroList(listString);
        if (list.length === 0) return "";
        return list[Math.floor(Math.random() * list.length)];
      },
    },
    {
      // {{pick}} is meant to be stable for a given placement; without a
      // chat-file hash we approximate with a random pick from the list.
      regex: /{{pick\s?::?([^}]+)}}/gi,
      replace: (_m, listString) => {
        const list = splitMacroList(listString);
        if (list.length === 0) return "";
        return list[Math.floor(Math.random() * list.length)];
      },
    },
  ];

  const rules = [...preEnv, ...envRules, ...postEnv];
  for (const rule of rules) {
    if (!text) break;
    const isCurly = rule.regex.source.startsWith("{");
    // Fast path: a `{{…}}` rule can't match once no "{{" remains. Legacy
    // angle-bracket rules (<USER> etc.) are exempt from this guard.
    if (isCurly && !text.includes("{{")) continue;
    try {
      text = text.replace(rule.regex, (...args) => rule.replace(...(args as string[])));
    } catch (err) {
      console.error("[regex] macro rule threw", rule.regex, err);
    }
  }

  return text;
}

/** Alias kept for call sites that pass an "extended" flag upstream. */
export function substituteParamsExtended(content: string | null | undefined, env: MacroEnv = {}): string {
  return substituteParams(content, env);
}
