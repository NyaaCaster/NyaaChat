// Regex engine compatible with SillyTavern's regex extension.
//
// The heart of ST's regex module is the DUAL PIPELINE (SSOT §2.3): the same
// message text is run twice with different flags — once for what the user sees
// (`isMarkdown`) and once for what the model receives (`isPrompt`). A script's
// `markdownOnly` applies only to the first, `promptOnly` only to the second,
// and a script with neither flag rewrites the stored source (so it must NOT
// re-run on the display pass, where the source is already rewritten).
//
// This is a faithful re-implementation of
// .ref/SillyTavern/public/scripts/extensions/regex/engine.js — the matching
// rules, capture-group handling ({{match}} / $1 / $<name>), trimStrings, and
// macro substitution all mirror ST so existing scripts behave identically.
// It leans on the P1 macro engine (substituteParams) for replacement macros.

import { substituteParams, substituteParamsExtended } from "../macros";
import type { RegexScript } from "../../types";

/** Where a regex script applies. Mirrors ST's `regex_placement`. */
export const regex_placement = {
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
} as const;

/** How the find pattern's macros are substituted. Mirrors ST. */
export const substitute_find_regex = {
  NONE: 0,
  RAW: 1,
  ESCAPED: 2,
} as const;

export interface RegexParams {
  characterOverride?: string;
  isMarkdown?: boolean;
  isPrompt?: boolean;
  isEdit?: boolean;
  /** 0 = last message, counting backwards. Enables min/max depth gating. */
  depth?: number;
}

// --- regex compilation ------------------------------------------------------
//
// Mirrors ST's regexFromString: accept either a bare pattern or `/pattern/flags`
// form. Compiled regexes are cached (LRU-ish via Map insertion order) since the
// same scripts run on every message.

const MAX_CACHE = 1000;
const cache = new Map<string, RegExp | null>();

function regexFromString(input: string): RegExp | null {
  if (cache.has(input)) {
    const cached = cache.get(input) ?? null;
    // Touch for LRU ordering.
    cache.delete(input);
    cache.set(input, cached);
    if (cached && (cached.global || cached.sticky)) cached.lastIndex = 0;
    return cached;
  }

  let result: RegExp | null = null;
  try {
    const m = input.match(/(\/?)(.+)\1([a-z]*)/i);
    if (m) {
      const flags = m[3];
      // Reject duplicate / unknown flags; fall back to a literal pattern.
      if (flags && !/^(?!.*?(.).*?\1)[gimsuy]+$/.test(flags)) {
        result = new RegExp(input);
      } else {
        result = new RegExp(m[2], flags);
      }
    } else {
      result = new RegExp(input);
    }
  } catch {
    result = null;
  }

  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(input, result);
  if (result && (result.global || result.sticky)) result.lastIndex = 0;
  return result;
}

/** Escape a macro-expanded value for safe insertion into a regex source.
 *  Mirrors ST's sanitizeRegexMacro (ESCAPED substitution mode). */
function sanitizeRegexMacro(x: string): string {
  if (!x || typeof x !== "string") return x;
  return x.replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, (s) => {
    switch (s) {
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      case "\v":
        return "\\v";
      case "\f":
        return "\\f";
      case "\0":
        return "\\0";
      default:
        return "\\" + s;
    }
  });
}

// --- trim + capture-group substitution -------------------------------------

function filterString(raw: string, trimStrings: string[], characterOverride?: string): string {
  let out = raw;
  for (const trim of trimStrings ?? []) {
    const sub = substituteParams(trim, { name2Override: characterOverride });
    if (sub) out = out.split(sub).join("");
  }
  return out;
}

/**
 * Run a single regex script over a string. Returns the input unchanged when the
 * script is disabled, has no find pattern, or the pattern fails to compile.
 */
export function runRegexScript(
  script: RegexScript,
  rawString: string,
  characterOverride?: string,
): string {
  if (!script || script.disabled || !script.findRegex || !rawString) {
    return rawString;
  }

  const findSource = (() => {
    switch (Number(script.substituteRegex)) {
      case substitute_find_regex.RAW:
        return substituteParamsExtended(script.findRegex);
      case substitute_find_regex.ESCAPED:
        return sanitizeRegexMacro(substituteParamsExtended(script.findRegex));
      case substitute_find_regex.NONE:
      default:
        return script.findRegex;
    }
  })();

  const findRegex = regexFromString(findSource);
  if (!findRegex) return rawString;

  return rawString.replace(findRegex, (...args: unknown[]) => {
    // String.replace args: match, p1..pn, offset, fullString, [namedGroups].
    const named = typeof args[args.length - 1] === "object" ? (args[args.length - 1] as Record<string, string>) : undefined;

    // {{match}} -> $0 first, then resolve numbered / named groups.
    const replaceString = script.replaceString.replace(/\{\{match\}\}/gi, "$0");
    const withGroups = replaceString.replace(/\$(\d+)|\$<([^>]+)>/g, (_full, num: string, groupName: string) => {
      let value: string | undefined;
      if (num !== undefined) {
        value = args[Number(num)] as string | undefined;
      } else if (groupName !== undefined) {
        value = named?.[groupName];
      }
      if (!value) return "";
      return filterString(value, script.trimStrings, characterOverride);
    });

    return substituteParams(withGroups);
  });
}

/**
 * Apply the matching subset of `scripts` to `rawString` for a given placement
 * and pipeline. This is the dual-pipeline gate (ST's getRegexedString):
 *
 *   - markdownOnly scripts run only when isMarkdown
 *   - promptOnly scripts run only when isPrompt
 *   - scripts with neither flag run only when NEITHER isMarkdown nor isPrompt
 *     (they rewrite the stored source, which the display pass already sees
 *     rewritten — re-running would double-apply)
 *
 * Scripts run in array order, chained: each script sees the previous one's
 * output. Caller is responsible for assembling `scripts` in the right priority
 * (global then character-scoped — see store.ts).
 */
export function getRegexedString(
  rawString: string,
  placement: number,
  scripts: RegexScript[],
  params: RegexParams = {},
): string {
  if (typeof rawString !== "string" || !rawString || placement === undefined) {
    return typeof rawString === "string" ? rawString : "";
  }
  const { characterOverride, isMarkdown, isPrompt, isEdit, depth } = params;

  let finalString = rawString;
  for (const script of scripts) {
    const passes =
      (script.markdownOnly && isMarkdown) ||
      (script.promptOnly && isPrompt) ||
      (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt);
    if (!passes) continue;

    if (isEdit && !script.runOnEdit) continue;

    if (typeof depth === "number") {
      const { minDepth, maxDepth } = script;
      if (minDepth !== null && minDepth !== undefined && !isNaN(minDepth) && minDepth >= -1 && depth < minDepth) {
        continue;
      }
      if (maxDepth !== null && maxDepth !== undefined && !isNaN(maxDepth) && maxDepth >= 0 && depth > maxDepth) {
        continue;
      }
    }

    if (Array.isArray(script.placement) && script.placement.includes(placement)) {
      finalString = runRegexScript(script, finalString, characterOverride);
    }
  }

  return finalString;
}
