// Shim for SillyTavern's public/scripts/tokenizers.js.

export async function getTokenCountAsync(text) {
  // Cheap approximation good enough for UI counters in imported extensions.
  return Math.ceil(String(text ?? "").length / 4);
}
