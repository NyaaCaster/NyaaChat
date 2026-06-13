// Shim for SillyTavern's public/scripts/slash-commands/SlashCommand.js.
//
// SlashCommand.fromProps({...}) is the builder ST uses to construct a command
// definition object. Our compat addCommandObject consumes that plain object, so
// fromProps is an identity pass-through (matching the compat getContext shim).

import { ctx } from "../_compat-host.js";

export class SlashCommand {
  static fromProps(props) {
    return ctx().SlashCommand.fromProps(props);
  }
}

export default SlashCommand;
