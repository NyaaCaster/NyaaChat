// Shim for SillyTavern's public/scripts/i18n.js.

export function t(strings, ...values) {
  if (Array.isArray(strings) && Object.prototype.hasOwnProperty.call(strings, "raw")) {
    return strings.reduce((out, part, i) => out + part + (values[i] ?? ""), "");
  }
  return String(strings ?? "");
}

export function getCurrentLocale() {
  return navigator.language || "zh-CN";
}
