// STscript-compatible slash command engine (pragmatic subset).
//
// ST extensions and front-end cards reach for the slash system two ways:
//   - they REGISTER their own commands (registerSlashCommand /
//     SlashCommandParser.addCommand[Object]) and expect them to be runnable;
//   - they RUN a command string (executeSlashCommands(WithOptions) /
//     TavernHelper.triggerSlash).
//
// NyaaChat has no STscript runtime, so this is a faithful-enough rebuild of the
// parts cards/extensions actually use: a command registry, a single-line parser
// (named `key=value` / `key="quoted"` args plus an unnamed rest), top-level `|`
// piping with the prior result exposed as {{pipe}}, macro substitution via
// substituteParams, and ST's result shape { pipe, isError, errorMessage,
// isAborted }. The full STscript surface (closures, scoped vars, sub-commands,
// argument-type coercion, flags) is intentionally out of scope per decision A3.
//
// Generation-bound commands (/trigger, /gen) can't be implemented from state
// alone — they're routed to a host (ChatInterface) via setSlashCommandHost; when
// no host is registered they degrade to a warn + empty pipe rather than throwing.

import { substituteParams } from "../macros";

/** ST SlashCommandClosureResult subset (the fields triggerSlash reads). */
export interface SlashResult {
  pipe: string;
  isError: boolean;
  errorMessage?: string;
  isAborted: boolean;
}

/** A command handler. Receives the parsed named args and the unnamed value (the
 *  rest of the line). Its return value, stringified, becomes the pipe. Mirrors
 *  ST's `callback(namedArgs, unnamedArg)`. */
export type SlashCallback = (
  namedArgs: Record<string, string>,
  unnamedArg: string,
) => unknown | Promise<unknown>;

interface CommandDef {
  name: string;
  callback: SlashCallback;
  aliases: string[];
  helpString?: string;
}

/** Thrown by /abort to unwind the pipeline as aborted (not an error). */
export class SlashAbort extends Error {}

// --- host injection (generation-bound commands) ----------------------------

export interface SlashHost {
  /** Trigger an AI generation against the current chat (no new user turn).
   *  Returns the generated text (or void). */
  triggerGeneration?: (opts: { await: boolean }) => Promise<string | void> | string | void;
}

let host: SlashHost | null = null;
export function setSlashCommandHost(h: SlashHost | null): void {
  host = h;
}
export function getSlashHost(): SlashHost | null {
  return host;
}

// --- registry ---------------------------------------------------------------

const commands = new Map<string, CommandDef>();

/** Register a command (object form — the ST SlashCommand.fromProps subset). The
 *  same def is indexed under its name and every alias (lower-cased). */
export function addCommandObject(def: {
  name: string;
  callback: SlashCallback;
  aliases?: string[];
  helpString?: string;
}): void {
  if (!def?.name || typeof def.callback !== "function") return;
  const cmd: CommandDef = {
    name: def.name,
    callback: def.callback,
    aliases: Array.isArray(def.aliases) ? def.aliases : [],
    helpString: def.helpString,
  };
  commands.set(def.name.toLowerCase(), cmd);
  for (const a of cmd.aliases) commands.set(a.toLowerCase(), cmd);
}

/** Legacy ST registerSlashCommand(name, callback, aliases, helpString, ...). The
 *  legacy callback signature is the same (namedArgs, unnamedArg). */
export function registerSlashCommand(
  name: string,
  callback: SlashCallback,
  aliases: string[] = [],
  helpString = "",
): void {
  addCommandObject({ name, callback, aliases, helpString });
}

export function getSlashCommand(name: string): CommandDef | undefined {
  return commands.get(name.toLowerCase());
}

/** Distinct primary command names (aliases collapsed). */
export function listSlashCommands(): string[] {
  return [...new Set([...commands.values()].map((c) => c.name))];
}

// --- parsing ----------------------------------------------------------------

/** Tokenize, honoring single/double quotes (quote chars are stripped). Adjacent
 *  text + quoted run forms one token, so `key="a b"` stays a single token. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let has = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has) {
        tokens.push(cur);
        cur = "";
        has = false;
      }
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) tokens.push(cur);
  return tokens;
}

interface ParsedCommand {
  name: string;
  named: Record<string, string>;
  unnamed: string;
}

// A token is a named arg only if its key is a plain identifier — this keeps
// unnamed tokens containing `=` (URLs, equations) from being misread as args.
const NAMED_RE = /^([A-Za-z_][\w-]*)=([\s\S]*)$/;

/** Parse one `/command ...` line into name + named args + unnamed rest. Returns
 *  null when the line isn't a slash command. */
function parseCommandLine(line: string): ParsedCommand | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1);
  const m = body.match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) return null;
  const name = m[1];
  const tokens = tokenize(m[2] ?? "");
  const named: Record<string, string> = {};
  const unnamedParts: string[] = [];
  for (const tok of tokens) {
    const nm = NAMED_RE.exec(tok);
    if (nm) named[nm[1]] = nm[2];
    else unnamedParts.push(tok);
  }
  return { name, named, unnamed: unnamedParts.join(" ") };
}

/** Split a pipeline on top-level `|`, ignoring `|` inside quotes. */
function splitPipeline(text: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "|") {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

// --- execution --------------------------------------------------------------

/**
 * Run a (possibly piped) slash command string. Each segment sees the previous
 * segment's result as {{pipe}}, then macro substitution, then dispatch. An
 * unknown command stops the pipeline with isError (ST semantics — triggerSlash
 * throws on it). /abort unwinds with isAborted.
 */
export async function executeSlashCommands(text: string): Promise<SlashResult> {
  const segments = splitPipeline(text ?? "");
  let pipe = "";
  for (const seg of segments) {
    // {{pipe}} carries the prior result; substituteParams resolves the rest
    // ({{user}}, {{char}}, …). Pipe first so it survives even if the macro
    // engine doesn't know {{pipe}}.
    const withPipe = seg.replace(/\{\{pipe\}\}/gi, pipe);
    const expanded = substituteParams(withPipe);
    const parsed = parseCommandLine(expanded);
    if (!parsed) {
      // Bare text segment: pass it through as the pipe (lenient; ST would error).
      pipe = expanded.trim();
      continue;
    }
    const cmd = getSlashCommand(parsed.name);
    if (!cmd) {
      return {
        pipe,
        isError: true,
        errorMessage: `Unknown slash command: /${parsed.name}`,
        isAborted: false,
      };
    }
    try {
      const out = await cmd.callback(parsed.named, parsed.unnamed);
      pipe = out === undefined || out === null ? "" : String(out);
    } catch (err) {
      if (err instanceof SlashAbort) {
        return { pipe, isError: false, isAborted: true, errorMessage: err.message || undefined };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { pipe, isError: true, errorMessage: msg, isAborted: false };
    }
  }
  return { pipe, isError: false, isAborted: false };
}
