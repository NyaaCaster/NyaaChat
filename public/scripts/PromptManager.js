// Shim for SillyTavern's public/scripts/PromptManager.js.
//
// This intentionally provides data containers only. It does not splice prompts
// into NyaaChat's main request pipeline; extension prompt injection remains
// governed by src/compat/stContext.ts and the prompt architecture SSOT.

const DEFAULT_ORDER = 100;

export class Prompt {
  constructor({
    identifier,
    role,
    content,
    name,
    system_prompt,
    position,
    injection_depth,
    injection_position,
    forbid_overrides,
    extension,
    injection_order,
    injection_trigger,
  } = {}) {
    this.identifier = identifier;
    this.role = role;
    this.content = content;
    this.name = name;
    this.system_prompt = system_prompt;
    this.position = position;
    this.injection_depth = injection_depth;
    this.injection_position = injection_position;
    this.forbid_overrides = forbid_overrides;
    this.extension = extension ?? false;
    this.injection_order = injection_order ?? DEFAULT_ORDER;
    this.injection_trigger = injection_trigger ?? [];
  }
}

export class PromptCollection {
  constructor(...prompts) {
    this.collection = [];
    this.overriddenPrompts = [];
    this.add(...prompts);
  }
  checkPromptInstance(...prompts) {
    for (const prompt of prompts) {
      if (!(prompt instanceof Prompt)) throw new Error("Only Prompt instances can be added to PromptCollection");
    }
  }
  add(...prompts) {
    this.checkPromptInstance(...prompts);
    this.collection.push(...prompts);
  }
  set(prompt, position) {
    this.checkPromptInstance(prompt);
    this.collection[position] = prompt;
  }
  get(identifier) {
    return this.collection.find((prompt) => prompt.identifier === identifier);
  }
  index(identifier) {
    return this.collection.findIndex((prompt) => prompt.identifier === identifier);
  }
  has(identifier) {
    return this.index(identifier) !== -1;
  }
  override(prompt, position) {
    this.set(prompt, position);
    this.overriddenPrompts.push(prompt.identifier);
  }
}
