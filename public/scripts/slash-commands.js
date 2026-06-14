// Shim for SillyTavern's public/scripts/slash-commands.js (the legacy module).
//
// Forwards to the compat slash subsystem (src/compat/slash) via getContext().
// The newer class-based registration lives under slash-commands/ — see
// SlashCommandParser.js / SlashCommand.js next to this file.

import { ctx } from "./_compat-host.js";

/** Legacy registration: registerSlashCommand(name, callback, aliases, help). */
export function registerSlashCommand(name, callback, aliases = [], helpString = "") {
  return ctx().registerSlashCommand(name, callback, aliases, helpString);
}

/** Run a STscript string through the compat engine. */
export function executeSlashCommands(text) {
  return ctx().executeSlashCommands(text);
}

export function executeSlashCommandsWithOptions(text, options = {}) {
  void options;
  return ctx().executeSlashCommandsWithOptions(text);
}
