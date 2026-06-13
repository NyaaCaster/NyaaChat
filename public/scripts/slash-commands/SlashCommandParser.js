// Shim for SillyTavern's public/scripts/slash-commands/SlashCommandParser.js.
//
// Forwards object/class registration to the compat slash registry. ST's real
// SlashCommandParser is a class with static addCommandObject; our compat layer
// exposes the same shape on getContext().SlashCommandParser.

import { ctx } from "../_compat-host.js";

export class SlashCommandParser {
  static addCommand(name, callback, aliases = [], helpString = "") {
    return ctx().SlashCommandParser.addCommand(name, callback, aliases, helpString);
  }

  static addCommandObject(obj) {
    return ctx().SlashCommandParser.addCommandObject(obj);
  }
}

export default SlashCommandParser;
