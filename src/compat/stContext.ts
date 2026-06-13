// SillyTavern `getContext()` shim.
//
// `window.SillyTavern.getContext()` is the single entry point ST extensions use
// to reach everything: the chat array, the active character, the event bus, the
// macro engine, extension settings, prompt injection, and ~80 more fields
// (.ref/SillyTavern/public/scripts/st-context.js). Under decision A3 we don't
// reproduce all of it — we map the subset the front-end-card render pipeline
// (P4/P5) and the regex module (P2) actually touch, and leave clearly-labelled
// stubs for the rest so an extension that probes an unimplemented field gets a
// defined no-op instead of a crash.
//
// The chat/character data is read live from runtimeStore on each access (ST's
// `chat` is a live global, and extensions assume reading it twice reflects any
// change in between). Names/identity come from a provider injected by the
// compat installer, so this module stays decoupled from React/app state.

import { eventSource, event_types } from "./events";
import { substituteParams, substituteParamsExtended } from "./macros";
import { getChat, getMeta, getMessageByMesId } from "./runtimeStore";
import type { RuntimeMessage } from "./runtimeStore";
import { executeSlashCommands, registerSlashCommand, addCommandObject } from "./slash";
import { extension_settings, saveExtensionSettingsNow } from "./extensionSettings";

/** A character entry as getContext().characters exposes it. Minimal subset. */
export interface STCharacter {
  name: string;
  avatar?: string;
  description?: string;
  /** ST nests card data (including regex_scripts) under `data`. */
  data?: Record<string, unknown>;
}

/** Identity/context info the shim can't derive from runtimeStore alone. Filled
 *  by the compat installer from app state. */
export interface ContextProvider {
  characters: () => STCharacter[];
  thisChid: () => number | null;
  chatMetadata: () => Record<string, unknown>;
}

let provider: ContextProvider | null = null;

export function setContextProvider(p: ContextProvider | null): void {
  provider = p;
}

// --- extension prompt injection --------------------------------------------
//
// setExtensionPrompt registers text that ST splices into the prompt at a given
// position/depth. NyaaChat's chatPipeline (P2/P5) reads these out at assembly
// time. Here we just maintain the registry; consumption is wired later.

export interface ExtensionPromptEntry {
  value: string;
  position: number;
  depth: number;
  scan?: boolean;
  role?: number;
}

const extensionPrompts: Record<string, ExtensionPromptEntry> = {};

function setExtensionPrompt(
  key: string,
  value: string,
  position: number,
  depth: number,
  scan?: boolean,
  role?: number,
): void {
  extensionPrompts[key] = { value, position, depth, scan, role };
}

/** Read-only access for the prompt assembler (chatPipeline). */
export function getExtensionPrompts(): Record<string, ExtensionPromptEntry> {
  return extensionPrompts;
}

// --- extension settings store ----------------------------------------------
//
// extension_settings is a plain object ST extensions read/write freely, then
// call saveSettingsDebounced(). The object identity is stable so extensions that
// capture a reference keep working; it is hydrated in-place from browser-local
// storage before extension scripts load. P1 uses localStorage as the synchronous
// source of truth and leaves an IndexedDB migration seam for large script data.

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let persistFn: (() => void) | null = saveExtensionSettingsNow;

/** Register where extension_settings should be persisted. Passing null restores
 *  the default browser-local persister. */
export function setSettingsPersister(fn: (() => void) | null): void {
  persistFn = fn ?? saveExtensionSettingsNow;
}

export function saveSettingsDebounced(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      persistFn?.();
    } catch (err) {
      console.error("[compat] settings persist threw", err);
    }
  }, 1000);
}

// --- the context object -----------------------------------------------------

function notImplemented(name: string): (...args: unknown[]) => never {
  return () => {
    throw new Error(`[compat] SillyTavern.getContext().${name}() is not implemented yet`);
  };
}

/**
 * Build a fresh context object. ST returns a new object each call but with live
 * references to the shared globals — we do the same: `chat` etc. are getters so
 * a captured context still sees current data.
 */
export function getContext(): Record<string, unknown> {
  const characters = provider?.characters() ?? [];
  const thisChid = provider?.thisChid() ?? null;
  const meta = getMeta();

  return {
    // --- live chat / character state ---
    get chat(): RuntimeMessage[] {
      return getChat();
    },
    characters,
    characterId: thisChid,
    this_chid: thisChid,
    get chat_metadata(): Record<string, unknown> {
      return provider?.chatMetadata() ?? {};
    },
    name1: meta.userName ?? "user",
    name2: meta.characterName ?? "",

    // --- events ---
    eventSource,
    eventTypes: event_types,
    event_types,

    // --- macros ---
    substituteParams,
    substituteParamsExtended,

    // --- extension prompt injection ---
    setExtensionPrompt,
    extensionPrompts,

    // --- extension settings ---
    extensionSettings: extension_settings,
    extension_settings,
    saveSettingsDebounced,

    // --- message lookup helpers ---
    getMessageByMesId,

    // --- slash commands (STscript subset, see compat/slash) ---
    // Both the legacy registerSlashCommand(name, cb, aliases, help) and the
    // newer SlashCommandParser.addCommandObject(SlashCommand.fromProps({...}))
    // registration paths map onto our registry. SlashCommand.fromProps is the
    // identity pass-through ST uses to build the def object. Argument-metadata
    // classes (SlashCommandNamedArgument/Argument) aren't exposed here — they're
    // ESM-import-only in ST and our addCommandObject ignores arg lists anyway.
    registerSlashCommand,
    executeSlashCommands,
    executeSlashCommandsWithOptions: (text: string) => executeSlashCommands(text),
    SlashCommandParser: {
      addCommand: (
        name: string,
        callback: Parameters<typeof registerSlashCommand>[1],
        aliases: string[] = [],
        helpString = "",
      ) => registerSlashCommand(name, callback, aliases, helpString),
      addCommandObject,
    },
    SlashCommand: { fromProps: (props: Parameters<typeof addCommandObject>[0]) => props },

    // --- not yet implemented (clearly fail rather than silently misbehave) ---
    // These are mapped as we reach the features that need them (P4/P5).
    generate: notImplemented("generate"),
    generateRaw: notImplemented("generateRaw"),
    addOneMessage: notImplemented("addOneMessage"),
    getRequestHeaders: () => ({ "Content-Type": "application/json" }),
    messageFormatting: (text: string) => text,
  };
}
