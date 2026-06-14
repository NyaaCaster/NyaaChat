// Shim for SillyTavern's public/scripts/world-info.js.
//
// World-info prompt injection is intentionally inert here. The exports let JSR's
// settings/UI import graph load without handing third-party code authority over
// NyaaChat's main prompt builder.

export const DEFAULT_DEPTH = 4;
export const DEFAULT_WEIGHT = 100;
export const METADATA_KEY = "world_info";

export const wi_anchor_position = { before: 0, after: 1 };
export const world_info_position = { before: 0, after: 1 };
export const world_info_logic = { AND_ANY: 0, AND_ALL: 1, NOT_ALL: 2, NOT_ANY: 3 };
export const world_info_include_names = { NONE: 0, PRIMARY: 1, BOTH: 2 };

export const selected_world_info = [];
export const world_names = [];
export const world_info = {};

export function parseRegexFromString(input) {
  try {
    const match = String(input ?? "").match(/^\/(.*)\/([a-z]*)$/i);
    return match ? new RegExp(match[1], match[2]) : new RegExp(String(input ?? ""));
  } catch {
    return null;
  }
}

export function newWorldInfoEntryTemplate() {
  return {
    uid: Date.now(),
    key: [],
    keysecondary: [],
    comment: "",
    content: "",
    constant: false,
    selective: false,
    order: DEFAULT_WEIGHT,
    position: world_info_position.before,
    depth: DEFAULT_DEPTH,
    disable: false,
  };
}

export function convertCharacterBook(book) {
  return book ?? { entries: {} };
}

export async function createNewWorldInfo(name = "World") {
  if (!world_names.includes(name)) world_names.push(name);
  world_info[name] ||= { entries: {} };
  return name;
}

export async function loadWorldInfo(name) {
  return world_info[name] ?? { entries: {} };
}

export async function saveWorldInfo(name, data = undefined) {
  if (name && data !== undefined) world_info[name] = data;
}

export async function deleteWorldInfo(name) {
  delete world_info[name];
  const index = world_names.indexOf(name);
  if (index >= 0) world_names.splice(index, 1);
}

export function getWorldInfoSettings() {
  return { world_info, world_names, selected_world_info };
}

export async function getWorldInfoPrompt() {
  return { worldInfoString: "", worldInfoBefore: "", worldInfoAfter: "", worldInfoDepth: [] };
}

export function setWorldInfoButtonClass(...args) {
  void args;
}
