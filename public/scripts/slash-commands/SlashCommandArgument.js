// Shim for SillyTavern slash command argument metadata classes.

import { commonEnumProviders } from "./SlashCommandCommonEnumsProvider.js";
import { SlashCommandEnumValue } from "./SlashCommandEnumValue.js";

export const ARGUMENT_TYPE = {
  STRING: "string",
  NUMBER: "number",
  RANGE: "range",
  BOOLEAN: "bool",
  VARIABLE_NAME: "varname",
  CLOSURE: "closure",
  SUBCOMMAND: "subcommand",
  LIST: "list",
  DICTIONARY: "dictionary",
};

export class SlashCommandArgument {
  static fromProps(props = {}) {
    return new SlashCommandArgument(
      props.description,
      props.typeList ?? [ARGUMENT_TYPE.STRING],
      props.isRequired ?? false,
      props.acceptsMultiple ?? false,
      props.defaultValue ?? null,
      props.enumList ?? [],
      props.enumProvider ?? null,
      props.forceEnum ?? false,
    );
  }
  constructor(description, types, isRequired = false, acceptsMultiple = false, defaultValue = null, enums = [], enumProvider = null, forceEnum = false) {
    this.description = description;
    this.typeList = types ? (Array.isArray(types) ? types : [types]) : [];
    this.isRequired = isRequired ?? false;
    this.acceptsMultiple = acceptsMultiple ?? false;
    this.defaultValue = defaultValue;
    this.enumList = (enums ? (Array.isArray(enums) ? enums : [enums]) : []).map((it) =>
      it instanceof SlashCommandEnumValue ? it : new SlashCommandEnumValue(it),
    );
    this.enumProvider = enumProvider;
    this.forceEnum = forceEnum;
    if (!this.enumList.length && this.typeList.length === 1 && this.typeList.includes(ARGUMENT_TYPE.BOOLEAN)) {
      this.enumList = commonEnumProviders.boolean()();
    }
  }
}

export class SlashCommandNamedArgument extends SlashCommandArgument {
  static fromProps(props = {}) {
    return new SlashCommandNamedArgument(
      props.name,
      props.description,
      props.typeList ?? [ARGUMENT_TYPE.STRING],
      props.isRequired ?? false,
      props.acceptsMultiple ?? false,
      props.defaultValue ?? null,
      props.enumList ?? [],
      props.aliasList ?? [],
      props.enumProvider ?? null,
      props.forceEnum ?? false,
    );
  }
  constructor(name, description, types, isRequired = false, acceptsMultiple = false, defaultValue = null, enums = [], aliases = [], enumProvider = null, forceEnum = false) {
    super(description, types, isRequired, acceptsMultiple, defaultValue, enums, enumProvider, forceEnum);
    this.name = name;
    this.aliasList = aliases ? (Array.isArray(aliases) ? aliases : [aliases]) : [];
  }
}
