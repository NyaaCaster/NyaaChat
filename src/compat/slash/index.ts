// Slash command subsystem entry — install built-ins and re-export the engine
// API the compat layer wires onto getContext() and TavernHelper.triggerSlash.

import { registerBuiltins } from "./builtins";

let installed = false;

/** Register the built-in slash commands. Idempotent (StrictMode / HMR safe). */
export function installSlashCommands(): void {
  if (installed) return;
  installed = true;
  registerBuiltins();
}

export {
  executeSlashCommands,
  registerSlashCommand,
  addCommandObject,
  getSlashCommand,
  listSlashCommands,
  setSlashCommandHost,
  SlashAbort,
} from "./engine";
export type { SlashResult, SlashCallback, SlashHost } from "./engine";
