// Shim for SillyTavern slash command enum values.

export const enumTypes = {
  enum: "enum",
  command: "command",
  namedArgument: "namedArgument",
  variable: "variable",
  qr: "qr",
  macro: "macro",
  number: "number",
  name: "name",
  getBasedOnIndex(index) {
    const keys = Object.keys(this).filter((key) => typeof this[key] === "string");
    return this[keys[(index ?? 0) % keys.length]];
  },
};

export class SlashCommandEnumValue {
  constructor(value, description = null, type = "enum", typeIcon = "◊", matchProvider = null, valueProvider = null, makeSelectable = false) {
    this.value = value;
    this.description = description;
    this.type = type ?? "enum";
    this.typeIcon = typeIcon;
    this.matchProvider = matchProvider;
    this.valueProvider = valueProvider;
    this.makeSelectable = makeSelectable;
  }
  toString() {
    return this.value;
  }
}
