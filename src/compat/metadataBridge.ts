// Browser-local bridge for SillyTavern character extension fields and chat metadata.
//
// ST persists arbitrary extension data under `character.data.extensions` and
// `chat_metadata`. NyaaChat keeps user state in localStorage, so the compat layer
// mirrors those two ST surfaces into browser-local stores and exposes an explicit
// write hook for React to keep CharacterSettings as the durable app-side source.

import type { CharacterSettings } from "../types";

export interface CharacterLikeWithExtensions {
  extensions?: unknown;
  data?: { extensions?: unknown } | Record<string, unknown>;
}

export interface STCharacterLike {
  id: string;
  name: string;
  avatar: string;
  description: string;
  first_mes?: string;
  extensions: Record<string, unknown>;
  data: Record<string, unknown> & { extensions: Record<string, unknown> };
  json_data: string;
}

export type ExtensionFieldValue = unknown;

export interface ExtensionFieldWrite {
  characterId: number | string | null | undefined;
  key: string;
  value: ExtensionFieldValue;
}

export type ExtensionFieldWriter = (write: ExtensionFieldWrite) => boolean | void | Promise<boolean | void>;

export const UNSET_EXTENSION_FIELD = "__@@UNSET@@__";

const CHAT_METADATA_KEY_PREFIX = "nyaachat_chat_metadata";
const DRAFT_SCOPE = "__draft__";

let activeChatScope = DRAFT_SCOPE;
let chatMetadata: Record<string, unknown> = loadChatMetadata(DRAFT_SCOPE);
let extensionFieldWriter: ExtensionFieldWriter | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

function chatMetadataKey(scope: string): string {
  return `${CHAT_METADATA_KEY_PREFIX}::${scope}`;
}

function loadChatMetadata(scope: string): Record<string, unknown> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(chatMetadataKey(scope));
    const parsed = raw ? JSON.parse(raw) : {};
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveChatMetadata(scope: string, value: Record<string, unknown>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(chatMetadataKey(scope), JSON.stringify(value));
  } catch (err) {
    console.error(`[compat] failed to persist chat_metadata (${scope})`, err);
  }
}

/** Switch the active chat metadata scope. Passing null means the unsaved draft chat. */
export function setActiveChatMetadataScope(sessionId: string | null): void {
  const next = sessionId || DRAFT_SCOPE;
  if (next === activeChatScope) return;
  saveChatMetadata(activeChatScope, chatMetadata);
  activeChatScope = next;
  chatMetadata = loadChatMetadata(activeChatScope);
}

/** Stable-enough chat_metadata object for getContext(). Mutations are saved by saveMetadataNow(). */
export function getChatMetadata(): Record<string, unknown> {
  return chatMetadata;
}

export function replaceChatMetadata(value: Record<string, unknown> | null | undefined): void {
  for (const key of Object.keys(chatMetadata)) delete chatMetadata[key];
  if (isRecord(value)) Object.assign(chatMetadata, deepClone(value));
}

export function saveMetadataNow(): void {
  saveChatMetadata(activeChatScope, chatMetadata);
}

export function setExtensionFieldWriter(writer: ExtensionFieldWriter | null): void {
  extensionFieldWriter = writer;
}

export function getCharacterExtensions(character: CharacterLikeWithExtensions | null | undefined): Record<string, unknown> {
  const direct = character?.extensions;
  if (isRecord(direct)) return direct;
  const nested = character?.data?.extensions;
  return isRecord(nested) ? nested : {};
}

export function toSTCharacter(character: CharacterSettings): STCharacterLike {
  const extensions = getCharacterExtensions(character);
  const data = {
    name: character.name,
    description: character.description,
    first_mes: character.firstMes,
    extensions,
  };

  return {
    id: character.id,
    name: character.name,
    avatar: `${character.name}.png`,
    description: character.description,
    first_mes: character.firstMes,
    data,
    extensions,
    json_data: JSON.stringify({ data }),
  };
}

export async function writeExtensionField(
  characterId: number | string | null | undefined,
  key: string,
  value: ExtensionFieldValue,
): Promise<void> {
  if (!key) return;

  const handled = await extensionFieldWriter?.({ characterId, key, value });
  if (handled === false || !extensionFieldWriter) {
    console.warn("[compat] writeExtensionField(): host writer is not ready", { characterId, key });
  }
}

export function applyExtensionFieldToCharacters(
  characters: CharacterSettings[],
  write: ExtensionFieldWrite,
): { characters: CharacterSettings[]; changed: boolean } {
  const index = resolveCharacterIndex(characters, write.characterId);
  if (index < 0) return { characters, changed: false };

  const current = characters[index];
  const currentExtensions = getCharacterExtensions(current);
  const nextExtensions = { ...currentExtensions };
  const isUnset = write.value === undefined || write.value === UNSET_EXTENSION_FIELD;

  if (isUnset) {
    if (!Object.hasOwn(nextExtensions, write.key)) return { characters, changed: false };
    delete nextExtensions[write.key];
  } else {
    nextExtensions[write.key] = deepClone(write.value);
  }

  const next = [...characters];
  next[index] = { ...current, extensions: nextExtensions };
  return { characters: next, changed: true };
}

function resolveCharacterIndex(characters: CharacterSettings[], id: number | string | null | undefined): number {
  if (id === null || id === undefined || id === "") return -1;
  const numeric = typeof id === "number" ? id : Number(id);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric < characters.length) return numeric;
  if (typeof id === "string") return characters.findIndex((c) => c.id === id || c.name === id);
  return -1;
}

(function migrateLegacyChatMetadata() {
  try {
    if (typeof localStorage === "undefined") return;
    const legacy = localStorage.getItem(CHAT_METADATA_KEY_PREFIX);
    if (legacy === null) return;
    const draftKey = chatMetadataKey(DRAFT_SCOPE);
    if (localStorage.getItem(draftKey) === null) localStorage.setItem(draftKey, legacy);
    localStorage.removeItem(CHAT_METADATA_KEY_PREFIX);
  } catch {
    // Best-effort migration only.
  }
})();
