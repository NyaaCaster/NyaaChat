// Shim for SillyTavern's public/scripts/authors-note.js.

export const NOTE_MODULE_NAME = "2_floating_prompt";
export const metadata_keys = {
  prompt: "note_prompt",
  interval: "note_interval",
  depth: "note_depth",
  position: "note_position",
  role: "note_role",
};

export function shouldWIAddPrompt() {
  return false;
}
