// Shim for SillyTavern's public/scripts/power-user.js.

export const persona_description_positions = {
  IN_PROMPT: 0,
  TOP_AN: 1,
  BOTTOM_AN: 2,
};

export const power_user = {
  personas: {},
  persona_description: "",
  persona_description_position: persona_description_positions.IN_PROMPT,
  tokenizer: 0,
  context: { story_string: "" },
};

export function flushEphemeralStoppingStrings() {
  return [];
}
