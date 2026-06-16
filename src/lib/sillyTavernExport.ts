// NyaaChat -> SillyTavern character card export (chara_card_v3).
//
// This is the inverse of sillyTavernImport.ts. The world-info mapping is the
// exact reverse of `mapEntryPosition` there: NyaaChat collapses ST's physical
// placements onto two injection roles (system / assistant), so on the way out we
// emit every rule as an at-depth (extensions.position = 4) entry and only vary
// `extensions.role` — 2 for our "assistant" (角色记忆, the only AI-voice case),
// 0 for "system". That round-trips cleanly back through the importer.
//
// Lossy by nature (ST has no hard/soft authority concept, so `hard` is dropped —
// symmetric with the importer defaulting every imported rule to soft). Persona
// stays in `description`; ST's personality/scenario/mes_example are left empty.
// Character regex + variables ride along in `data.extensions` where ST keeps them.

import type { CharacterSettings, WorldInfoRule } from "../types";

// ST world_info_position: at-depth injection. The authoritative value lives in
// `entry.extensions.position`; the V3 top-level string is lossy (ST itself writes
// "after_char" for at-depth entries), so we mirror that.
const ST_POS_AT_DEPTH = 4;
const ST_ROLE_SYSTEM = 0;
const ST_ROLE_ASSISTANT = 2;

/** Full ST entry.extensions block. Mirrors the field set a current SillyTavern
 *  build writes so strict importers find every key they expect; only `role` and
 *  `display_index` vary per entry. */
function buildEntryExtensions(role: number, index: number): Record<string, unknown> {
  return {
    position: ST_POS_AT_DEPTH,
    exclude_recursion: false,
    display_index: index,
    probability: 100,
    useProbability: true,
    depth: 4,
    selectiveLogic: 0,
    group: "",
    group_override: false,
    group_weight: 100,
    prevent_recursion: false,
    delay_until_recursion: false,
    scan_depth: null,
    match_whole_words: null,
    use_group_scoring: false,
    case_sensitive: null,
    automation_id: "",
    role,
    vectorized: false,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    outlet_name: "",
    match_persona_description: false,
    match_character_description: false,
    match_character_personality: false,
    match_character_depth_prompt: false,
    match_scenario: false,
    match_creator_notes: false,
    triggers: [],
    ignore_budget: false,
  };
}

/** Project one NyaaChat rule onto an ST character_book entry. */
function toStEntry(rule: WorldInfoRule, index: number): Record<string, unknown> {
  const isKeyword = rule.triggerType === "keywords";
  const keys = isKeyword
    ? (rule.keywords ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : [];
  const role = rule.position === "assistant" ? ST_ROLE_ASSISTANT : ST_ROLE_SYSTEM;
  return {
    id: index,
    keys,
    secondary_keys: [],
    comment: rule.name || `Rule ${index}`,
    content: rule.content ?? "",
    constant: rule.triggerType === "permanent",
    selective: true,
    insertion_order: 100,
    enabled: rule.enabled !== false,
    position: "after_char",
    use_regex: true,
    extensions: buildEntryExtensions(role, index),
  };
}

/**
 * Build a SillyTavern chara_card_v3 object from a NyaaChat character. The shape
 * matches what `parseSillyTavernPng` / `convertSillyTavernCharacter` (and ST
 * itself) read: top-level legacy fields plus the authoritative `data.*` block,
 * including `character_book.entries` and `data.extensions.regex_scripts`.
 */
export function convertToSillyTavernCharacter(char: CharacterSettings): Record<string, unknown> {
  const name = char.name ?? "";
  const description = char.description ?? "";
  const firstMes = char.firstMes ?? "";
  const rules = char.worldInfo ?? [];

  // ST keeps character regex + arbitrary extension data (variables, bindings)
  // under data.extensions. Carry our passthrough first, then write the
  // authoritative regex array on top so it always wins.
  const extensions: Record<string, unknown> = { ...(char.extensions ?? {}) };
  if (char.regexScripts && char.regexScripts.length) {
    extensions.regex_scripts = char.regexScripts;
  }

  const entries = rules.map((r, i) => toStEntry(r, i));
  const createDate = new Date().toISOString();

  const data = {
    name,
    description,
    personality: "",
    scenario: "",
    first_mes: firstMes,
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    tags: [] as string[],
    creator: "",
    character_version: "",
    alternate_greetings: [] as string[],
    extensions,
    group_only_greetings: [] as string[],
    character_book: {
      name: `${name} Lorebook`,
      entries,
    },
  };

  return {
    name,
    description,
    personality: "",
    scenario: "",
    first_mes: firstMes,
    mes_example: "",
    creatorcomment: "",
    avatar: "none",
    talkativeness: "0.5",
    fav: false,
    tags: [] as string[],
    spec: "chara_card_v3",
    spec_version: "3.0",
    data,
    create_date: createDate,
  };
}
